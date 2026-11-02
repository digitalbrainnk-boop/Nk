#!/usr/bin/env node
/**
 * Génère src/types/database.ts à partir des migrations SQL, sans Docker.
 *
 *   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/postgres npm run db:types
 *
 * Le script crée une base temporaire, y applique tests/db/supabase-stub.sql
 * puis supabase/migrations/*.sql, lit la structure du schéma public et écrit
 * des types au même format que `supabase gen types typescript`.
 * (Avec un projet Supabase en ligne, la commande officielle fonctionne aussi :
 *  npx supabase gen types typescript --project-id <id> > src/types/database.ts)
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = path.resolve(import.meta.dirname, "..");
const ADMIN_URL = process.env.TEST_DATABASE_URL;
if (!ADMIN_URL) {
  console.error("TEST_DATABASE_URL manquant (ex. postgres://postgres:postgres@localhost:5432/postgres)");
  process.exit(1);
}

const dbName = `wp_types_${Date.now()}`;
const admin = new pg.Client({ connectionString: ADMIN_URL });
await admin.connect();
await admin.query(`create database ${dbName}`);
const url = new URL(ADMIN_URL);
url.pathname = `/${dbName}`;
const db = new pg.Client({ connectionString: url.toString() });

try {
  await db.connect();
  await db.query(readFileSync(path.join(ROOT, "tests/db/supabase-stub.sql"), "utf8"));
  const dir = path.join(ROOT, "supabase/migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await db.query(readFileSync(path.join(dir, file), "utf8"));
  }

  const enums = (
    await db.query(`
      select t.typname as name, array_agg(e.enumlabel::text order by e.enumsortorder) as labels
      from pg_type t join pg_enum e on e.enumtypid = t.oid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public' group by t.typname order by t.typname`)
  ).rows;
  const enumNames = new Set(enums.map((e) => e.name));

  const columns = (
    await db.query(`
      select c.table_name, c.column_name, c.is_nullable = 'YES' as nullable,
             c.column_default is not null as has_default, c.is_identity = 'YES' as is_identity,
             c.identity_generation, c.is_generated = 'ALWAYS' as is_generated,
             c.data_type, c.udt_name, c.ordinal_position
      from information_schema.columns c
      join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
      where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
      order by c.table_name, c.ordinal_position`)
  ).rows;

  const fks = (
    await db.query(`
      select con.conname as name, rel.relname as table_name, frel.relname as ref_table,
             fns.nspname as ref_schema,
             array(select a.attname from unnest(con.conkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i)::text[] as cols,
             array(select a.attname from unnest(con.confkey) with ordinality k(n, i)
                   join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i)::text[] as ref_cols,
             exists (select 1 from pg_index ix where ix.indrelid = con.conrelid and ix.indisunique
                     and (select array_agg(x order by x) from unnest(ix.indkey::int2[]) x)
                       = (select array_agg(x order by x) from unnest(con.conkey) x)) as one_to_one
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
      join pg_class frel on frel.oid = con.confrelid
      join pg_namespace fns on fns.oid = frel.relnamespace
      where con.contype = 'f' and ns.nspname = 'public'
      order by rel.relname, con.conname`)
  ).rows;

  const functions = (
    await db.query(`
      select p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
             p.proargnames::text[] as arg_names,
             array(select format_type(t, null) from unnest(p.proargtypes) t)::text[] as arg_types,
             format_type(p.prorettype, null) as returns, p.pronargdefaults as n_defaults
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prorettype <> 'trigger'::regtype
      order by p.proname`)
  ).rows;

  const scalar = (udt) => {
    const base = udt.startsWith("_") ? udt.slice(1) : udt;
    let ts;
    if (enumNames.has(base)) ts = `Database["public"]["Enums"]["${base}"]`;
    else if (["int2", "int4", "int8", "float4", "float8", "numeric", "smallint", "integer", "bigint"].includes(base)) ts = "number";
    else if (["bool", "boolean"].includes(base)) ts = "boolean";
    else if (["json", "jsonb"].includes(base)) ts = "Json";
    else ts = "string";
    return udt.startsWith("_") ? `${ts}[]` : ts;
  };
  const fmtType = (formatted) => {
    const map = { text: "string", integer: "number", boolean: "boolean", uuid: "string", smallint: "number", bigint: "number", numeric: "number", jsonb: "Json", "text[]": "string[]" };
    if (map[formatted]) return map[formatted];
    if (enumNames.has(formatted)) return `Database["public"]["Enums"]["${formatted}"]`;
    return "unknown";
  };

  const tables = [...new Set(columns.map((c) => c.table_name))].sort();
  const out = [];
  out.push("// Fichier généré par scripts/gen-db-types.mjs — ne pas modifier à la main.");
  out.push("// Régénérer après chaque migration : npm run db:types");
  out.push("");
  out.push("export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];");
  out.push("");
  out.push("export type Database = {");
  out.push("  public: {");
  out.push("    Tables: {");
  for (const table of tables) {
    const cols = columns.filter((c) => c.table_name === table);
    const row = cols.map((c) => `          ${c.column_name}: ${scalar(c.udt_name)}${c.nullable ? " | null" : ""};`);
    const insert = cols.map((c) => {
      if (c.is_generated || c.identity_generation === "ALWAYS") return `          ${c.column_name}?: never;`;
      const optional = c.nullable || c.has_default || c.is_identity;
      return `          ${c.column_name}${optional ? "?" : ""}: ${scalar(c.udt_name)}${c.nullable ? " | null" : ""};`;
    });
    const update = cols.map((c) => {
      if (c.is_generated || c.identity_generation === "ALWAYS") return `          ${c.column_name}?: never;`;
      return `          ${c.column_name}?: ${scalar(c.udt_name)}${c.nullable ? " | null" : ""};`;
    });
    const rels = fks
      .filter((f) => f.table_name === table && f.ref_schema === "public")
      .map(
        (f) => `          {
            foreignKeyName: "${f.name}";
            columns: [${f.cols.map((c) => `"${c}"`).join(", ")}];
            isOneToOne: ${f.one_to_one};
            referencedRelation: "${f.ref_table}";
            referencedColumns: [${f.ref_cols.map((c) => `"${c}"`).join(", ")}];
          },`,
      );
    out.push(`      ${table}: {`);
    out.push("        Row: {", ...row, "        };");
    out.push("        Insert: {", ...insert, "        };");
    out.push("        Update: {", ...update, "        };");
    out.push(rels.length ? ["        Relationships: [", ...rels, "        ];"].join("\n") : "        Relationships: [];");
    out.push("      };");
  }
  out.push("    };");
  out.push("    Views: { [_ in never]: never };");
  out.push("    Functions: {");
  for (const fn of functions) {
    const names = fn.arg_names ?? [];
    const args = fn.arg_types.length
      ? `{ ${fn.arg_types
          .map((t, i) => `${names[i]}${i >= fn.arg_types.length - fn.n_defaults ? "?" : ""}: ${fmtType(t)}`)
          .join("; ")} }`
      : "never";
    out.push(`      ${fn.name}: { Args: ${args}; Returns: ${fmtType(fn.returns)} };`);
  }
  out.push("    };");
  out.push("    Enums: {");
  for (const e of enums) out.push(`      ${e.name}: ${e.labels.map((l) => `"${l}"`).join(" | ")};`);
  out.push("    };");
  out.push("    CompositeTypes: { [_ in never]: never };");
  out.push("  };");
  out.push("};");
  out.push("");
  out.push('type PublicSchema = Database["public"];');
  out.push('export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"];');
  out.push('export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"];');
  out.push('export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"];');
  out.push('export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];');
  out.push("");

  const target = path.join(ROOT, "src/types/database.ts");
  writeFileSync(target, out.join("\n"));
  console.log(`Types écrits dans ${path.relative(ROOT, target)} (${tables.length} tables, ${functions.length} fonctions).`);
} finally {
  await db.end().catch(() => {});
  await admin.query(`drop database if exists ${dbName} with (force)`);
  await admin.end();
}
