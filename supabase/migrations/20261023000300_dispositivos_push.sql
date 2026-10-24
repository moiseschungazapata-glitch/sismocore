begin;

create table public.dispositivos_notificacion (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references public.perfiles(id) on delete cascade,
  token text not null check (length(token) between 50 and 4096),
  token_hash text not null unique,
  etiqueta text not null check (length(btrim(etiqueta)) between 1 and 80),
  activo boolean not null default true,
  registrado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  ultima_prueba_en timestamptz,
  ultima_prueba_estado text check (ultima_prueba_estado in ('pendiente','aceptada','fallida')),
  ultima_prueba_id uuid,
  ultimo_error_codigo text,
  ultimo_mensaje_id text
);
create index dispositivos_usuario_idx on public.dispositivos_notificacion(usuario_id,activo);
alter table public.dispositivos_notificacion enable row level security;
revoke all on public.dispositivos_notificacion from public,anon,authenticated;
grant select,insert,update,delete on public.dispositivos_notificacion to service_role;
-- Tokens are server-only. Personal metadata is read through the authenticated API.

create function public.sismocore_registrar_dispositivo(p_usuario_id uuid,p_token text,p_etiqueta text,p_correlacion_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare registro public.dispositivos_notificacion%rowtype; huella text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_usuario_id::text,91));
  if not exists(select 1 from public.perfiles where id=p_usuario_id and estado='activo') then
    raise sqlstate 'PT403' using message='Cuenta no activa'; end if;
  if p_token is null or length(p_token) not between 50 and 4096 or p_token !~ '^[A-Za-z0-9_:.-]+$'
     or p_etiqueta is null or length(btrim(p_etiqueta)) not between 1 and 80 then
    raise sqlstate 'PT422' using message='Dispositivo invalido'; end if;
  huella := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token,'UTF8')),'hex');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(huella,92));
  if (select count(*) from public.dispositivos_notificacion where usuario_id=p_usuario_id and activo and token_hash<>huella)>=10 then
    raise sqlstate 'PT409' using message='Limite de dispositivos alcanzado'; end if;
  insert into public.dispositivos_notificacion(usuario_id,token,token_hash,etiqueta)
  values(p_usuario_id,p_token,huella,btrim(p_etiqueta))
  on conflict(token_hash) do update set usuario_id=excluded.usuario_id,token=excluded.token,
    etiqueta=excluded.etiqueta,activo=true,actualizado_en=clock_timestamp(),ultima_prueba_id=null,
    ultima_prueba_en=case when dispositivos_notificacion.usuario_id=excluded.usuario_id then dispositivos_notificacion.ultima_prueba_en else null end,
    ultima_prueba_estado=case when dispositivos_notificacion.usuario_id=excluded.usuario_id then dispositivos_notificacion.ultima_prueba_estado else null end,
    ultimo_error_codigo=null,ultimo_mensaje_id=null
  returning * into registro;
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
  values(p_usuario_id,'usuario','notificacion.activar','dispositivos_notificacion',registro.id,'correcto','{"estado":"activo"}',p_correlacion_id);
  return to_jsonb(registro)-'token'-'token_hash'-'ultima_prueba_id';
end;
$$;

create function public.sismocore_desactivar_dispositivo(p_usuario_id uuid,p_dispositivo_id uuid,p_correlacion_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.dispositivos_notificacion set activo=false,actualizado_en=clock_timestamp(),ultima_prueba_id=null
  where id=p_dispositivo_id and usuario_id=p_usuario_id and activo;
  if not found then return false; end if;
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
  values(p_usuario_id,'usuario','notificacion.desactivar','dispositivos_notificacion',p_dispositivo_id,'correcto','{"estado":"inactivo"}',p_correlacion_id);
  return true;
end;
$$;

create function public.sismocore_preparar_prueba_push(p_usuario_id uuid,p_dispositivo_id uuid,p_correlacion_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare registro public.dispositivos_notificacion%rowtype; ahora timestamptz := clock_timestamp();
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_usuario_id::text,91));
  if not exists(select 1 from public.perfiles where id=p_usuario_id and estado='activo') then
    raise sqlstate 'PT403' using message='Cuenta no activa'; end if;
  select * into registro from public.dispositivos_notificacion where id=p_dispositivo_id and usuario_id=p_usuario_id and activo for update;
  if not found then raise sqlstate 'PT404' using message='Dispositivo no disponible'; end if;
  if exists(select 1 from public.dispositivos_notificacion where usuario_id=p_usuario_id and ultima_prueba_en>ahora-interval '60 seconds') then
    raise sqlstate 'PT429' using message='Espera un minuto entre pruebas'; end if;
  update public.dispositivos_notificacion set ultima_prueba_en=ahora,ultima_prueba_estado='pendiente',
    ultima_prueba_id=p_correlacion_id,ultimo_error_codigo=null,ultimo_mensaje_id=null,actualizado_en=ahora
  where id=registro.id;
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
  values(p_usuario_id,'usuario','notificacion.prueba_solicitada','dispositivos_notificacion',registro.id,'correcto','{"estado":"pendiente"}',p_correlacion_id);
  return jsonb_build_object('token',registro.token,'prueba_id',p_correlacion_id);
end;
$$;

create function public.sismocore_finalizar_prueba_push(p_usuario_id uuid,p_dispositivo_id uuid,p_prueba_id uuid,
  p_aceptada boolean,p_error_codigo text,p_mensaje_id text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_error_codigo is not null and p_error_codigo not in ('UNREGISTERED','INVALID_ARGUMENT','PERMISSION_DENIED','UNAVAILABLE','AUTHENTICATION_ERROR','QUOTA_EXCEEDED') then
    raise sqlstate 'PT422' using message='Resultado invalido'; end if;
  update public.dispositivos_notificacion set ultima_prueba_estado=case when p_aceptada then 'aceptada' else 'fallida' end,
    ultimo_error_codigo=p_error_codigo,ultimo_mensaje_id=left(p_mensaje_id,300),actualizado_en=clock_timestamp(),ultima_prueba_id=null,
    activo=case when p_error_codigo='UNREGISTERED' then false else activo end
  where id=p_dispositivo_id and usuario_id=p_usuario_id and ultima_prueba_id=p_prueba_id;
  if not found then return false; end if;
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
  values(p_usuario_id,'usuario','notificacion.prueba_resultado','dispositivos_notificacion',p_dispositivo_id,
    case when p_aceptada then 'correcto' else 'error' end,
    jsonb_build_object('estado',case when p_aceptada then 'aceptada' else 'fallida' end,'motivo',p_error_codigo),p_prueba_id);
  return true;
end;
$$;

revoke all on function public.sismocore_registrar_dispositivo(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_desactivar_dispositivo(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_preparar_prueba_push(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_finalizar_prueba_push(uuid,uuid,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.sismocore_registrar_dispositivo(uuid,text,text,uuid) to service_role;
grant execute on function public.sismocore_desactivar_dispositivo(uuid,uuid,uuid) to service_role;
grant execute on function public.sismocore_preparar_prueba_push(uuid,uuid,uuid) to service_role;
grant execute on function public.sismocore_finalizar_prueba_push(uuid,uuid,uuid,boolean,text,text) to service_role;
notify pgrst,'reload schema';
commit;
