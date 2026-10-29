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
  await db.exec(await readFile(new URL('../migrations/20261023000100_identidad_permisos_auditoria.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261023000200_rango_fechas_reportes.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261023000300_dispositivos_push.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000100_alertas_automaticas.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000200_pausa_reglas_destinatarios.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000300_pruebas_voz.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000400_llamadas_automaticas.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000500_interruptor_notificaciones.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000600_verificar_telefono_voz.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000700_pruebas_sms.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000800_sms_automaticos.sql',import.meta.url),'utf8'));
  console.log('Migracion ejecutada en PostgreSQL embebido con Auth/Storage simulados.');
  const results = await db.exec(await readFile(new URL('./esquema_sismocore.sql',import.meta.url),'utf8'));
  for (const result of results) for (const row of result.rows ?? []) if (row.resultado) console.log(row.resultado);
  const identity = await db.exec(await readFile(new URL('./identidad_permisos.sql',import.meta.url),'utf8'));
  for (const result of identity) for (const row of result.rows ?? []) if (row.resultado) console.log(row.resultado);
  await db.exec(await readFile(new URL('./notificaciones.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./alertas_automaticas.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./pruebas_voz.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./pruebas_sms.sql',import.meta.url),'utf8'));
  console.log('SMS: limites, aislamiento por cuenta y privacidad comprobados.');
  await db.exec(await readFile(new URL('./llamadas_automaticas.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./sms_automaticos.sql',import.meta.url),'utf8'));
  console.log('SMS automaticos: consentimiento, pausa, antiguedad, cuota compartida y deduplicacion comprobados.');
  await db.exec(await readFile(new URL('./interruptor_push.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./verificacion_voz.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261024000900_limite_temporal_voz.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./limite_temporal_voz.sql',import.meta.url),'utf8'));
  console.log('Cuota temporal de voz: diez solo el 24/10 en Perú, bloqueo y regreso a cinco comprobados.');
  console.log('Verificacion telefonica: cuota compartida, privacidad y consentimiento independiente comprobados.');
  console.log('Interruptor de notificaciones: permisos, pausa, pruebas manuales y reactivacion sin historial comprobados.');
  console.log('Consentimiento, interruptor, canales, cuota compartida y deduplicacion de llamadas comprobados.');
  console.log('Limites atomicos y privacidad de pruebas de voz comprobados.');
  console.log('Reglas, zonas, reservas, revocacion y deduplicacion de avisos comprobados.');
  await db.exec(await readFile(new URL('../migrations/20261025000100_reserva_sincronizacion.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./cron_platform_simulada.sql',import.meta.url),'utf8'));
  const cronMigration=(await readFile(new URL('../migrations/20261025000200_programacion_supabase.sql',import.meta.url),'utf8')).replace(/^create extension .*;$/gm,'');
  await db.exec(cronMigration);
  await db.exec(await readFile(new URL('./sincronizacion_cron.sql',import.meta.url),'utf8'));
  console.log('Cron: instalacion pausada, reservas exclusivas, recuperacion de caidas y privacidad comprobadas con plataforma simulada.');
  await db.exec(await readFile(new URL('../migrations/20261025000300_laboratorio_ml.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../migrations/20261025000400_ajuste_clasificacion_ml.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./laboratorio_ml.sql',import.meta.url),'utf8'));
  console.log('ML: permisos, publicación, versiones, reserva exclusiva, finalización, aprobación e inmutabilidad comprobados.');
  await db.exec(await readFile(new URL('../migrations/20261029000100_pruebas_voz_grupo.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('./pruebas_voz_grupo.sql',import.meta.url),'utf8'));
  console.log('Voz: diez intentos diarios permanentes, reserva atomica de dos, espera compartida y limite total comprobados.');
  const tables = await db.query("select count(*)::int as total from pg_tables where schemaname='public'");
  if (tables.rows[0].total !== 13) throw new Error('Cantidad de tablas inesperada');
  const leaked = await db.query("select count(*)::int as total from auth.users");
  if (leaked.rows[0].total !== 0) throw new Error('Los usuarios de prueba no fueron revertidos');
  console.log('13 tablas; restricciones, triggers, RLS, dispositivos push y rollback comprobados.');
} catch (error) {
  console.error(JSON.stringify({ mensaje:error.message, codigo:error.code, detalle:error.detail, contexto:error.where }));
  process.exitCode = 1;
} finally {
  await db.close();
}
