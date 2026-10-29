begin;
do $$
declare actor uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid(); cuenta text:=repeat('a',64);
 destinos jsonb; datos jsonb; i integer;
begin
 insert into auth.users(id,email) values(actor,actor||'@example.invalid'),(reader,reader||'@example.invalid');
 update public.perfiles set estado='activo',rol=case when id=actor then 'administrador' else 'lectura' end where id in(actor,reader);
 if sismocore_private.limite_diario_voz(date '2026-10-30')<>10 then raise exception 'Cuota no permanente'; end if;
 destinos:=jsonb_build_array(jsonb_build_object('destino',repeat('b',64),'ultimos','1234','referencia',gen_random_uuid()),
  jsonb_build_object('destino',repeat('c',64),'ultimos','5678','referencia',gen_random_uuid()));
 begin
  perform public.sismocore_reservar_grupo_voz(reader,cuenta,destinos);
  raise exception 'Rol sin permiso pudo reservar';
 exception when sqlstate 'PT403' then null; end;
 begin
  perform public.sismocore_reservar_grupo_voz(actor,cuenta,jsonb_build_array(destinos->0,destinos->0));
  raise exception 'Destinos duplicados aceptados';
 exception when sqlstate 'PT422' then null; end;
 datos:=public.sismocore_reservar_grupo_voz(actor,cuenta,destinos);
 if (datos->>'usadas_hoy')::int<>2 then raise exception 'El grupo no consume dos intentos'; end if;
 begin
  perform public.sismocore_reservar_prueba_voz(actor,cuenta,repeat('b',64),'1234',gen_random_uuid());
  raise exception 'No se comparte espera con llamada simple';
 exception when sqlstate 'PT429' then null; end;
 begin
  perform public.sismocore_reservar_grupo_voz(actor,cuenta,destinos);
  raise exception 'No se respeta espera entre grupos';
 exception when sqlstate 'PT429' then null; end;
 -- With nine used attempts, neither member of a pair may be reserved.
 cuenta:=repeat('d',64);
 for i in 1..9 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(actor,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),
   date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima');
 end loop;
 begin
  perform public.sismocore_reservar_grupo_voz(actor,cuenta,destinos);
  raise exception 'Se supero cuota diaria';
 exception when sqlstate 'PT409' then null; end;
 datos:=public.sismocore_limites_voz(cuenta);
 if (datos->>'usadas_hoy')::int<>9 then raise exception 'Reserva parcial'; end if;
 -- Eight used attempts allow exactly one pair, reaching ten.
 cuenta:=repeat('e',64);
 for i in 1..8 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(actor,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),
   date_trunc('day',now() at time zone 'America/Lima') at time zone 'America/Lima');
 end loop;
 datos:=public.sismocore_reservar_grupo_voz(actor,cuenta,jsonb_build_array(
  jsonb_set(destinos->0,'{referencia}',to_jsonb(gen_random_uuid()::text)),jsonb_set(destinos->1,'{referencia}',to_jsonb(gen_random_uuid()::text))));
 if (datos->>'usadas_hoy')::int<>10 then raise exception 'No permite llegar a diez'; end if;
 begin
  perform public.sismocore_reservar_prueba_voz(actor,cuenta,repeat('b',64),'1234',gen_random_uuid());
  raise exception 'Permite llamada once';
 exception when sqlstate 'PT409' then null; end;
 cuenta:=repeat('f',64);
 for i in 1..49 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(actor,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),now()-interval '2 days');
 end loop;
 begin
  perform public.sismocore_reservar_grupo_voz(actor,cuenta,destinos);
  raise exception 'Se supero cuota total';
 exception when sqlstate 'PT409' then null; end;
 if has_function_privilege('authenticated','public.sismocore_reservar_grupo_voz(uuid,text,jsonb)','EXECUTE') then
  raise exception 'RPC expuesta'; end if;
end $$;
rollback;
