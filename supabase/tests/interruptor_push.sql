begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); fuente uuid; ingesta uuid:=gen_random_uuid();
 evento uuid:=gen_random_uuid(); regla uuid; dispositivo uuid; datos jsonb; inicio text;
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
 update public.perfiles set estado='activo',rol=case when id=a then 'administrador' else 'operador' end where id in(a,b);
 insert into public.fuentes_datos(codigo,nombre,organizacion,url_api) values('igp','IGP prueba','Prueba','https://example.invalid') on conflict(codigo) do nothing;
 select id into fuente from public.fuentes_datos where codigo='igp';
 datos:=public.sismocore_registrar_dispositivo(a,repeat('p',70),'Android',gen_random_uuid()); dispositivo:=(datos->>'id')::uuid;
 datos:=public.sismocore_guardar_regla_alerta(a,null,'Avisos',4,'{}',array[a],true,null,gen_random_uuid(),array['push']); regla:=(datos->>'id')::uuid;
 update public.reglas_alerta set vigente_desde=now()-interval '15 minutes' where id=regla;
 insert into public.ejecuciones_ingesta(id,fuente_id) values(ingesta,fuente);
 insert into public.eventos_sismicos(id,fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(evento,fuente,'TEST-PUSH-INITIAL',now()-interval '5 minutes',-12,-77,5,20,'Inicial','https://example.invalid',repeat('a',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'Cambio comportamiento previo'; end if;
 begin
  perform public.sismocore_interruptor_push(b,false,gen_random_uuid());
  raise exception 'Operador modifico control general';
 exception when sqlstate 'PT403' then null; end;
 perform public.sismocore_interruptor_push(a,false,gen_random_uuid());
 if exists(select 1 from public.entregas_alerta where canal='push' and estado='pendiente') then raise exception 'Pendientes siguen activos'; end if;
 if public.sismocore_reservar_envios_push(5)<>'[]'::jsonb then raise exception 'Reserva con control apagado'; end if;
 if (select limites->>'voz_habilitada' from public.fuentes_datos where id=fuente) is not null then raise exception 'Cambio llamadas'; end if;
 -- Manual tests still work while automatic notifications are paused.
 datos:=public.sismocore_preparar_prueba_push(a,dispositivo,gen_random_uuid());
 if datos->>'token'<>repeat('p',70) then raise exception 'Se bloquearon pruebas manuales'; end if;
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-PUSH-PAUSED',now()-interval '2 minutes',-12,-77,5,20,'En pausa','https://example.invalid',repeat('b',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Encolo durante pausa'; end if;
 perform public.sismocore_interruptor_push(a,true,gen_random_uuid());
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Notifico historial al reactivar'; end if;
 update public.fuentes_datos set limites=limites||jsonb_build_object('push_desde',now()-interval '1 minute') where id=fuente;
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-PUSH-ACTIVE',now()-interval '30 seconds',-12,-77,5,20,'Nuevo','https://example.invalid',repeat('c',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'No encolo evento nuevo'; end if;
 select limites->>'push_desde' into inicio from public.fuentes_datos where id=fuente;
 perform public.sismocore_interruptor_push(a,true,gen_random_uuid());
 if inicio<>(select limites->>'push_desde' from public.fuentes_datos where id=fuente) then raise exception 'Activacion duplicada cambio vigencia'; end if;
 if jsonb_array_length(public.sismocore_reservar_envios_push(5))<>1 then raise exception 'Reserva activa incorrecta'; end if;
 perform public.sismocore_interruptor_push(a,false,gen_random_uuid());
 if has_function_privilege('authenticated','public.sismocore_interruptor_push(uuid,boolean,uuid)','EXECUTE') then raise exception 'Interruptor expuesto'; end if;
end $$;
rollback;
