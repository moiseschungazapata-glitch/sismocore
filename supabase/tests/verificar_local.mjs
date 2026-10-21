// Runtime temporal: @electric-sql/pglite. No se conecta a la red ni a Supabase.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PGLITE_MODULE
  ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite';
const { PGlite } = await import(moduleName);
const db = new PGlite();
try {
  // Simula exclusivamente las dependencias de Supabase; no instala Auth ni Storage reales.
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),
        nullif(current_setting('request.jwt.claims',true),'')::jsonb ->> 'sub')::uuid;
    $$;
    grant usage on schema auth, public to anon,authenticated,service_role;
    grant execute on function auth.uid() to anon,authenticated,service_role;
    create table storage.buckets(id text primary key,name text not null,public boolean default false);
  `);
  await db.exec(await readFile(new URL('../migrations/20261021000100_esquema_sismocore.sql',import.meta.url),'utf8'));
  console.log('Migracion ejecutada en PostgreSQL embebido con Auth/Storage simulados.');
  const results = await db.exec(await readFile(new URL('./esquema_sismocore.sql',import.meta.url),'utf8'));
  for (const result of results) for (const row of result.rows ?? []) if (row.resultado) console.log(row.resultado);
  const tables = await db.query("select count(*)::int as total from pg_tables where schemaname='public'");
  if (tables.rows[0].total !== 12) throw new Error('Cantidad de tablas inesperada');
  const leaked = await db.query("select count(*)::int as total from auth.users");
  if (leaked.rows[0].total !== 0) throw new Error('Los usuarios de prueba no fueron revertidos');
  console.log('12 tablas; restricciones, triggers, RLS y rollback comprobados.');
} catch (error) {
  console.error(JSON.stringify({ mensaje:error.message, codigo:error.code, detalle:error.detail, contexto:error.where }));
  process.exitCode = 1;
} finally {
  await db.close();
}
