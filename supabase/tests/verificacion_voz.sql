begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid(); cuenta text:=repeat('a',64); destino text:=repeat('b',64); datos jsonb;
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
 update public.perfiles set estado='activo',rol=case when id=a then 'administrador' else 'lectura' end where id in(a,b);
 begin
  perform public.sismocore_reservar_verificacion_voz(b,cuenta,destino,'1234',ref);
  raise exception 'Lectura pudo iniciar verificacion';
 exception when sqlstate 'PT403' then null;end;
 datos:=public.sismocore_reservar_verificacion_voz(a,cuenta,destino,'1234',ref);
 if (datos->>'usadas_hoy')::int<>1 then raise exception 'Verificacion no consume intento compartido';end if;
 begin
  perform public.sismocore_reservar_prueba_voz(a,cuenta,destino,'1234',gen_random_uuid());
  raise exception 'Verificacion no comparte espera';
 exception when sqlstate 'PT429' then null;end;
 perform public.sismocore_registrar_estado_voz(a,ref,'completed','CA'||repeat('c',32),null);
 begin
  perform public.sismocore_configurar_telefono_voz(a,cuenta,destino,'1234',true,gen_random_uuid());
  raise exception 'Verificacion reemplazo la prueba manual requerida';
 exception when sqlstate 'PT422' then null;end;
 if exists(select 1 from public.auditoria where entidad='voz_verificaciones' and (despues ? 'telefono' or despues ? 'codigo')) then raise exception 'Numero o codigo guardado';end if;
 if has_function_privilege('authenticated','public.sismocore_reservar_verificacion_voz(uuid,text,text,text,uuid)','EXECUTE') then raise exception 'Reserva expuesta';end if;
end $$;
rollback;
