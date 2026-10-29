begin;

-- Permanent daily quota, shared by manual, verification and automatic calls.
create or replace function sismocore_private.limite_diario_voz(p_fecha date) returns integer
language sql immutable set search_path='' as $$ select 10; $$;

create function public.sismocore_reservar_grupo_voz(p_actor uuid,p_cuenta text,p_destinos jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limites jsonb; destino jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destinos is null or jsonb_typeof(p_destinos)<>'array' then
  raise sqlstate 'PT422' using message='Solicitud invalida'; end if;
 if jsonb_array_length(p_destinos)<>2 then raise sqlstate 'PT422' using message='Se requieren dos destinos'; end if;
 for destino in select value from jsonb_array_elements(p_destinos) loop
  if jsonb_typeof(destino)<>'object' or coalesce(destino->>'destino','') !~ '^[a-f0-9]{64}$'
   or coalesce(destino->>'ultimos','') !~ '^[0-9]{4}$'
   or coalesce(destino->>'referencia','') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
   raise sqlstate 'PT422' using message='Destino invalido'; end if;
 end loop;
 if (select count(distinct value->>'destino') from jsonb_array_elements(p_destinos))<>2
  or (select count(distinct value->>'referencia') from jsonb_array_elements(p_destinos))<>2 then
  raise sqlstate 'PT422' using message='Destinos o referencias repetidos'; end if;
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int+2>(limites->>'limite_total')::int
  or (limites->>'usadas_hoy')::int+2>(limites->>'limite_diario')::int then
  raise sqlstate 'PT409' using message='No hay cuota para dos llamadas'; end if;
 if (limites->>'espera_segundos')::int>0 then raise sqlstate 'PT429' using message='Espera un minuto'; end if;
 for destino in select value from jsonb_array_elements(p_destinos) loop
  insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
  values((destino->>'referencia')::uuid,p_actor,'usuario','voz.solicitar','voz_pruebas',(destino->>'referencia')::uuid,'correcto',
   jsonb_build_object('cuenta',p_cuenta,'destino',destino->>'destino','ultimos',destino->>'ultimos','estado','solicitada'),
   (destino->>'referencia')::uuid);
 end loop;
 return public.sismocore_limites_voz(p_cuenta);
end $$;

revoke all on function public.sismocore_reservar_grupo_voz(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.sismocore_reservar_grupo_voz(uuid,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
