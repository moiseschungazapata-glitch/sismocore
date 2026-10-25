begin;
-- Reuse source metadata. No business table or credential is added.
create function public.sismocore_adquirir_sincronizacion(p_reserva uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare f public.fuentes_datos%rowtype;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if p_reserva is null then raise sqlstate 'PT422' using message='Reserva invalida'; end if;
 select * into f from public.fuentes_datos where codigo='igp' for update;
 if not found or not f.activa then return false; end if;
 if coalesce((f.limites->>'sync_hasta')::timestamptz,'-infinity'::timestamptz)>clock_timestamp()
 or coalesce((f.limites->>'sync_inicio')::timestamptz,'-infinity'::timestamptz)>clock_timestamp()-interval '4 minutes' then
  return false;
 end if;
 update public.fuentes_datos set limites=limites||jsonb_build_object(
  'sync_reserva',p_reserva,'sync_inicio',clock_timestamp(),
  'sync_hasta',clock_timestamp()+interval '290 seconds','sync_estado','ejecutando') where id=f.id;
 return true;
end $$;

create function public.sismocore_finalizar_sincronizacion(p_reserva uuid,p_estado text) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if p_estado is null or p_estado not in ('completada','fallida','omitida') then
  raise sqlstate 'PT422' using message='Estado invalido'; end if;
 update public.fuentes_datos set limites=(limites-'sync_reserva'-'sync_hasta')||jsonb_build_object(
  'sync_estado',p_estado,'sync_fin',clock_timestamp())
 where codigo='igp' and limites->>'sync_reserva'=p_reserva::text;
 return found;
end $$;
revoke all on function public.sismocore_adquirir_sincronizacion(uuid) from public,anon,authenticated;
revoke all on function public.sismocore_finalizar_sincronizacion(uuid,text) from public,anon,authenticated;
grant execute on function public.sismocore_adquirir_sincronizacion(uuid) to service_role;
grant execute on function public.sismocore_finalizar_sincronizacion(uuid,text) to service_role;
update public.fuentes_datos set frecuencia_segundos=300 where codigo='igp';
notify pgrst,'reload schema';
commit;
