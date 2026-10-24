begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid(); datos jsonb;
 cuenta text:=repeat('a',64); destino text:=repeat('b',64); i integer;
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
 update public.perfiles set estado='activo',rol=case when id=a then 'administrador' else 'lectura' end where id in(a,b);
 begin
  perform public.sismocore_reservar_prueba_voz(b,cuenta,destino,'1234',ref);
  raise exception 'Rol sin permiso pudo reservar';
 exception when sqlstate 'PT403' then null; end;
 datos:=public.sismocore_reservar_prueba_voz(a,cuenta,destino,'1234',ref);
 if (datos->>'usadas_hoy')::int<>1 or (datos->>'usadas_total')::int<>1 then raise exception 'Contadores incorrectos'; end if;
 begin
  perform public.sismocore_reservar_prueba_voz(a,cuenta,destino,'1234',gen_random_uuid());
  raise exception 'Se ignoro la espera';
 exception when sqlstate 'PT429' then null; end;
 begin
  perform public.sismocore_registrar_estado_voz(b,ref,'queued','CA'||repeat('c',32),null);
  raise exception 'Otro actor modifico resultado';
 exception when sqlstate 'PT404' then null; end;
 perform public.sismocore_registrar_estado_voz(a,ref,'queued','CA'||repeat('c',32),null);
 perform public.sismocore_registrar_estado_voz(a,ref,'completed','CA'||repeat('c',32),null);
 -- Simulate earlier requests without modifying the immutable audit log.
 for i in 1..4 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(a,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),now()-interval '5 minutes');
 end loop;
 begin
  perform public.sismocore_reservar_prueba_voz(a,cuenta,destino,'1234',gen_random_uuid());
  raise exception 'Se ignoro el limite diario';
 exception when sqlstate 'PT409' then null; end;
 cuenta:=repeat('d',64);
 for i in 1..50 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(a,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),now()-interval '2 days');
 end loop;
 begin
  perform public.sismocore_reservar_prueba_voz(a,cuenta,destino,'1234',gen_random_uuid());
  raise exception 'Se ignoro el limite total';
 exception when sqlstate 'PT409' then null; end;
 if has_function_privilege('authenticated','public.sismocore_reservar_prueba_voz(uuid,text,text,text,uuid)','EXECUTE') then raise exception 'RPC expuesta'; end if;
 if exists(select 1 from public.auditoria where entidad='voz_pruebas' and (despues ? 'token' or despues ? 'telefono' or despues ? 'auth_token')) then raise exception 'Datos privados en auditoria'; end if;
end $$;
rollback;
