-- Registra ambos extremos del rango exportado sin crear tablas.
begin;
create or replace function public.sismocore_registrar_auditoria(
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
      'busqueda_aplicada','magnitud','desde','hasta','fecha_corte','pagina') then
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
notify pgrst, 'reload schema';
commit;
