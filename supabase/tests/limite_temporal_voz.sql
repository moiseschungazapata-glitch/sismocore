begin;
do $$
declare a uuid:=gen_random_uuid(); cuenta text:=repeat('e',64); i integer; datos jsonb; cuota integer;
begin
 if sismocore_private.limite_diario_voz(date '2026-10-24')<>10
 or sismocore_private.limite_diario_voz(date '2026-10-25')<>5
 or sismocore_private.limite_diario_voz(date '2026-10-23')<>5 then
  raise exception 'La ampliacion no expira correctamente'; end if;
 insert into auth.users(id,email) values(a,a||'@example.invalid');
 update public.perfiles set estado='activo',rol='administrador' where id=a;
 datos:=public.sismocore_limites_voz(cuenta);
 cuota:=sismocore_private.limite_diario_voz((now() at time zone 'America/Lima')::date);
 if (datos->>'limite_diario')::int<>cuota then raise exception 'Contador incoherente'; end if;
 for i in 1..cuota-1 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(a,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima');
 end loop;
 datos:=public.sismocore_reservar_verificacion_voz(a,cuenta,repeat('f',64),'1234',gen_random_uuid());
 if (datos->>'usadas_hoy')::int<>cuota then raise exception 'Ultimo intento permitido no funciona'; end if;
 begin
  perform public.sismocore_reservar_prueba_voz(a,cuenta,repeat('f',64),'1234',gen_random_uuid());
  raise exception 'Se supero la cuota compartida';
 exception when sqlstate 'PT409' then null; end;
 if has_function_privilege('authenticated','sismocore_private.limite_diario_voz(date)','EXECUTE') then
  raise exception 'Funcion privada expuesta'; end if;
end $$;
rollback;
