begin;
alter table public.perfiles add column voz_destino_hash text;
alter table public.perfiles add column voz_cuenta_hash text;
alter table public.perfiles add column voz_ultimos text;
alter table public.perfiles add column voz_consentimiento_en timestamptz;
alter table public.perfiles add column voz_activa boolean not null default false;
alter table public.perfiles add constraint perfil_voz_valido check(not voz_activa or (
 voz_destino_hash is not null and voz_destino_hash ~ '^[a-f0-9]{64}$' and voz_cuenta_hash is not null and voz_cuenta_hash ~ '^[a-f0-9]{64}$'
 and voz_ultimos is not null and voz_ultimos ~ '^[0-9]{4}$' and voz_consentimiento_en is not null));
create unique index perfil_telefono_unico on public.perfiles(voz_cuenta_hash,voz_destino_hash) where voz_activa;
alter table public.reglas_alerta drop constraint reglas_alerta_canales_check;
alter table public.reglas_alerta add constraint reglas_alerta_canales_check check(cardinality(canales)>0 and canales <@ array['interno','email','sms','webhook','push','voz']::text[]);
alter table public.entregas_alerta drop constraint entregas_alerta_canal_check;
alter table public.entregas_alerta add constraint entregas_alerta_canal_check check(canal in('interno','email','sms','webhook','push','voz'));
alter table public.entregas_alerta add column voz_destino_hash text;
alter table public.entregas_alerta add column voz_cuenta_hash text;
alter table public.entregas_alerta add column voz_ultimos text;
alter table public.entregas_alerta add column voz_autorizacion uuid;
alter table public.entregas_alerta add column estado_proveedor text;
alter table public.entregas_alerta add constraint entrega_voz_valida check(canal<>'voz' or (evento_id is not null and usuario_id is not null
 and voz_destino_hash is not null and voz_cuenta_hash is not null and voz_ultimos is not null));
create unique index llamada_evento_telefono_unico on public.entregas_alerta(evento_id,voz_cuenta_hash,voz_destino_hash) where canal='voz';

create function public.sismocore_guardar_regla_alerta(p_actor uuid,p_id uuid,p_nombre text,p_magnitud double precision,
 p_zona jsonb,p_destinatarios uuid[],p_activa boolean,p_version integer,p_correlacion uuid,p_canales text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reglas_alerta%rowtype; fuente uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol in ('administrador','operador')) then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_nombre is null or length(btrim(p_nombre)) not between 1 and 80 or p_magnitud is null or not(p_magnitud between 0 and 10)
  or p_activa is null or p_zona is null or jsonb_typeof(p_zona)<>'object'
  or coalesce(cardinality(p_destinatarios),0) not between 1 and 50
  or exists(select 1 from unnest(p_destinatarios) u where u is null)
  or (p_activa and exists(select 1 from unnest(p_destinatarios) u where not exists(select 1 from public.perfiles where id=u and estado='activo'))) then
  raise sqlstate 'PT422' using message='Regla invalida'; end if;
 if p_zona <> '{}'::jsonb then
  if (select count(*) from jsonb_object_keys(p_zona))<>3 or not(p_zona ?& array['latitud','longitud','radio_km']) then
   raise sqlstate 'PT422' using message='Zona invalida'; end if;
  if ((p_zona->>'latitud')::double precision between -90 and 90 and (p_zona->>'longitud')::double precision between -180 and 180
    and (p_zona->>'radio_km')::double precision between 10 and 2000) is not true then raise sqlstate 'PT422' using message='Zona invalida'; end if;
 end if;
 select id into fuente from public.fuentes_datos where codigo='igp' and (activa or not p_activa) limit 1;
 if fuente is null then raise sqlstate 'PT409' using message='Fuente IGP no disponible'; end if;
 if p_canales is null or cardinality(p_canales) not between 1 and 2 or not(p_canales <@ array['push','voz']::text[])
  or cardinality(p_canales)<>(select count(distinct c) from unnest(p_canales)c) then raise sqlstate 'PT422' using message='Canal invalido'; end if;
 if ('voz'=any(p_canales) or exists(select 1 from public.reglas_alerta where id=p_id and 'voz'=any(canales)))
  and not exists(select 1 from public.perfiles where id=p_actor and rol='administrador') then raise sqlstate 'PT403' using message='Solo administrador configura voz'; end if;
 if p_activa and 'voz'=any(p_canales) and exists(select 1 from unnest(p_destinatarios) u where not exists(
  select 1 from public.perfiles where id=u and rol='administrador' and voz_activa and voz_consentimiento_en is not null)) then
  raise sqlstate 'PT422' using message='Falta consentimiento de voz'; end if;
 perform set_config('app.actor_id',p_actor::text,true);
 perform set_config('app.correlacion_id',p_correlacion::text,true);
 if p_id is null then
  if (select count(*) from public.reglas_alerta where canales <@ array['push','voz']::text[])>=20 then raise sqlstate 'PT409' using message='Maximo veinte reglas'; end if;
  insert into public.reglas_alerta(nombre,fuente_id,magnitud_minima,zona,severidad,canales,destinatarios,plantilla,
   requiere_aprobacion,activa,creado_por,aprobado_por,aprobado_en,vigente_desde)
  values(btrim(p_nombre),fuente,p_magnitud,p_zona,'informativa',p_canales,to_jsonb(p_destinatarios),
   'Aviso de evento reportado por IGP',false,p_activa,p_actor,p_actor,clock_timestamp(),clock_timestamp()) returning * into r;
 else
  update public.reglas_alerta set nombre=btrim(p_nombre),magnitud_minima=p_magnitud,zona=p_zona,
   canales=p_canales,destinatarios=to_jsonb(p_destinatarios),activa=p_activa,version=version+1,aprobado_por=p_actor,
   aprobado_en=clock_timestamp(),vigente_desde=clock_timestamp()
  where id=p_id and version=p_version and canales <@ array['push','voz']::text[] returning * into r;
  if not found then raise sqlstate 'PT409' using message='Regla modificada; actualiza la lista'; end if;
 end if;
 return to_jsonb(r);
end $$;

create function public.sismocore_configurar_telefono_voz(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_activa boolean,p_correlacion uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_activa then
  if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destino is null or p_destino !~ '^[a-f0-9]{64}$'
   or p_ultimos is null or p_ultimos !~ '^[0-9]{4}$' then raise sqlstate 'PT422' using message='Telefono invalido'; end if;
  if not exists(select 1 from public.auditoria solicitud join public.auditoria resultado on resultado.entidad_id=solicitud.id
   where solicitud.actor_id=p_actor and solicitud.accion='voz.solicitar' and solicitud.entidad='voz_pruebas'
   and solicitud.despues->>'cuenta'=p_cuenta and solicitud.despues->>'destino'=p_destino
   and resultado.actor_id=p_actor and resultado.accion='voz.estado' and resultado.despues->>'estado'='completed') then
   raise sqlstate 'PT422' using message='Completa antes una prueba manual'; end if;
  if exists(select 1 from public.perfiles where id<>p_actor and voz_activa and voz_cuenta_hash=p_cuenta and voz_destino_hash=p_destino) then
   raise sqlstate 'PT409' using message='Telefono ya vinculado'; end if;
  update public.perfiles set voz_cuenta_hash=p_cuenta,voz_destino_hash=p_destino,voz_ultimos=p_ultimos,
   voz_activa=true,voz_consentimiento_en=clock_timestamp() where id=p_actor;
 else
  update public.perfiles set voz_activa=false where id=p_actor;
 end if;
 update public.entregas_alerta set estado='cancelada',error_codigo='CONSENTIMIENTO_CAMBIADO'
  where usuario_id=p_actor and canal='voz' and estado='pendiente';
 insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_actor,'usuario','voz.consentimiento','perfiles',p_actor,'correcto',jsonb_build_object('activa',p_activa),p_correlacion);
 return true;
end $$;

create function public.sismocore_interruptor_voz(p_actor uuid,p_cuenta text,p_activa boolean,p_correlacion uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_activa is null or p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' then raise sqlstate 'PT422' using message='Configuracion invalida'; end if;
 update public.fuentes_datos set limites=limites||jsonb_build_object('voz_habilitada',p_activa,'voz_cuenta',p_cuenta,'voz_desde',clock_timestamp()) where codigo='igp';
 if not found then raise sqlstate 'PT409' using message='Fuente IGP no disponible'; end if;
 update public.entregas_alerta set estado='cancelada',error_codigo='CAMBIO_INTERRUPTOR'
  where canal='voz' and estado='pendiente';
 insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,correlacion_id)
 values(p_actor,'usuario','voz.interruptor','fuentes_datos','correcto',jsonb_build_object('activa',p_activa),p_correlacion);
 return p_activa;
end $$;

create function sismocore_private.reservar_cuota_voz(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_ref uuid,p_automatica boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_cuenta is null or p_cuenta !~ '^[a-f0-9]{64}$' or p_destino is null or p_destino !~ '^[a-f0-9]{64}$'
  or p_ultimos is null or p_ultimos !~ '^[0-9]{4}$' or p_ref is null then raise sqlstate 'PT422' using message='Solicitud invalida'; end if;
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=5 then raise sqlstate 'PT409' using message='Limite de llamadas'; end if;
 if (limites->>'espera_segundos')::int>0 then raise sqlstate 'PT429' using message='Espera un minuto'; end if;
 insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
 values(p_ref,p_actor,'usuario','voz.solicitar',case when p_automatica then 'voz_automatica' else 'voz_pruebas' end,p_ref,'correcto',
  jsonb_build_object('cuenta',p_cuenta,'destino',p_destino,'ultimos',p_ultimos,'estado','solicitada'),p_ref);
 return public.sismocore_limites_voz(p_cuenta);
end $$;

create or replace function public.sismocore_reservar_prueba_voz(p_actor uuid,p_cuenta text,p_destino text,p_ultimos text,p_referencia uuid)
returns jsonb language sql security definer set search_path='' as $$
 select sismocore_private.reservar_cuota_voz(p_actor,p_cuenta,p_destino,p_ultimos,p_referencia,false);
$$;

create function sismocore_private.destinatarios_voz(p_regla uuid,p_evento uuid) returns setof public.perfiles
language sql stable security definer set search_path='' as $$
 select p.* from public.perfiles p join public.reglas_alerta r on r.id=p_regla
 join public.eventos_sismicos e on e.id=p_evento and e.fuente_id=r.fuente_id
 join public.fuentes_datos f on f.id=r.fuente_id join public.perfiles gestor on gestor.id=r.aprobado_por
 where r.activa and 'voz'=any(r.canales) and gestor.estado='activo' and gestor.rol='administrador' and f.activa
  and f.limites->>'voz_habilitada'='true' and f.limites->>'voz_desde' is not null
  and p.estado='activo' and p.rol='administrador' and p.voz_activa and p.voz_consentimiento_en is not null
  and p.voz_cuenta_hash=f.limites->>'voz_cuenta' and r.destinatarios @> jsonb_build_array(p.id::text)
  and e.magnitud>=r.magnitud_minima and e.recibido_en>=r.vigente_desde
  and e.ocurrido_en>=greatest(r.vigente_desde,p.voz_consentimiento_en,(f.limites->>'voz_desde')::timestamptz)
  and e.ocurrido_en>=now()-interval '2 hours' and e.ocurrido_en<=now();
$$;

create function sismocore_private.llamada_vigente(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.entregas_alerta t join public.alertas a on a.id=t.alerta_id
  join public.reglas_alerta r on r.id=a.regla_id
  join sismocore_private.destinatarios_voz(a.regla_id,a.evento_id) p on p.id=t.usuario_id
  where t.id=p_id and t.canal='voz' and r.version=a.regla_version
   and p.voz_destino_hash=t.voz_destino_hash and p.voz_cuenta_hash=t.voz_cuenta_hash);
$$;

create or replace function public.sismocore_evaluar_reglas_push() returns integer
language plpgsql security definer set search_path='' as $$
declare r public.reglas_alerta%rowtype; e public.eventos_sismicos%rowtype; alerta uuid; total integer:=0; cantidad integer; cantidad_voz integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 for r in select reglas.* from public.reglas_alerta reglas join public.perfiles p on p.id=reglas.aprobado_por
  join public.fuentes_datos f on f.id=reglas.fuente_id and f.activa
  where reglas.activa and reglas.canales <@ array['push','voz']::text[] and reglas.vigente_desde is not null
   and p.estado='activo' and p.rol in ('administrador','operador') order by reglas.creado_en,reglas.id
 loop
  for e in select eventos.* from public.eventos_sismicos eventos where eventos.fuente_id=r.fuente_id
   and eventos.magnitud>=r.magnitud_minima and eventos.recibido_en>=r.vigente_desde
   and eventos.ocurrido_en>=r.vigente_desde and eventos.ocurrido_en>=now()-interval '2 hours' and eventos.ocurrido_en<=now()
   and not exists(select 1 from public.alertas a where a.evento_id=eventos.id and a.regla_id=r.id)
   and (r.zona='{}'::jsonb or 6371*acos(least(1.0,greatest(-1.0,
     sin(radians(eventos.latitud))*sin(radians((r.zona->>'latitud')::double precision))+
     cos(radians(eventos.latitud))*cos(radians((r.zona->>'latitud')::double precision))*
     cos(radians(eventos.longitud-(r.zona->>'longitud')::double precision)))))<=(r.zona->>'radio_km')::double precision)
   and (('push'=any(r.canales) and exists(select 1 from public.dispositivos_notificacion d join public.perfiles p on p.id=d.usuario_id
    where d.activo and p.estado='activo' and r.destinatarios @> jsonb_build_array(p.id::text)))
    or exists(select 1 from sismocore_private.destinatarios_voz(r.id,eventos.id)))
   order by eventos.ocurrido_en desc limit 100
  loop
   insert into public.alertas(evento_id,regla_id,regla_version,severidad,titulo,mensaje,url_fuente,contexto,estado,aprobado_por,aprobado_en)
   values(e.id,r.id,r.version,r.severidad,'IGP · Sismo reportado M '||e.magnitud,
    left(e.lugar,200)||' · '||to_char(e.ocurrido_en at time zone 'America/Lima','DD/MM HH24:MI')||' (Peru). Evento ya ocurrido; no es una prediccion ni una alerta oficial.',
    'https://ultimosismo.igp.gob.pe/evento/'||e.id_externo,
    jsonb_build_object('magnitud',e.magnitud,'lugar',e.lugar,'ocurrido_en',e.ocurrido_en,'regla',r.nombre),
    'aprobada',r.aprobado_por,now()) returning id into alerta;
   insert into public.entregas_alerta(alerta_id,canal,destinatario,usuario_id,dispositivo_id,evento_id)
    select alerta,'push',d.id::text,d.usuario_id,d.id,e.id from public.dispositivos_notificacion d
     join public.perfiles p on p.id=d.usuario_id where 'push'=any(r.canales) and d.activo and p.estado='activo'
     and r.destinatarios @> jsonb_build_array(p.id::text)
    on conflict do nothing;
   get diagnostics cantidad=row_count;
   cantidad_voz:=0;
   if 'voz'=any(r.canales) then
    insert into public.entregas_alerta(alerta_id,canal,destinatario,usuario_id,evento_id,voz_cuenta_hash,voz_destino_hash,voz_ultimos)
     select alerta,'voz',p.voz_destino_hash,p.id,e.id,p.voz_cuenta_hash,p.voz_destino_hash,p.voz_ultimos
     from sismocore_private.destinatarios_voz(r.id,e.id) p on conflict do nothing;
    get diagnostics cantidad_voz=row_count;
   end if;
   total:=total+cantidad+cantidad_voz;
   if cantidad+cantidad_voz=0 then update public.alertas set estado='cancelada' where id=alerta; end if;
  end loop;
 end loop;
 return total;
end $$;

create function public.sismocore_reservar_llamada_automatica(p_cuenta text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t public.entregas_alerta%rowtype; reserva uuid:=gen_random_uuid(); limites jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_cuenta,7624));
 update public.entregas_alerta set estado='fallida',error_codigo='RESULTADO_DESCONOCIDO',reserva_id=null
  where canal='voz' and estado='procesando' and ultimo_intento_en<now()-interval '5 minutes';
 update public.entregas_alerta set estado='cancelada',error_codigo='CANCELADA_O_EXPIRADA'
  where canal='voz' and estado='pendiente' and not sismocore_private.llamada_vigente(id);
 limites:=public.sismocore_limites_voz(p_cuenta);
 if (limites->>'usadas_total')::int>=50 or (limites->>'usadas_hoy')::int>=5 then
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

create function sismocore_private.estado_alerta(p_id uuid) returns void
language sql security definer set search_path='' as $$
 update public.alertas a set estado=case
  when exists(select 1 from public.entregas_alerta t where t.alerta_id=a.id and t.estado in('pendiente','procesando')) then 'enviando'
  when exists(select 1 from public.entregas_alerta t where t.alerta_id=a.id and t.estado='enviada') then 'enviada'
  when exists(select 1 from public.entregas_alerta t where t.alerta_id=a.id and t.estado='fallida') then 'fallida' else 'cancelada' end
 where a.id=p_id;
$$;

create function public.sismocore_finalizar_llamada_automatica(p_id uuid,p_reserva uuid,p_estado text,p_sid text,p_error text)
returns boolean language plpgsql security definer set search_path='' as $$
declare t public.entregas_alerta%rowtype;
begin
 if p_estado is null or p_estado not in ('queued','initiated','ringing','in-progress','completed','busy','failed','no-answer','canceled','desconocida','rechazada')
  or (p_sid is not null and p_sid !~ '^CA[0-9a-fA-F]{32}$')
  or (p_error is not null and p_error !~ '^[A-Z_0-9]{1,40}$') then raise sqlstate 'PT422' using message='Estado invalido'; end if;
 update public.entregas_alerta set estado=case when p_estado in('desconocida','rechazada','failed','no-answer','busy') then 'fallida'
   when p_estado='canceled' then 'cancelada' else 'enviada' end,
  entregado_en=case when p_sid is not null then now() else null end,estado_proveedor=p_estado,
  proveedor_mensaje_id=p_sid,error_codigo=p_error,reserva_id=null
  where id=p_id and reserva_id=p_reserva and canal='voz' and estado='procesando' returning * into t;
 if not found then return false; end if;
 perform public.sismocore_registrar_estado_voz(t.usuario_id,p_reserva,p_estado,p_sid,p_error);
 perform sismocore_private.estado_alerta(t.alerta_id);
 return true;
end $$;

create function public.sismocore_actualizar_llamada_automatica(p_id uuid,p_sid text,p_estado text) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.entregas_alerta%rowtype;
begin
 if p_estado is null or p_estado not in('queued','initiated','ringing','in-progress','completed','busy','failed','no-answer','canceled') then
  raise sqlstate 'PT422' using message='Estado invalido'; end if;
 update public.entregas_alerta set estado_proveedor=p_estado,
  estado=case when p_estado in('busy','failed','no-answer') then 'fallida' when p_estado='canceled' then 'cancelada' else 'enviada' end
 where id=p_id and canal='voz' and proveedor_mensaje_id=p_sid
  and estado_proveedor in('queued','initiated','ringing','in-progress') and estado_proveedor<>p_estado returning * into t;
 if not found then return false; end if;
 perform sismocore_private.estado_alerta(t.alerta_id);
 return true;
end $$;

create function public.sismocore_contenido_llamada(p_id uuid,p_clave uuid,p_cuenta text) returns jsonb
language sql stable security definer set search_path='' as $$
 select a.contexto from public.entregas_alerta t join public.alertas a on a.id=t.alerta_id
 where t.id=p_id and t.canal='voz' and t.voz_autorizacion=p_clave and t.voz_cuenta_hash=p_cuenta
  and t.estado in('procesando','enviada') and sismocore_private.llamada_vigente(t.id);
$$;

revoke all on function public.sismocore_guardar_regla_alerta(uuid,uuid,text,double precision,jsonb,uuid[],boolean,integer,uuid,text[]) from public,anon,authenticated;
revoke all on function public.sismocore_configurar_telefono_voz(uuid,text,text,text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_interruptor_voz(uuid,text,boolean,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_reservar_llamada_automatica(text) from public,anon,authenticated;
revoke all on function public.sismocore_finalizar_llamada_automatica(uuid,uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.sismocore_actualizar_llamada_automatica(uuid,text,text) from public,anon,authenticated;
revoke all on function public.sismocore_contenido_llamada(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sismocore_guardar_regla_alerta(uuid,uuid,text,double precision,jsonb,uuid[],boolean,integer,uuid,text[]) to service_role;
grant execute on function public.sismocore_configurar_telefono_voz(uuid,text,text,text,boolean,uuid) to service_role;
grant execute on function public.sismocore_interruptor_voz(uuid,text,boolean,uuid) to service_role;
grant execute on function public.sismocore_reservar_llamada_automatica(text) to service_role;
grant execute on function public.sismocore_finalizar_llamada_automatica(uuid,uuid,text,text,text) to service_role;
grant execute on function public.sismocore_actualizar_llamada_automatica(uuid,text,text) to service_role;
grant execute on function public.sismocore_contenido_llamada(uuid,uuid,text) to service_role;
revoke all on function sismocore_private.reservar_cuota_voz(uuid,text,text,text,uuid,boolean) from public,anon,authenticated;
revoke all on function sismocore_private.destinatarios_voz(uuid,uuid) from public,anon,authenticated;
revoke all on function sismocore_private.llamada_vigente(uuid) from public,anon,authenticated;
revoke all on function sismocore_private.estado_alerta(uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
