/**
 * Tests de la base de données : migrations + Row Level Security.
 *
 * Ils s'exécutent sur un PostgreSQL local (aucun projet Supabase requis) :
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres npm run test:db
 *
 * Une base temporaire est créée, les migrations y sont appliquées, puis elle
 * est supprimée. Sans TEST_DATABASE_URL, ces tests sont ignorés.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Market, isValidSelection } from "@/lib/predictions/markets";

const ADMIN_URL = process.env.TEST_DATABASE_URL;
const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase/migrations");

const describeDb = ADMIN_URL ? describe : describe.skip;

let admin: Client;
let db: Client;
const dbName = `wp_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

type Role = "anon" | "authenticated" | "service_role";

/** Exécute `fn` dans une transaction annulée, avec le rôle et l'utilisateur donnés. */
async function as<T>(role: Role, userId: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
  await db.query("begin");
  try {
    await db.query(`set local role ${role}`);
    await db.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(userId ? { sub: userId, role } : { role }),
    ]);
    return await fn(db);
  } finally {
    await db.query("rollback");
  }
}

/** Vérifie qu'une requête échoue (dans un savepoint pour ne pas casser la transaction). */
async function expectError(c: Client, sql: string, params: unknown[] = [], pattern?: RegExp) {
  await c.query("savepoint sp");
  let error: Error | null = null;
  try {
    await c.query(sql, params);
  } catch (e) {
    error = e as Error;
  }
  await c.query("rollback to savepoint sp");
  expect(error, `La requête aurait dû échouer : ${sql}`).not.toBeNull();
  if (pattern) expect(error!.message).toMatch(pattern);
}

function adultBirthDate(yearsAgo = 25): string {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - yearsAgo);
  return d.toISOString().slice(0, 10);
}

async function createUser(meta: Record<string, unknown>, email = `${randomUUID()}@test.local`) {
  const { rows } = await db.query<{ id: string }>(
    "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id",
    [email, JSON.stringify(meta)],
  );
  return rows[0].id;
}

const validMeta = () => ({
  display_name: "Awa Ouédraogo",
  birth_date: adultBirthDate(),
  country_code: "BF",
  terms_accepted: true,
});

describeDb("Base de données Supabase (migrations + RLS)", () => {
  let alice: string;
  let bob: string;
  let adminUser: string;

  beforeAll(async () => {
    admin = new Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);

    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    db = new Client({ connectionString: url.toString() });
    await db.connect();

    await db.query(readFileSync(path.join(__dirname, "supabase-stub.sql"), "utf8"));
    const migrations = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const file of migrations) {
      await db.query(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    }

    alice = await createUser(validMeta());
    bob = await createUser({ ...validMeta(), display_name: "Bob" });
    adminUser = await createUser({ ...validMeta(), display_name: "Admin" });
    await db.query("update public.profiles set role = 'admin' where id = $1", [adminUser]);

    // Jeu de données multi-sports minimal (identifiants internes fixés via « overriding system value »)
    await db.query(`
      insert into public.competitions (id, sport, external_id, name, country_name, is_enabled) overriding system value
        values (9001, 'football', 9001, 'Ligue cachée', 'Test', false),
               (9002, 'basketball', 12, 'NBA', 'USA', true);
      insert into public.teams (id, sport, external_id, name) overriding system value
        values (1, 'football', 1, 'ASFA Yennenga'), (2, 'football', 2, 'Rahimo FC'),
               (3, 'basketball', 1, 'Lakers'), (4, 'basketball', 2, 'Celtics');
      insert into public.events (id, sport, external_id, competition_id, season, starts_at, home_team_id, away_team_id) overriding system value
        values (100, 'football', 100, (select id from public.competitions where sport = 'football' and external_id = 39), '2026', now() + interval '1 day', 1, 2),
               (101, 'football', 101, (select id from public.competitions where sport = 'football' and external_id = 39), '2026', now() - interval '2 days', 2, 1),
               (102, 'basketball', 102, 9002, '2026-2027', now() + interval '1 day', 3, 4);
      update public.events set status_short = 'FT', status_group = 'finished', home_score = 2, away_score = 0 where id = 101;
    `);
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  it("active la RLS sur toutes les tables du schéma public", async () => {
    const { rows } = await db.query(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity",
    );
    expect(rows).toEqual([]);
  });

  describe("inscription et profils", () => {
    it("crée automatiquement le profil d'un majeur", async () => {
      const { rows } = await db.query("select display_name, role, country_code from public.profiles where id = $1", [alice]);
      expect(rows[0]).toEqual({ display_name: "Awa Ouédraogo", role: "user", country_code: "BF" });
    });

    it("refuse un mineur (17 ans)", async () => {
      await db.query("begin");
      await expectError(
        db,
        "insert into auth.users (email, raw_user_meta_data) values ('mineur@test.local', $1)",
        [JSON.stringify({ ...validMeta(), birth_date: adultBirthDate(17) })],
        /AGE_REQUIREMENT/,
      );
      await db.query("rollback");
    });

    it("refuse une inscription sans date de naissance ou sans acceptation des conditions", async () => {
      await db.query("begin");
      await expectError(db, "insert into auth.users (email, raw_user_meta_data) values ('x@test.local', '{}')", [], /AGE_REQUIREMENT/);
      await expectError(
        db,
        "insert into auth.users (email, raw_user_meta_data) values ('y@test.local', $1)",
        [JSON.stringify({ ...validMeta(), terms_accepted: false })],
        /TERMS_REQUIRED/,
      );
      await db.query("rollback");
    });

    it("ne montre à un utilisateur que son propre profil", async () => {
      const rows = await as("authenticated", alice, async (c) => (await c.query("select id from public.profiles")).rows);
      expect(rows).toEqual([{ id: alice }]);
    });

    it("laisse l'admin lire tous les profils", async () => {
      const count = await as("authenticated", adminUser, async (c) =>
        Number((await c.query("select count(*) from public.profiles")).rows[0].count),
      );
      expect(count).toBe(3);
    });

    it("autorise la modification du pseudo mais pas du rôle ni de la date de naissance", async () => {
      await as("authenticated", alice, async (c) => {
        const res = await c.query("update public.profiles set display_name = 'Awa O.' where id = $1", [alice]);
        expect(res.rowCount).toBe(1);
        await expectError(c, "update public.profiles set role = 'admin' where id = $1", [alice], /permission denied/);
        await expectError(c, "update public.profiles set birth_date = '2015-01-01' where id = $1", [alice], /permission denied/);
      });
    });

    it("empêche de modifier le profil d'un autre", async () => {
      await as("authenticated", alice, async (c) => {
        const res = await c.query("update public.profiles set display_name = 'Pirate' where id = $1", [bob]);
        expect(res.rowCount).toBe(0);
      });
    });

    it("synchronise l'e-mail du profil avec auth.users", async () => {
      await db.query("begin");
      await db.query("update auth.users set email = 'nouvel@test.local' where id = $1", [alice]);
      const { rows } = await db.query("select email from public.profiles where id = $1", [alice]);
      expect(rows[0].email).toBe("nouvel@test.local");
      await db.query("rollback");
    });
  });

  describe("données sportives", () => {
    it("n'affiche aux visiteurs que les sports et compétitions activés", async () => {
      const sports = await as("anon", null, async (c) =>
        (await c.query("select code from public.sports order by display_order")).rows.map((r) => r.code),
      );
      expect(sports).toEqual(["football", "basketball", "ice_hockey", "handball", "volleyball", "rugby", "baseball", "american_football"]);
      const names = await as("anon", null, async (c) =>
        (await c.query("select name from public.competitions")).rows.map((r) => r.name),
      );
      expect(names).toContain("Premier League");
      expect(names).toContain("NBA");
      expect(names).not.toContain("Ligue cachée");
    });

    it("accepte le même identifiant fournisseur dans deux sports différents", async () => {
      const { rows } = await db.query("select count(*)::int as n from public.teams where external_id = 1");
      expect(rows[0].n).toBe(2);
    });

    it("refuse un événement dont la compétition ou les équipes sont d'un autre sport", async () => {
      await db.query("begin");
      await expectError(
        db,
        "insert into public.events (sport, external_id, competition_id, starts_at, home_team_id, away_team_id) values ('basketball', 999, 9001, now(), 3, 4)",
        [],
        /foreign key/,
      );
      await expectError(
        db,
        "insert into public.events (sport, external_id, competition_id, starts_at, home_team_id, away_team_id) values ('basketball', 998, 9002, now(), 1, 4)",
        [],
        /foreign key/,
      );
      await db.query("rollback");
    });

    it("vérifie la cohérence marché / ligne / sélection des cotes", async () => {
      await db.query("begin");
      await db.query(`insert into public.event_odds (event_id, bookmaker_id, bookmaker_name, period, market, line, selection, odd)
        values (102, 1, 'Test', 'FT', 'TOTAL', 215.5, 'OVER', 1.9), (102, 1, 'Test', 'FT', 'ML', null, '1', 1.6),
               (100, 1, 'Test', 'FT', 'HTFT', null, 'X/1', 4.5), (100, 1, 'Test', '1H', 'TOTAL', 0.5, 'OVER', 1.4),
               (100, 1, 'Test', 'FT', 'TOTAL', 0.5, 'OVER', 1.05)`);
      await expectError(db, "insert into public.event_odds (event_id, bookmaker_id, bookmaker_name, period, market, line, selection, odd) values (100, 1, 'T', 'Z9', 'TOTAL', 1.5, 'OVER', 1.9)", [], /check/);
      await expectError(db, "insert into public.event_odds (event_id, bookmaker_id, bookmaker_name, market, line, selection, odd) values (102, 1, 'T', 'TOTAL', null, 'OVER', 1.9)", [], /check/);
      await expectError(db, "insert into public.event_odds (event_id, bookmaker_id, bookmaker_name, market, line, selection, odd) values (102, 1, 'T', '1X2', null, 'Y', 1.9)", [], /check/);
      await expectError(db, "insert into public.event_odds (event_id, bookmaker_id, bookmaker_name, market, line, selection, odd) values (102, 1, 'T', 'ML', null, '1', 1.7)", [], /duplicate key/);
      await db.query("rollback");
    });

    it("valide les marchés exactement comme le code TypeScript", async () => {
      const cases: [Market, number | null, string][] = [
        ["1X2", null, "X"], ["1X2", 1, "X"], ["DC", null, "1X"], ["ML", null, "X"], ["TOTAL", 2.25, "OVER"],
        ["TOTAL", null, "OVER"], ["TT1", 1.5, "UNDER"], ["HCP", -1.75, "2"], ["HCP", null, "1"], ["BTTS", null, "YES"],
        ["CS", null, "2-1"], ["CS", null, "2:1"], ["ODD_EVEN", null, "ODD"], ["RES_TOTAL", 2.5, "1&OVER"],
        ["RES_TOTAL", null, "1&OVER"], ["RES_BTTS", null, "X&NO"], ["DC_BTTS", null, "12&YES"], ["DC_TOTAL", 3.5, "X2&UNDER"],
        ["HTFT", null, "X/2"], ["HTFT", null, "3/1"], ["TEAM_SCORE_BOTH_HALVES", null, "2:NO"], ["HIGHEST_HALF", null, "EQ"],
        ["FIRST_GOAL", null, "NONE"], ["GOAL_INTERVAL", null, "76-90:YES"], ["TEAM_FIRST_GOAL_INTERVAL", null, "1:16-30"],
        ["PEN_RED_COMBO", null, "NEITHER"], ["CORNERS", 9.5, "OVER"], ["SCORER", null, "P12345"], ["SCORER", null, "Isak"],
        ["WIN_NIL", null, "2"], ["DRAW_GOALS", null, "YES"], ["PENALTY", 1, "YES"],
      ];
      for (const [market, line, selection] of cases) {
        const { rows } = await db.query("select public.is_valid_selection($1, $2, $3) as ok", [market, line, selection]);
        expect(rows[0].ok, `${market} ${line} ${selection}`).toBe(isValidSelection(market, line, selection));
      }
      const periods = await db.query("select public.is_valid_period('1H') as a, public.is_valid_period('Q4') as b, public.is_valid_period('X1') as c");
      expect(periods.rows[0]).toEqual({ a: true, b: true, c: false });
    });

    it("interdit aux visiteurs et utilisateurs d'écrire les données sportives", async () => {
      await as("anon", null, async (c) => {
        await expectError(c, "insert into public.teams (sport, external_id, name) values ('football', 3, 'Pirate')", [], /permission denied/);
      });
      await as("authenticated", alice, async (c) => {
        await expectError(c, "update public.events set home_score = 9 where id = 100", [], /permission denied/);
      });
    });

    it("laisse l'admin, et lui seul, activer une compétition ou un sport", async () => {
      await as("authenticated", alice, async (c) => {
        const res = await c.query("update public.competitions set is_enabled = true where id = 9001");
        expect(res.rowCount).toBe(0);
        await expectError(c, "update public.competitions set name = 'X' where id = 9002", [], /permission denied/);
        expect((await c.query("update public.sports set is_enabled = true where code = 'tennis'")).rowCount).toBe(0);
      });
      await as("authenticated", adminUser, async (c) => {
        expect((await c.query("update public.sports set is_enabled = true where code = 'tennis'")).rowCount).toBe(1);
      });
      await as("authenticated", adminUser, async (c) => {
        const res = await c.query("update public.competitions set is_enabled = true where id = 9001");
        expect(res.rowCount).toBe(1);
      });
    });
  });

  describe("données serveur uniquement", () => {
    it.each(["api_cache", "rate_limits", "payments", "sync_runs", "admin_audit_log"])(
      "cache la table %s aux visiteurs",
      async (table) => {
        await as("anon", null, async (c) => {
          await expectError(c, `select * from public.${table}`, [], /permission denied/);
        });
      },
    );

    it("ne montre les paiements qu'à leur propriétaire", async () => {
      await db.query(`
        insert into public.payments (user_id, plan_code, provider, provider_transaction_id, amount_xof)
        values ('${alice}', 'weekly', 'cinetpay', 'tx-alice', 1000), ('${bob}', 'weekly', 'cinetpay', 'tx-bob', 1000)
        on conflict do nothing`);
      const rows = await as("authenticated", alice, async (c) =>
        (await c.query("select provider_transaction_id from public.payments")).rows,
      );
      expect(rows).toEqual([{ provider_transaction_id: "tx-alice" }]);
      await as("authenticated", alice, async (c) => {
        await expectError(c, "update public.payments set status = 'succeeded'", [], /permission denied/);
      });
    });

    it("limite le nombre de requêtes et réserve la fonction au serveur", async () => {
      await as("authenticated", alice, async (c) => {
        await expectError(c, "select public.rate_limit_hit('k', 2, 60)", [], /permission denied/);
      });
      await as("service_role", null, async (c) => {
        const hit = async () => (await c.query("select public.rate_limit_hit('otp:226', 2, 60) as ok")).rows[0].ok;
        expect(await hit()).toBe(true);
        expect(await hit()).toBe(true);
        expect(await hit()).toBe(false);
      });
    });
  });

  describe("pronostics et historique", () => {
    beforeAll(async () => {
      await db.query(`
        insert into public.predictions (id, event_id, model_version, expected_home, expected_away, probabilities)
        values ('00000000-0000-0000-0000-000000000001', 100, 'test', 1.6, 0.9, '{"1X2": {"1": 0.5, "X": 0.27, "2": 0.23}}'),
               ('00000000-0000-0000-0000-000000000002', 101, 'test', 1.2, 1.1, '{"1X2": {"1": 0.4, "X": 0.3, "2": 0.3}}');
        insert into public.prediction_picks (id, prediction_id, event_id, competition_id, sport, market, line, selection, probability, confidence, is_premium)
        values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 100, (select competition_id from public.events where id = 100), 'football', '1X2', null, '1', 0.5, 3, false),
               ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 100, (select competition_id from public.events where id = 100), 'football', 'TOTAL', 2.5, 'OVER', 0.55, 4, true),
               ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000002', 101, (select competition_id from public.events where id = 101), 'football', '1X2', null, '2', 0.3, 2, true);
        update public.prediction_picks set result = 'lost', settled_at = now() where id = '00000000-0000-0000-0000-0000000000a3';
      `);
    });

    const visiblePicks = (role: Role, user: string | null) =>
      as(role, user, async (c) =>
        (await c.query("select market from public.prediction_picks order by market, event_id")).rows.map((r) => r.market),
      );

    it("montre aux gratuits les pronostics gratuits + l'historique réglé", async () => {
      expect(await visiblePicks("anon", null)).toEqual(["1X2", "1X2"]);
      expect(await visiblePicks("authenticated", alice)).toEqual(["1X2", "1X2"]);
    });

    it("montre tout aux abonnés premium", async () => {
      await db.query(
        "insert into public.subscriptions (user_id, plan_code, ends_at) values ($1, 'weekly', now() + interval '7 days')",
        [bob],
      );
      expect(await visiblePicks("authenticated", bob)).toEqual(["1X2", "1X2", "TOTAL"]);
    });

    it("ne donne plus l'accès premium quand l'abonnement est expiré", async () => {
      const carol = await createUser({ ...validMeta(), display_name: "Carol" });
      await db.query(
        "insert into public.subscriptions (user_id, plan_code, starts_at, ends_at) values ($1, 'weekly', now() - interval '10 days', now() - interval '3 days')",
        [carol],
      );
      expect(await visiblePicks("authenticated", carol)).toEqual(["1X2", "1X2"]);
    });

    it("réserve les probabilités détaillées aux premium, sauf événement terminé", async () => {
      const anonEvents = await as("anon", null, async (c) =>
        (await c.query("select event_id from public.predictions")).rows.map((r) => Number(r.event_id)),
      );
      expect(anonEvents).toEqual([101]);
    });

    it("refuse deux pronostics publiés sur le même marché et la même ligne", async () => {
      await db.query("begin");
      await expectError(
        db,
        `insert into public.prediction_picks (prediction_id, event_id, competition_id, sport, market, line, selection, probability, confidence)
         values ('00000000-0000-0000-0000-000000000001', 100, (select competition_id from public.events where id = 100), 'football', 'TOTAL', 2.5, 'UNDER', 0.45, 2)`,
        [],
        /duplicate key/,
      );
      await db.query("rollback");
    });

    it("fige un pronostic publié : seul le résultat peut changer", async () => {
      await db.query("begin");
      await expectError(
        db,
        "update public.prediction_picks set probability = 0.9 where id = '00000000-0000-0000-0000-0000000000a1'",
        [],
        /PICK_IMMUTABLE/,
      );
      await expectError(
        db,
        "delete from public.prediction_picks where id = '00000000-0000-0000-0000-0000000000a1'",
        [],
        /PICK_IMMUTABLE/,
      );
      const res = await db.query(
        "update public.prediction_picks set result = 'won', settled_at = now() where id = '00000000-0000-0000-0000-0000000000a1'",
      );
      expect(res.rowCount).toBe(1);
      await db.query("rollback");
    });

    it("interdit aux utilisateurs de publier ou modifier un pronostic", async () => {
      await as("authenticated", adminUser, async (c) => {
        await expectError(
          c,
          "update public.prediction_picks set result = 'won' where id = '00000000-0000-0000-0000-0000000000a1'",
          [],
          /permission denied/,
        );
      });
    });
  });

  describe("coupons, favoris et réglages", () => {
    it("interdit de créer un coupon en direct (création serveur uniquement)", async () => {
      await as("authenticated", alice, async (c) => {
        await expectError(
          c,
          `insert into public.coupons (user_id, source, target_odds, risk_level, period, total_odds, estimated_probability)
           values ($1, 'generated', 5, 'prudent', 'jour', 5.2, 0.15)`,
          [alice],
          /permission denied/,
        );
      });
    });

    it("montre ses coupons et les coupons mis en avant (premium réservés aux abonnés)", async () => {
      await db.query(`
        insert into public.coupons (id, user_id, source, target_odds, risk_level, period, total_odds, estimated_probability, is_featured, is_premium)
        values ('00000000-0000-0000-0000-0000000000c1', '${alice}', 'generated', 5, 'prudent', 'jour', 5.1, 0.2, false, false),
               ('00000000-0000-0000-0000-0000000000c2', '${bob}', 'generated', 3, 'equilibre', 'weekend', 3.2, 0.3, false, false),
               ('00000000-0000-0000-0000-0000000000c3', null, 'editorial', 10, null, null, 10.4, 0.07, true, false),
               ('00000000-0000-0000-0000-0000000000c4', null, 'editorial', 20, null, null, 21.0, 0.04, true, true)`);
      const visible = (role: Role, user: string | null) =>
        as(role, user, async (c) =>
          (await c.query("select target_odds::float as t from public.coupons order by t")).rows.map((r) => r.t),
        );
      expect(await visible("authenticated", alice)).toEqual([5, 10]);
      expect(await visible("anon", null)).toEqual([10]);
      expect(await visible("authenticated", bob)).toEqual([3, 10, 20]); // bob est premium
    });

    it("exige les paramètres d'un coupon généré", async () => {
      await db.query("begin");
      await expectError(
        db,
        "insert into public.coupons (user_id, source, total_odds) values ($1, 'generated', 5)",
        [alice],
        /coupons_generated_params/,
      );
      await db.query("rollback");
    });

    it("partage les codes de chargement avec le coupon, saisis par l'admin seulement", async () => {
      await as("authenticated", alice, async (c) => {
        await expectError(
          c,
          "insert into public.coupon_booking_codes (coupon_id, bookmaker, code, created_by) values ('00000000-0000-0000-0000-0000000000c3', '1xbet', 'ABC12', $1)",
          [alice],
          /row-level security/,
        );
      });
      await as("authenticated", adminUser, async (c) => {
        await c.query(
          `insert into public.coupon_booking_codes (coupon_id, bookmaker, country_code, code, created_by)
           values ('00000000-0000-0000-0000-0000000000c3', '1xbet', 'BF', 'ABC12', $1),
                  ('00000000-0000-0000-0000-0000000000c4', '1xbet', 'BF', 'PREM99', $1)`,
          [adminUser],
        );
        await expectError(
          c,
          "insert into public.coupon_booking_codes (coupon_id, bookmaker, code, created_by) values ('00000000-0000-0000-0000-0000000000c3', '1xbet', 'bad code!', $1)",
          [adminUser],
          /check/,
        );
        // Lecture par un visiteur dans la même transaction : seul le code du coupon gratuit est visible
        await c.query("set local role anon");
        await c.query("select set_config('request.jwt.claims', '{}', true)");
        const codes = (await c.query("select code from public.coupon_booking_codes")).rows.map((r) => r.code);
        expect(codes).toEqual(["ABC12"]);
      });
    });

    it("gère ses équipes favorites, sans pouvoir toucher à celles des autres", async () => {
      await as("authenticated", alice, async (c) => {
        await c.query("insert into public.favorite_teams (team_id) values (1)");
        const { rows } = await c.query("select user_id, team_id::int from public.favorite_teams");
        expect(rows).toEqual([{ user_id: alice, team_id: 1 }]);
        await expectError(c, "insert into public.favorite_teams (user_id, team_id) values ($1, 2)", [bob], /row-level security/);
      });
    });

    it("n'expose aux visiteurs que les réglages publics", async () => {
      await db.query("insert into public.app_settings (key, value) values ('secret_interne', '42') on conflict do nothing");
      const keys = await as("anon", null, async (c) =>
        (await c.query("select key from public.app_settings")).rows.map((r) => r.key),
      );
      expect(keys).toContain("free_picks_per_day");
      expect(keys).not.toContain("secret_interne");
    });
  });
});
