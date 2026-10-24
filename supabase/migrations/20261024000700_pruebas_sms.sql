begin;
-- Reuse the append-only audit log: no synthetic earthquake or extra table.
create function public.sismocore_limites_sms(p_cuenta text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('usadas_total',count(*),'usadas_hoy',count(*) filter(where (ocurrido_en at time zone 'America/Lima')::date=(now() at time zone 'America/Lima')::date),
  'limite_diario',5,'limite_total',50,'espera_segundos',greatest(0,ceil(60-extract(epoch from now()-max(ocurrido_en)))))
 from public.auditoria where accion='sms.solicitar' and despues->>'cuenta'=p_cuenta;
$$;

create function public.sismocore_reservar_prueba_sms(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_referencia uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7724));
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destino is null or p_destino !~ '^[a-f0-9]{64}$'
  or p_ultimos is null or p_ultimos !~ '^[0-9]{4}$' or p_referencia is null then raise sqlstate 'PT422' using message='Solicitud invalida'; end if;
 limites:=public.sismocore_limites_sms(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=5 then raise sqlstate 'PT409' using message='Limite de pruebas'; end if;
 if (limites->>'espera_segundos')::int>0 then raise sqlstate 'PT429' using message='Espera un minuto'; end if;
 insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_referencia,p_actor,'usuario','sms.solicitar','sms_pruebas',p_referencia,'correcto',
  jsonb_build_object('cuenta',p_cuenta,'destino',p_destino,'ultimos',p_ultimos,'estado','solicitada'),p_referencia);
 return public.sismocore_limites_sms(p_cuenta);
end $$;

create function public.sismocore_registrar_estado_sms(p_actor uuid,p_referencia uuid,p_estado text,p_sid text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.auditoria where id=p_referencia and actor_id=p_actor and accion='sms.solicitar') then
  raise sqlstate 'PT404' using message='Prueba no disponible'; end if;
 if p_estado is null or p_estado not in ('accepted','queued','sending','sent','delivered','undelivered','failed','canceled','desconocida','rechazada')
  or (p_sid is not null and p_sid !~ '^SM[0-9a-fA-F]{32}$')
  or (p_error is not null and p_error !~ '^[A-Z_0-9]{1,40}$') then raise sqlstate 'PT422' using message='Estado invalido'; end if;
 insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_actor,'usuario','sms.estado','sms_pruebas',p_referencia,
  case when p_estado in ('rechazada','desconocida','failed') then 'error' else 'correcto' end,
  jsonb_build_object('estado',p_estado,'proveedor_id',p_sid,'motivo',p_error),p_referencia);
 return true;
end $$;

revoke all on function public.sismocore_limites_sms(text) from public,anon,authenticated;
revoke all on function public.sismocore_reservar_prueba_sms(uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_registrar_estado_sms(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.sismocore_limites_sms(text) to service_role;
grant execute on function public.sismocore_reservar_prueba_sms(uuid,text,text,text,uuid) to service_role;
grant execute on function public.sismocore_registrar_estado_sms(uuid,uuid,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
