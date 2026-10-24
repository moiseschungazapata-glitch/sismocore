begin;
create function public.sismocore_reservar_verificacion_voz(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_referencia uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destino is null or p_destino !~ '^[a-f0-9]{64}$'
  or p_ultimos is null or p_ultimos !~ '^[0-9]{4}$' or p_referencia is null then raise sqlstate 'PT422' using message='Solicitud invalida'; end if;
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=5 then raise sqlstate 'PT409' using message='Limite de pruebas'; end if;
 if (limites->>'espera_segundos')::int>0 then raise sqlstate 'PT429' using message='Espera un minuto'; end if;
 insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_referencia,p_actor,'usuario','voz.solicitar','voz_verificaciones',p_referencia,'correcto',
  jsonb_build_object('cuenta',p_cuenta,'destino',p_destino,'ultimos',p_ultimos,'estado','solicitada'),p_referencia);
 return public.sismocore_limites_voz(p_cuenta);
end $$;

revoke all on function public.sismocore_reservar_verificacion_voz(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.sismocore_reservar_verificacion_voz(uuid,text,text,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
