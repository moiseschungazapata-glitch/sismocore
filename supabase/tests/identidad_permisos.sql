begin;
insert into auth.users(id,email) values
('11111111-1111-4111-8111-111111111111','admin@example.org'),
('22222222-2222-4222-8222-222222222222','second@example.org'),
('33333333-3333-4333-8333-333333333333','reader@example.org');
update public.perfiles set nombre_completo='Administrador',rol='administrador',estado='activo'
where id in ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222');
update public.perfiles set nombre_completo='Lectura',estado='activo'
where id='33333333-3333-4333-8333-333333333333';

do $$
declare version timestamptz; salida jsonb; correlacion uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
begin
  select actualizado_en into version from public.perfiles where id='33333333-3333-4333-8333-333333333333';
  salida := public.sismocore_actualizar_perfil('11111111-1111-4111-8111-111111111111',
    '33333333-3333-4333-8333-333333333333','Nueva Analista','analista','activo',version,correlacion);
  if salida->>'rol' <> 'analista' then raise exception 'No se actualizo el rol'; end if;
  if not exists(select 1 from public.auditoria where actor_id='11111111-1111-4111-8111-111111111111'
    and entidad='perfiles' and entidad_id='33333333-3333-4333-8333-333333333333'
    and correlacion_id=correlacion and antes->>'rol'='lectura' and despues->>'rol'='analista') then
    raise exception 'Falta auditoria atomica del cambio';
  end if;
  begin
    perform public.sismocore_actualizar_perfil('33333333-3333-4333-8333-333333333333',
      '33333333-3333-4333-8333-333333333333','Escalada','administrador','activo',version,correlacion);
    raise exception 'Se permitio escalar privilegios';
  exception when sqlstate 'PT403' then null; end;
  select actualizado_en into version from public.perfiles where id='11111111-1111-4111-8111-111111111111';
  begin
    perform public.sismocore_actualizar_perfil('11111111-1111-4111-8111-111111111111',
      '11111111-1111-4111-8111-111111111111','Administrador','lectura','suspendido',version,correlacion);
    raise exception 'Se permitio perder el acceso propio';
  exception when sqlstate 'PT409' then null; end;
  begin
    perform public.sismocore_actualizar_perfil('11111111-1111-4111-8111-111111111111',
      '33333333-3333-4333-8333-333333333333','Cambio obsoleto','lectura','activo',version - interval '1 second',correlacion);
    raise exception 'Se permitio sobrescribir una version obsoleta';
  exception when sqlstate 'PT409' then null; end;
  select actualizado_en into version from public.perfiles where id='22222222-2222-4222-8222-222222222222';
  perform public.sismocore_actualizar_perfil('11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222','Administrador suspendido','administrador','suspendido',version,correlacion);
  select actualizado_en into version from public.perfiles where id='33333333-3333-4333-8333-333333333333';
  begin
    perform public.sismocore_actualizar_perfil('22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333','Cambio no autorizado','lectura','activo',version,correlacion);
    raise exception 'Una cuenta suspendida administro usuarios';
  exception when sqlstate 'PT403' then null; end;
  begin
    perform public.sismocore_registrar_auditoria(null,'sesion.rechazada','sesiones',null,
      'denegado','{"password":"NO_GUARDAR"}',correlacion);
    raise exception 'Se acepto una credencial en auditoria';
  exception when sqlstate 'PT422' then null; end;
  if has_function_privilege('anon','public.sismocore_actualizar_perfil(uuid,uuid,text,text,text,timestamptz,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.sismocore_actualizar_perfil(uuid,uuid,text,text,text,timestamptz,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.sismocore_registrar_auditoria(uuid,text,text,uuid,text,jsonb,uuid)','EXECUTE') then
    raise exception 'RPC privilegiada expuesta al navegador';
  end if;
end;
$$;
select 'Roles, bloqueo de escalada, suspension, versionado y auditoria atomica comprobados.' as resultado;
rollback;
