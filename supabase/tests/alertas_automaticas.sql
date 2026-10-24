begin;
do $$
declare gestor uuid:=gen_random_uuid(); lector uuid:=gen_random_uuid(); otro uuid:=gen_random_uuid(); fuente uuid;
 ingesta uuid:=gen_random_uuid(); dispositivo uuid; externo uuid; regla uuid; r2 uuid; registro jsonb; trabajos jsonb; e1 uuid:=gen_random_uuid(); e2 uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(gestor,gestor||'@example.invalid'),(lector,lector||'@example.invalid'),(otro,otro||'@example.invalid');
 update public.perfiles set estado='activo',rol=case when id=gestor then 'administrador' else 'lectura' end where id in(gestor,lector,otro);
 insert into public.fuentes_datos(codigo,nombre,organizacion,url_api) values('igp','IGP prueba','Prueba','https://example.invalid')
  on conflict(codigo) do nothing;
 select id into fuente from public.fuentes_datos where codigo='igp';
 insert into public.ejecuciones_ingesta(id,fuente_id) values(ingesta,fuente);
 registro:=public.sismocore_registrar_dispositivo(lector,repeat('p',70),'Android',gen_random_uuid());
 dispositivo:=(registro->>'id')::uuid;
 registro:=public.sismocore_registrar_dispositivo(otro,repeat('q',70),'Otro',gen_random_uuid());
 externo:=(registro->>'id')::uuid;
 begin
  perform public.sismocore_guardar_regla_push(lector,null,'No autorizado',4,'{}',array[lector],true,null,gen_random_uuid());
  raise exception 'Lectura pudo gestionar';
 exception when sqlstate 'PT403' then null; end;
 registro:=public.sismocore_guardar_regla_push(gestor,null,'Peru',4,'{}',array[lector],true,null,gen_random_uuid());
 regla:=(registro->>'id')::uuid;
 insert into public.eventos_sismicos(id,fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(e1,fuente,'TEST-OLD',now()-interval '1 day',-12,-77,5,20,'Historico','https://example.invalid',repeat('a',64),ingesta),
       (e2,fuente,'TEST-NEW',now()-interval '5 minutes',-12,-77,5,20,'Reciente','https://example.invalid',repeat('b',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Notifico catalogo anterior a activacion'; end if;
 update public.reglas_alerta set vigente_desde=now()-interval '10 minutes' where id=regla;
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'No genero solo el evento nuevo'; end if;
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Evaluacion duplicada'; end if;
 registro:=public.sismocore_guardar_regla_push(gestor,null,'Solapada',4,'{}',array[lector],true,null,gen_random_uuid());
 r2:=(registro->>'id')::uuid;
 update public.reglas_alerta set vigente_desde=now()-interval '10 minutes' where id=r2;
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Reglas solapadas duplican envio'; end if;
 registro:=public.sismocore_guardar_regla_push(gestor,null,'Zona distante',4,'{"latitud":0,"longitud":0,"radio_km":10}',array[otro],true,null,gen_random_uuid());
 update public.reglas_alerta set vigente_desde=now()-interval '10 minutes' where id=(registro->>'id')::uuid;
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Zona fuera de radio'; end if;
 trabajos:=public.sismocore_reservar_envios_push(5);
 if jsonb_array_length(trabajos)<>1 or trabajos->0->>'token'<>repeat('p',70) then raise exception 'Reserva o destinatario incorrecto'; end if;
 if public.sismocore_reservar_envios_push(5)<>'[]'::jsonb then raise exception 'Reserva duplicada'; end if;
 if public.sismocore_finalizar_envio_push((trabajos->0->>'id')::uuid,gen_random_uuid(),true,null,'test') then raise exception 'Reserva falsificada'; end if;
 if not public.sismocore_finalizar_envio_push((trabajos->0->>'id')::uuid,(trabajos->0->>'reserva_id')::uuid,true,null,'test') then raise exception 'Resultado no guardado'; end if;
 if public.sismocore_finalizar_envio_push((trabajos->0->>'id')::uuid,(trabajos->0->>'reserva_id')::uuid,true,null,'test') then raise exception 'Resultado repetido'; end if;
 if (select count(*) from public.entregas_alerta where evento_id=e2 and estado='enviada')<>1 then raise exception 'Resultado incorrecto'; end if;
 -- New event queues, but pausing rules or revoking a device cancels unsent work.
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-NEXT',now()-interval '2 minutes',-12,-77,5,20,'Siguiente','https://example.invalid',repeat('c',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'No encolo segundo evento'; end if;
 perform public.sismocore_desactivar_dispositivo(lector,dispositivo,gen_random_uuid());
 if public.sismocore_reservar_envios_push(5)<>'[]'::jsonb then raise exception 'Dispositivo revocado recibio aviso'; end if;
 begin
  perform public.sismocore_guardar_regla_push(gestor,regla,'Version falsa',4,'{}',array[lector],false,99,gen_random_uuid());
  raise exception 'Version desactualizada permitida';
 exception when sqlstate 'PT409' then null; end;
 perform public.sismocore_registrar_dispositivo(lector,repeat('p',70),'Android',gen_random_uuid());
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-EXPIRED-TOKEN',now()-interval '1 minute',-12,-77,5,20,'Token vencido','https://example.invalid',repeat('d',64),ingesta);
 perform public.sismocore_evaluar_reglas_push();
 trabajos:=public.sismocore_reservar_envios_push(5);
 if jsonb_array_length(trabajos)<>1 then raise exception 'No se reservo aviso de token vencido'; end if;
 perform public.sismocore_finalizar_envio_push((trabajos->0->>'id')::uuid,(trabajos->0->>'reserva_id')::uuid,false,'UNREGISTERED',null);
 if (select activo from public.dispositivos_notificacion where id=dispositivo) then raise exception 'Token vencido quedo activo'; end if;
 perform public.sismocore_registrar_dispositivo(lector,repeat('p',70),'Android',gen_random_uuid());
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-INTERRUPTED',now()-interval '30 seconds',-12,-77,5,20,'Interrumpido','https://example.invalid',repeat('e',64),ingesta);
 perform public.sismocore_evaluar_reglas_push();
 trabajos:=public.sismocore_reservar_envios_push(5);
 if jsonb_array_length(trabajos)<>1 then raise exception 'No se reservo aviso interrumpido'; end if;
 update public.entregas_alerta set ultimo_intento_en=now()-interval '6 minutes' where id=(trabajos->0->>'id')::uuid;
 if public.sismocore_reservar_envios_push(5)<>'[]'::jsonb then raise exception 'Se reenvio un resultado incierto'; end if;
 if not exists(select 1 from public.entregas_alerta where id=(trabajos->0->>'id')::uuid and estado='fallida' and error_codigo='RESULTADO_DESCONOCIDO') then raise exception 'Falta marcar interrupcion'; end if;
 update public.perfiles set estado='suspendido' where id=lector;
 registro:=public.sismocore_guardar_regla_push(gestor,regla,'Peru pausada',4,'{}',array[lector],false,1,gen_random_uuid());
 if (registro->>'activa')::boolean then raise exception 'No se pudo pausar con destinatario suspendido'; end if;
 begin
  perform public.sismocore_guardar_regla_push(gestor,regla,'No activar suspendido',4,'{}',array[lector],true,2,gen_random_uuid());
  raise exception 'Se activo con destinatario suspendido';
 exception when sqlstate 'PT422' then null; end;
 if exists(select 1 from public.auditoria where to_jsonb(auditoria)::text like '%'||repeat('p',70)||'%') then raise exception 'Token en auditoria'; end if;
 if has_function_privilege('authenticated','public.sismocore_reservar_envios_push(integer)','EXECUTE') then raise exception 'Cola expuesta'; end if;
end $$;
rollback;
