-- Fase 2: operaciones administrativas atomicas sobre las tablas existentes.
begin;

create function public.sismocore_actualizar_perfil(
  p_actor_id uuid, p_usuario_id uuid, p_nombre text, p_rol text, p_estado text,
  p_actualizado_en timestamptz, p_correlacion_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor public.perfiles%rowtype; objetivo public.perfiles%rowtype; resultado public.perfiles%rowtype;
begin
  -- Serializa cambios de privilegios, incluso entre distintas instancias de la API.
  perform pg_catalog.pg_advisory_xact_lock(782341209);
  select * into actor from public.perfiles where id = p_actor_id for update;
  if not found or actor.rol <> 'administrador' or actor.estado <> 'activo' then
    raise sqlstate 'PT403' using message = 'No tienes permiso para administrar usuarios.';
  end if;
  select * into objetivo from public.perfiles where id = p_usuario_id for update;
  if not found then raise sqlstate 'PT404' using message = 'La cuenta no existe.'; end if;
  if p_actualizado_en is null or objetivo.actualizado_en <> p_actualizado_en then
    raise sqlstate 'PT409' using message = 'La cuenta cambio. Actualiza la lista y vuelve a intentarlo.';
  end if;
  if p_rol not in ('administrador','analista','operador','auditor','lectura') or
     p_estado not in ('pendiente','activo','suspendido') or
     p_nombre is null or char_length(btrim(p_nombre)) not between 2 and 120 then
    raise sqlstate 'PT422' using message = 'Revisa los datos del perfil.';
  end if;
  if p_actor_id = p_usuario_id and (p_rol <> actor.rol or p_estado <> actor.estado) then
    raise sqlstate 'PT409' using message = 'No puedes cambiar tu propio rol ni suspender tu cuenta.';
  end if;
  if objetivo.rol = 'administrador' and objetivo.estado = 'activo' and
     (p_rol <> 'administrador' or p_estado <> 'activo') and
     (select count(*) from public.perfiles where rol = 'administrador' and estado = 'activo') <= 1 then
    raise sqlstate 'PT409' using message = 'Debe existir al menos un administrador activo.';
  end if;
  -- El trigger existente registra antes/despues con el actor de esta transaccion.
  perform pg_catalog.set_config('app.actor_id',p_actor_id::text,true);
  perform pg_catalog.set_config('app.correlacion_id',p_correlacion_id::text,true);
  update public.perfiles set nombre_completo = btrim(p_nombre), rol = p_rol, estado = p_estado
  where id = p_usuario_id returning * into resultado;
  return to_jsonb(resultado);
end;
$$;

create function public.sismocore_registrar_auditoria(
  p_actor_id uuid, p_accion text, p_entidad text, p_entidad_id uuid,
  p_resultado text, p_detalles jsonb, p_correlacion_id uuid
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare registro uuid; clave text;
begin
  if p_accion not in ('sesion.iniciar','sesion.rechazada','sesion.cerrar',
    'contrasena.actualizar','acceso.denegado','usuario.crear','usuario.creacion_pendiente',
    'usuario.consultar','auditoria.consultar','reporte.exportar') or
     p_entidad not in ('sesiones','perfiles','auditoria','reportes','permisos') or
     p_resultado not in ('correcto','error','denegado') or
     jsonb_typeof(p_detalles) <> 'object' then
    raise sqlstate 'PT422' using message = 'Evento de auditoria invalido.';
  end if;
  -- No admite contrasenas, tokens, correos ni texto libre de busqueda.
  for clave in select jsonb_object_keys(p_detalles) loop
    if clave not in ('rol','estado','permiso','motivo','filas','formato',
      'busqueda_aplicada','magnitud','desde','fecha_corte','pagina') then
      raise sqlstate 'PT422' using message = 'Campo de auditoria no permitido.';
    end if;
  end loop;
  if p_actor_id is not null and not exists(select 1 from public.perfiles where id = p_actor_id) then
    raise sqlstate 'PT422' using message = 'Actor de auditoria invalido.';
  end if;
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,correlacion_id)
  values(p_actor_id,case when p_actor_id is null then 'sistema' else 'usuario' end,
    p_accion,p_entidad,p_entidad_id,p_resultado,p_detalles,p_correlacion_id)
  returning id into registro;
  return registro;
end;
$$;

revoke all on function public.sismocore_actualizar_perfil(uuid,uuid,text,text,text,timestamptz,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_registrar_auditoria(uuid,text,text,uuid,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sismocore_actualizar_perfil(uuid,uuid,text,text,text,timestamptz,uuid) to service_role;
grant execute on function public.sismocore_registrar_auditoria(uuid,text,text,uuid,text,jsonb,uuid) to service_role;

create index auditoria_accion_fecha_idx on public.auditoria(accion,ocurrido_en desc);
create index perfiles_rol_estado_idx on public.perfiles(rol,estado);
notify pgrst, 'reload schema';
commit;
