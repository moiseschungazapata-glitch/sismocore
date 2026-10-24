begin;
-- Preserve existing automatic notifications until an administrator pauses them.
create function public.sismocore_interruptor_push(p_actor uuid,p_activa boolean,p_correlacion uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare actual boolean;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_activa is null then raise sqlstate 'PT422' using message='Estado requerido'; end if;
 select coalesce((limites->>'push_habilitado')::boolean,true) into actual from public.fuentes_datos where codigo='igp' for update;
 if not found then raise sqlstate 'PT409' using message='Fuente IGP no disponible'; end if;
 if actual=p_activa then return p_activa; end if;
 update public.fuentes_datos set limites=limites||jsonb_build_object('push_habilitado',p_activa,'push_desde',clock_timestamp()) where codigo='igp';
 update public.entregas_alerta set estado='cancelada',error_codigo='CAMBIO_INTERRUPTOR'
 where canal='push' and estado='pendiente';
 insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,correlacion_id)
 values(p_actor,'usuario','push.interruptor','fuentes_datos','correcto',jsonb_build_object('activa',p_activa),p_correlacion);
 return p_activa;
end $$;
revoke all on function public.sismocore_interruptor_push(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.sismocore_interruptor_push(uuid,boolean,uuid) to service_role;

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
   and (('push'=any(r.canales) and coalesce((select (f.limites->>'push_habilitado')::boolean from public.fuentes_datos f where f.id=r.fuente_id),true) and eventos.ocurrido_en>=coalesce((select (f.limites->>'push_desde')::timestamptz from public.fuentes_datos f where f.id=r.fuente_id),'-infinity'::timestamptz) and exists(select 1 from public.dispositivos_notificacion d join public.perfiles p on p.id=d.usuario_id
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
     join public.perfiles p on p.id=d.usuario_id where 'push'=any(r.canales) and coalesce((select (f.limites->>'push_habilitado')::boolean from public.fuentes_datos f where f.id=r.fuente_id),true) and e.ocurrido_en>=coalesce((select (f.limites->>'push_desde')::timestamptz from public.fuentes_datos f where f.id=r.fuente_id),'-infinity'::timestamptz) and d.activo and p.estado='activo'
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

create or replace function public.sismocore_reservar_envios_push(p_limite integer default 20) returns jsonb
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
   where coalesce((f.limites->>'push_habilitado')::boolean,true) and e.ocurrido_en>=coalesce((f.limites->>'push_desde')::timestamptz,'-infinity'::timestamptz) and 'push'=any(r.canales) and a.id=t.alerta_id and r.activa and r.version=a.regla_version and d.activo and d.usuario_id=t.usuario_id
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

notify pgrst,'reload schema';
commit;
