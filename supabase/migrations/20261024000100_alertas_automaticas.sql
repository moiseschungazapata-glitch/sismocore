begin;
alter table public.reglas_alerta drop constraint reglas_alerta_canales_check;
alter table public.reglas_alerta add constraint reglas_alerta_canales_check check(cardinality(canales)>0 and canales <@ array['interno','email','sms','webhook','push']::text[]);
alter table public.entregas_alerta drop constraint entregas_alerta_canal_check;
alter table public.entregas_alerta add constraint entregas_alerta_canal_check check(canal in ('interno','email','sms','webhook','push'));
alter table public.reglas_alerta add column vigente_desde timestamptz;
alter table public.entregas_alerta add column dispositivo_id uuid references public.dispositivos_notificacion(id) on delete restrict;
alter table public.entregas_alerta add column evento_id uuid references public.eventos_sismicos(id) on delete restrict;
alter table public.entregas_alerta add column reserva_id uuid;
alter table public.entregas_alerta add constraint entrega_push_destino check(canal<>'push' or (dispositivo_id is not null and evento_id is not null));
create unique index entrega_push_evento_dispositivo on public.entregas_alerta(evento_id,dispositivo_id) where canal='push';

create function public.sismocore_guardar_regla_push(p_actor uuid,p_id uuid,p_nombre text,p_magnitud double precision,
 p_zona jsonb,p_destinatarios uuid[],p_activa boolean,p_version integer,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reglas_alerta%rowtype; fuente uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol in ('administrador','operador')) then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_nombre is null or length(btrim(p_nombre)) not between 1 and 80 or p_magnitud is null or not(p_magnitud between 0 and 10)
  or p_activa is null or p_zona is null or jsonb_typeof(p_zona)<>'object'
  or coalesce(cardinality(p_destinatarios),0) not between 1 and 50
  or exists(select 1 from unnest(p_destinatarios) u where u is null or not exists(select 1 from public.perfiles where id=u and estado='activo')) then
  raise sqlstate 'PT422' using message='Regla invalida'; end if;
 if p_zona <> '{}'::jsonb then
  if (select count(*) from jsonb_object_keys(p_zona))<>3 or not(p_zona ?& array['latitud','longitud','radio_km']) then
   raise sqlstate 'PT422' using message='Zona invalida'; end if;
  if ((p_zona->>'latitud')::double precision between -90 and 90 and (p_zona->>'longitud')::double precision between -180 and 180
    and (p_zona->>'radio_km')::double precision between 10 and 2000) is not true then raise sqlstate 'PT422' using message='Zona invalida'; end if;
 end if;
 select id into fuente from public.fuentes_datos where codigo='igp' and (activa or not p_activa) limit 1;
 if fuente is null then raise sqlstate 'PT409' using message='Fuente IGP no disponible'; end if;
 perform set_config('app.actor_id',p_actor::text,true);
 perform set_config('app.correlacion_id',p_correlacion::text,true);
 if p_id is null then
  if (select count(*) from public.reglas_alerta where canales=array['push'])>=20 then raise sqlstate 'PT409' using message='Maximo veinte reglas'; end if;
  insert into public.reglas_alerta(nombre,fuente_id,magnitud_minima,zona,severidad,canales,destinatarios,plantilla,
   requiere_aprobacion,activa,creado_por,aprobado_por,aprobado_en,vigente_desde)
  values(btrim(p_nombre),fuente,p_magnitud,p_zona,'informativa',array['push'],to_jsonb(p_destinatarios),
   'Aviso de evento reportado por IGP',false,p_activa,p_actor,p_actor,clock_timestamp(),clock_timestamp()) returning * into r;
 else
  update public.reglas_alerta set nombre=btrim(p_nombre),magnitud_minima=p_magnitud,zona=p_zona,
   destinatarios=to_jsonb(p_destinatarios),activa=p_activa,version=version+1,aprobado_por=p_actor,
   aprobado_en=clock_timestamp(),vigente_desde=clock_timestamp()
  where id=p_id and version=p_version and canales=array['push'] returning * into r;
  if not found then raise sqlstate 'PT409' using message='Regla modificada; actualiza la lista'; end if;
 end if;
 return to_jsonb(r);
end $$;

create function public.sismocore_evaluar_reglas_push() returns integer
language plpgsql security definer set search_path='' as $$
declare r public.reglas_alerta%rowtype; e public.eventos_sismicos%rowtype; alerta uuid; total integer:=0; cantidad integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 for r in select reglas.* from public.reglas_alerta reglas join public.perfiles p on p.id=reglas.aprobado_por
  join public.fuentes_datos f on f.id=reglas.fuente_id and f.activa
  where reglas.activa and reglas.canales=array['push'] and reglas.vigente_desde is not null
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
   and exists(select 1 from public.dispositivos_notificacion d join public.perfiles p on p.id=d.usuario_id
    where d.activo and p.estado='activo' and r.destinatarios @> jsonb_build_array(p.id::text))
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
     join public.perfiles p on p.id=d.usuario_id where d.activo and p.estado='activo'
     and r.destinatarios @> jsonb_build_array(p.id::text)
    on conflict do nothing;
   get diagnostics cantidad=row_count;
   total:=total+cantidad;
   if cantidad=0 then update public.alertas set estado='cancelada' where id=alerta; end if;
  end loop;
 end loop;
 return total;
end $$;

create function public.sismocore_reservar_envios_push(p_limite integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare resultado jsonb;
begin
 -- Never automatically retry an interrupted HTTP send: the provider may have accepted it.
 update public.entregas_alerta set estado='fallida',error_codigo='RESULTADO_DESCONOCIDO',reserva_id=null
  where canal='push' and estado='procesando' and ultimo_intento_en<now()-interval '5 minutes';
 update public.entregas_alerta t set estado='cancelada',error_codigo='CANCELADA_O_EXPIRADA'
  where t.canal='push' and t.estado='pendiente' and not exists(
   select 1 from public.alertas a join public.reglas_alerta r on r.id=a.regla_id
    join public.eventos_sismicos e on e.id=a.evento_id join public.dispositivos_notificacion d on d.id=t.dispositivo_id
    join public.perfiles p on p.id=t.usuario_id join public.perfiles gestor on gestor.id=r.aprobado_por
    join public.fuentes_datos f on f.id=r.fuente_id and f.activa
   where a.id=t.alerta_id and r.activa and r.version=a.regla_version and d.activo and d.usuario_id=t.usuario_id
    and p.estado='activo' and gestor.estado='activo' and gestor.rol in ('administrador','operador')
    and e.ocurrido_en>=now()-interval '2 hours');
 with candidatas as (
  select id from public.entregas_alerta where canal='push' and estado='pendiente'
   order by creado_en,id for update skip locked limit greatest(1,least(p_limite,20))
 ), reservadas as (
  update public.entregas_alerta t set estado='procesando',reserva_id=gen_random_uuid(),intentos=intentos+1,
   ultimo_intento_en=clock_timestamp(),historial_intentos=historial_intentos||jsonb_build_array(jsonb_build_object('inicio',clock_timestamp()))
  from candidatas c where c.id=t.id returning t.*
 ) select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'reserva_id',t.reserva_id,'token',d.token,
   'titulo',a.titulo,'mensaje',a.mensaje,'evento_id',t.evento_id)), '[]'::jsonb) into resultado
  from reservadas t join public.dispositivos_notificacion d on d.id=t.dispositivo_id join public.alertas a on a.id=t.alerta_id;
 return resultado;
end $$;

create function public.sismocore_finalizar_envio_push(p_id uuid,p_reserva uuid,p_aceptada boolean,p_codigo text,p_mensaje text)
returns boolean language plpgsql security definer set search_path='' as $$
declare entrega public.entregas_alerta%rowtype;
begin
 if p_codigo is not null and p_codigo not in('UNREGISTERED','INVALID_ARGUMENT','PERMISSION_DENIED','UNAVAILABLE','AUTHENTICATION_ERROR','QUOTA_EXCEEDED') then
  raise sqlstate 'PT422' using message='Codigo invalido'; end if;
 update public.entregas_alerta set estado=case when p_aceptada then 'enviada' else 'fallida' end,
  entregado_en=case when p_aceptada then now() else null end,error_codigo=p_codigo,
  proveedor_mensaje_id=left(p_mensaje,300),reserva_id=null
  where id=p_id and reserva_id=p_reserva and estado='procesando' returning * into entrega;
 if not found then return false; end if;
 if p_codigo='UNREGISTERED' then update public.dispositivos_notificacion set activo=false where id=entrega.dispositivo_id; end if;
 update public.alertas a set estado=case
  when exists(select 1 from public.entregas_alerta t where t.alerta_id=a.id and t.estado in('pendiente','procesando')) then 'enviando'
  when exists(select 1 from public.entregas_alerta t where t.alerta_id=a.id and t.estado='enviada') then 'enviada'
  when exists(select 1 from public.entregas_alerta t where t.alerta_id=a.id and t.estado='fallida') then 'fallida' else 'cancelada' end
  where a.id=entrega.alerta_id;
 insert into public.auditoria(actor_tipo,accion,entidad,entidad_id,resultado,despues)
  values('sistema','notificacion.automatica','entregas_alerta',p_id,case when p_aceptada then 'correcto' else 'error' end,
   jsonb_build_object('estado',case when p_aceptada then 'aceptada' else 'sin_confirmar' end,'motivo',p_codigo));
 return true;
end $$;

revoke all on function public.sismocore_guardar_regla_push(uuid,uuid,text,double precision,jsonb,uuid[],boolean,integer,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_evaluar_reglas_push() from public,anon,authenticated;
revoke all on function public.sismocore_reservar_envios_push(integer) from public,anon,authenticated;
revoke all on function public.sismocore_finalizar_envio_push(uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.sismocore_guardar_regla_push(uuid,uuid,text,double precision,jsonb,uuid[],boolean,integer,uuid) to service_role;
grant execute on function public.sismocore_evaluar_reglas_push() to service_role;
grant execute on function public.sismocore_reservar_envios_push(integer) to service_role;
grant execute on function public.sismocore_finalizar_envio_push(uuid,uuid,boolean,text,text) to service_role;
notify pgrst,'reload schema';
commit;
