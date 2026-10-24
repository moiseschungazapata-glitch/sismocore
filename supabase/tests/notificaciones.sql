begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); d uuid; result jsonb; claim uuid:=gen_random_uuid(); secret text:=repeat('t',70); i int;
begin
  insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
  update public.perfiles set estado='activo' where id in(a,b);
  result:=public.sismocore_registrar_dispositivo(a,secret,'Android',gen_random_uuid());
  d:=(result->>'id')::uuid;
  if result ? 'token' or result ? 'token_hash' then raise exception 'Token expuesto'; end if;
  result:=public.sismocore_registrar_dispositivo(a,secret,'Android',gen_random_uuid());
  if (result->>'id')::uuid<>d then raise exception 'Registro no idempotente'; end if;
  if public.sismocore_desactivar_dispositivo(b,d,gen_random_uuid()) then raise exception 'Revocacion ajena'; end if;
  begin
    perform public.sismocore_preparar_prueba_push(b,d,gen_random_uuid());
    raise exception 'Envio ajeno permitido';
  exception when sqlstate 'PT404' then null; end;
  result:=public.sismocore_preparar_prueba_push(a,d,claim);
  if result->>'token'<>secret then raise exception 'Destinatario incorrecto'; end if;
  begin
    perform public.sismocore_preparar_prueba_push(a,d,gen_random_uuid());
    raise exception 'Cooldown ignorado';
  exception when sqlstate 'PT429' then null; end;
  if public.sismocore_finalizar_prueba_push(b,d,claim,true,null,'test') then raise exception 'Resultado ajeno'; end if;
  if public.sismocore_finalizar_prueba_push(a,d,gen_random_uuid(),true,null,'test') then raise exception 'Resultado sin claim'; end if;
  if not public.sismocore_finalizar_prueba_push(a,d,claim,false,'UNREGISTERED',null) then raise exception 'Sin resultado'; end if;
  if (select activo from public.dispositivos_notificacion where id=d) then raise exception 'Token vencido activo'; end if;
  for i in 1..10 loop
    perform public.sismocore_registrar_dispositivo(a,repeat('z',70)||i,'Prueba',gen_random_uuid());
  end loop;
  begin
    perform public.sismocore_registrar_dispositivo(a,repeat('x',70),'Exceso',gen_random_uuid());
    raise exception 'Limite ignorado';
  exception when sqlstate 'PT409' then null; end;
  perform public.sismocore_registrar_dispositivo(b,secret,'Otro usuario',gen_random_uuid());
  if (select ultima_prueba_estado from public.dispositivos_notificacion where id=d) is not null then raise exception 'Filtracion entre usuarios'; end if;
  update public.perfiles set estado='suspendido' where id=b;
  begin
    perform public.sismocore_preparar_prueba_push(b,d,gen_random_uuid());
    raise exception 'Suspendido permitido';
  exception when sqlstate 'PT403' then null; end;
  if exists(select 1 from public.auditoria where to_jsonb(auditoria)::text like '%'||secret||'%') then raise exception 'Token en auditoria'; end if;
  if has_table_privilege('authenticated','public.dispositivos_notificacion','SELECT') then raise exception 'Token accesible desde navegador'; end if;
  if has_function_privilege('authenticated','public.sismocore_preparar_prueba_push(uuid,uuid,uuid)','EXECUTE') then raise exception 'RPC expuesta'; end if;
end $$;
rollback;
