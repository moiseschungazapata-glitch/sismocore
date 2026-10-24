begin;
-- Ampliación de pruebas solo el 24/10/2026 (hora de Perú). Expira sin tareas programadas.
create function sismocore_private.limite_diario_voz(p_fecha date) returns integer
language sql immutable set search_path='' as $$
 select case when p_fecha=date '2026-10-24' then 10 else 5 end;
$$;
revoke all on function sismocore_private.limite_diario_voz(date) from public,anon,authenticated;


create or replace function public.sismocore_limites_voz(p_cuenta text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('usadas_total',count(*),'usadas_hoy',count(*) filter(where (ocurrido_en at time zone 'America/Lima')::date=(now() at time zone 'America/Lima')::date),
  'limite_diario',sismocore_private.limite_diario_voz((now() at time zone 'America/Lima')::date),'limite_total',50,'espera_segundos',greatest(0,ceil(60-extract(epoch from now()-max(ocurrido_en)))))
 from public.auditoria where accion='voz.solicitar' and despues->>'cuenta'=p_cuenta;
$$;

create or replace function sismocore_private.reservar_cuota_voz(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_ref uuid,p_automatica boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destino is null or p_destino !~ '^[a-f0-9]{64}$'
  or p_ultimos is null or p_ultimos !~ '^[0-9]{4}$' or p_ref is null then raise sqlstate 'PT422' using message='Solicitud invalida'; end if;
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=(limites->>'limite_diario')::int then raise sqlstate 'PT409' using message='Limite de llamadas'; end if;
 if (limites->>'espera_segundos')::int>0 then raise sqlstate 'PT429' using message='Espera un minuto'; end if;
 insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_ref,p_actor,'usuario','voz.solicitar',case when p_automatica then 'voz_automatica' else 'voz_pruebas' end,p_ref,'correcto',
  jsonb_build_object('cuenta',p_cuenta,'destino',p_destino,'ultimos',p_ultimos,'estado','solicitada'),p_ref);
 return public.sismocore_limites_voz(p_cuenta);
end $$;

create or replace function public.sismocore_reservar_llamada_automatica(p_cuenta text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.entregas_alerta%rowtype; reserva uuid:=gen_random_uuid(); limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 update public.entregas_alerta set estado='fallida',error_codigo='RESULTADO_DESCONOCIDO',reserva_id=null
  where canal='voz' and estado='procesando' and ultimo_intento_en<now()-interval '5 minutes';
 update public.entregas_alerta set estado='cancelada',error_codigo='CANCELADA_O_EXPIRADA'
  where canal='voz' and estado='pendiente' and not sismocore_private.llamada_vigente(id);
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=(limites->>'limite_diario')::int then
  update public.entregas_alerta set estado='cancelada',error_codigo='LIMITE_SISMOCORE'
   where canal='voz' and estado='pendiente' and voz_cuenta_hash=p_cuenta;
  return null;
 end if;
 if (limites->>'espera_segundos')::int>0 then return null; end if;
 select * into t from public.entregas_alerta where canal='voz' and estado='pendiente' and voz_cuenta_hash=p_cuenta
  and sismocore_private.llamada_vigente(id) order by creado_en,id for update skip locked limit 1;
 if not found then return null; end if;
 perform sismocore_private.reservar_cuota_voz(t.usuario_id,p_cuenta,t.voz_destino_hash,t.voz_ultimos,reserva,true);
 update public.entregas_alerta set estado='procesando',reserva_id=reserva,voz_autorizacion=reserva,
  intentos=intentos+1,ultimo_intento_en=clock_timestamp(),
  historial_intentos=historial_intentos||jsonb_build_array(jsonb_build_object('inicio',clock_timestamp())) where id=t.id;
 return jsonb_build_object('id',t.id,'reserva_id',reserva,'destino',t.voz_destino_hash,'usuario_id',t.usuario_id);
end $$;

create or replace function public.sismocore_reservar_verificacion_voz(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_referencia uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destino is null or p_destino !~ '^[a-f0-9]{64}$'
  or p_ultimos is null or p_ultimos !~ '^[0-9]{4}$' or p_referencia is null then raise sqlstate 'PT422' using message='Solicitud invalida'; end if;
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=(limites->>'limite_diario')::int then raise sqlstate 'PT409' using message='Limite de pruebas'; end if;
 if (limites->>'espera_segundos')::int>0 then raise sqlstate 'PT429' using message='Espera un minuto'; end if;
 insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_referencia,p_actor,'usuario','voz.solicitar','voz_verificaciones',p_referencia,'correcto',
  jsonb_build_object('cuenta',p_cuenta,'destino',p_destino,'ultimos',p_ultimos,'estado','solicitada'),p_referencia);
 return public.sismocore_limites_voz(p_cuenta);
end $$;

notify pgrst,'reload schema';
commit;
