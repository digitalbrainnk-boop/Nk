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

    // Jeu de données football minimal
    await db.query(`
      insert into public.competitions (id, name, country_name, is_enabled) values (9001, 'Ligue cachée', 'Test', false);
      insert into public.teams (id, name) values (1, 'ASFA Yennenga'), (2, 'Rahimo FC');
      insert into public.fixtures (id, competition_id, season, kickoff_at, home_team_id, away_team_id)
        values (100, 39, 2026, now() + interval '1 day', 1, 2),
               (101, 39, 2026, now() - interval '2 days', 2, 1);
      update public.fixtures set status_short = 'FT', home_goals = 2, away_goals = 0 where id = 101;
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

  describe("données football", () => {
    it("n'affiche aux visiteurs que les compétitions activées", async () => {
      const ids = await as("anon", null, async (c) =>
        (await c.query("select id from public.competitions")).rows.map((r) => r.id),
      );
      expect(ids).toContain(39);
      expect(ids).not.toContain(9001);
    });

    it("calcule le groupe de statut du match", async () => {
      const { rows } = await db.query("select id, status_group from public.fixtures order by id");
      expect(rows).toEqual([
        { id: 100, status_group: "scheduled" },
        { id: 101, status_group: "finished" },
      ]);
    });

    it("interdit aux visiteurs et utilisateurs d'écrire les données football", async () => {
      await as("anon", null, async (c) => {
        await expectError(c, "insert into public.teams (id, name) values (3, 'Pirate')", [], /permission denied/);
      });
      await as("authenticated", alice, async (c) => {
        await expectError(c, "update public.fixtures set home_goals = 9 where id = 100", [], /permission denied/);
      });
    });

    it("laisse l'admin, et lui seul, activer une compétition", async () => {
      await as("authenticated", alice, async (c) => {
        const res = await c.query("update public.competitions set is_enabled = true where id = 9001");
        expect(res.rowCount).toBe(0);
        await expectError(c, "update public.competitions set name = 'X' where id = 39", [], /permission denied/);
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
        insert into public.predictions (id, fixture_id, model_version, expected_home_goals, expected_away_goals, probabilities)
        values ('00000000-0000-0000-0000-000000000001', 100, 'test', 1.6, 0.9, '{"1X2": {"1": 0.5, "X": 0.27, "2": 0.23}}'),
               ('00000000-0000-0000-0000-000000000002', 101, 'test', 1.2, 1.1, '{"1X2": {"1": 0.4, "X": 0.3, "2": 0.3}}');
        insert into public.prediction_picks (id, prediction_id, fixture_id, competition_id, market, selection, probability, confidence, is_premium)
        values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 100, 39, '1X2', '1', 0.5, 3, false),
               ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 100, 39, 'OU25', 'OVER', 0.55, 4, true),
               ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000002', 101, 39, '1X2', '2', 0.3, 2, true);
        update public.prediction_picks set result = 'lost', settled_at = now() where id = '00000000-0000-0000-0000-0000000000a3';
      `);
    });

    const visiblePicks = (role: Role, user: string | null) =>
      as(role, user, async (c) =>
        (await c.query("select market from public.prediction_picks order by market, fixture_id")).rows.map((r) => r.market),
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
      expect(await visiblePicks("authenticated", bob)).toEqual(["1X2", "1X2", "OU25"]);
    });

    it("ne donne plus l'accès premium quand l'abonnement est expiré", async () => {
      const carol = await createUser({ ...validMeta(), display_name: "Carol" });
      await db.query(
        "insert into public.subscriptions (user_id, plan_code, starts_at, ends_at) values ($1, 'weekly', now() - interval '10 days', now() - interval '3 days')",
        [carol],
      );
      expect(await visiblePicks("authenticated", carol)).toEqual(["1X2", "1X2"]);
    });

    it("réserve les probabilités détaillées aux premium, sauf match terminé", async () => {
      const anonFixtures = await as("anon", null, async (c) =>
        (await c.query("select fixture_id from public.predictions")).rows.map((r) => r.fixture_id),
      );
      expect(anonFixtures).toEqual([101]);
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
          `insert into public.coupons (user_id, target_odds, risk_level, period, total_odds, estimated_probability)
           values ($1, 5, 'prudent', 'jour', 5.2, 0.15)`,
          [alice],
          /permission denied/,
        );
      });
    });

    it("montre ses coupons et les coupons mis en avant", async () => {
      await db.query(`
        insert into public.coupons (user_id, target_odds, risk_level, period, total_odds, estimated_probability, is_featured)
        values ('${alice}', 5, 'prudent', 'jour', 5.1, 0.2, false),
               ('${bob}', 3, 'equilibre', 'weekend', 3.2, 0.3, false),
               (null, 10, 'audacieux', 'long_terme', 10.4, 0.07, true)`);
      const rows = await as("authenticated", alice, async (c) =>
        (await c.query("select target_odds::float as t from public.coupons order by t")).rows.map((r) => r.t),
      );
      expect(rows).toEqual([5, 10]);
      const anonRows = await as("anon", null, async (c) =>
        (await c.query("select target_odds::float as t from public.coupons")).rows.map((r) => r.t),
      );
      expect(anonRows).toEqual([10]);
    });

    it("gère ses équipes favorites, sans pouvoir toucher à celles des autres", async () => {
      await as("authenticated", alice, async (c) => {
        await c.query("insert into public.favorite_teams (team_id) values (1)");
        const { rows } = await c.query("select user_id, team_id from public.favorite_teams");
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
