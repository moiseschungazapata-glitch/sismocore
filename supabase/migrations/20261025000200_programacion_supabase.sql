begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Request headers contain a secret: never expose the networking schemas to clients.
revoke all on schema net from public,anon,authenticated;
revoke all on net.http_request_queue,net._http_response from public,anon,authenticated;

create function sismocore_private.ejecutar_cron_igp() returns bigint
language plpgsql security definer set search_path='' as $$
declare token text; solicitud bigint;
begin
 select decrypted_secret into token from vault.decrypted_secrets where name='sismocore_sync_cron_secret';
 if token is null or token !~ '^[a-f0-9]{64}$' then
  raise exception 'Configura la clave privada de sincronizacion en Vault'; end if;
 select net.http_post(
  url:='https://sismocore.vercel.app/api/v1/interno/sincronizacion',
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),
  body:='{}'::jsonb,timeout_milliseconds:=280000) into solicitud;
 update public.fuentes_datos set limites=limites||jsonb_build_object('sync_http_id',solicitud) where codigo='igp';
 return solicitud;
end $$;
revoke all on function sismocore_private.ejecutar_cron_igp() from public,anon,authenticated,service_role;

create function public.sismocore_estado_sincronizacion() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare trabajo record; ultimo record; http record; flags jsonb;
begin
 select * into trabajo from cron.job where jobname='sismocore-igp-5-minutos';
 select * into ultimo from cron.job_run_details where jobid=trabajo.jobid order by start_time desc limit 1;
 select limites into flags from public.fuentes_datos where codigo='igp';
 select * into http from net._http_response where id=(flags->>'sync_http_id')::bigint limit 1;
 return jsonb_build_object('activo',coalesce(trabajo.active,false),'intervalo_segundos',300,
  'ultima_ejecucion',ultimo.start_time,'ultimo_resultado_cron',ultimo.status,
  'ultimo_http',http.status_code,'ultimo_timeout',http.timed_out,
  'ultimo_inicio',flags->>'sync_inicio','ultimo_fin',flags->>'sync_fin','resultado',flags->>'sync_estado');
end $$;
revoke all on function public.sismocore_estado_sincronizacion() from public,anon,authenticated;
grant execute on function public.sismocore_estado_sincronizacion() to service_role;

-- Initial install is paused. The activation script checks the deployed API first.
do $$
declare trabajo bigint;
begin
 if not exists(select 1 from cron.job where jobname='sismocore-igp-5-minutos') then
  select cron.schedule('sismocore-igp-5-minutos','*/5 * * * *',
   'select sismocore_private.ejecutar_cron_igp();') into trabajo;
  perform cron.alter_job(trabajo,active:=false);
 end if;
end $$;
-- Keep only seven days of history for our jobs, never touch unrelated jobs.
select cron.schedule('sismocore-cron-limpieza','17 5 * * *',
 $job$delete from cron.job_run_details where jobid in
  (select jobid from cron.job where jobname in ('sismocore-igp-5-minutos','sismocore-cron-limpieza'))
  and start_time<now()-interval '7 days';$job$);
notify pgrst,'reload schema';
commit;
