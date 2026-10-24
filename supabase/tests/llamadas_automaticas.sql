begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); ref uuid:=gen_random_uuid(); fuente uuid;
 ingesta uuid:=gen_random_uuid(); evento uuid:=gen_random_uuid(); regla uuid; datos jsonb; trabajo jsonb;
 cuenta text:=repeat('a',64); destino text:=repeat('b',64); i integer;
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(b,b||'@example.invalid');
 update public.perfiles set estado='activo',rol='administrador' where id in(a,b);
 insert into public.fuentes_datos(codigo,nombre,organizacion,url_api) values('igp','IGP prueba','Prueba','https://example.invalid') on conflict(codigo) do nothing;
 select id into fuente from public.fuentes_datos where codigo='igp';
 if exists(select 1 from public.perfiles where voz_activa) then raise exception 'Consentimiento activado por defecto'; end if;
 if exists(select 1 from public.fuentes_datos where limites->>'voz_habilitada'='true') then raise exception 'Llamadas activadas por defecto'; end if;
 begin
  perform public.sismocore_configurar_telefono_voz(a,cuenta,destino,'1234',true,gen_random_uuid());
  raise exception 'Autorizo sin prueba completada';
 exception when sqlstate 'PT422' then null; end;
 -- A past completed manual attempt, recorded without contacting any provider.
 insert into public.auditoria(id,actor_id,actor_tipo,accion,entidad,entidad_id,resultado,despues,ocurrido_en)
 values(ref,a,'usuario','voz.solicitar','voz_pruebas',ref,'correcto',jsonb_build_object('cuenta',cuenta,'destino',destino,'ultimos','1234'),now()-interval '5 minutes');
 perform public.sismocore_registrar_estado_voz(a,ref,'completed','CA'||repeat('c',32),null);
 begin
  perform public.sismocore_configurar_telefono_voz(b,cuenta,destino,'1234',true,gen_random_uuid());
  raise exception 'Otro usuario reutilizo prueba';
 exception when sqlstate 'PT422' then null; end;
 perform public.sismocore_configurar_telefono_voz(a,cuenta,destino,'1234',true,gen_random_uuid());
 perform public.sismocore_registrar_dispositivo(a,repeat('p',70),'Android',gen_random_uuid());
 datos:=public.sismocore_guardar_regla_alerta(a,null,'Ambos',4,'{}',array[a],true,null,gen_random_uuid(),array['push','voz']);
 regla:=(datos->>'id')::uuid;
 update public.reglas_alerta set vigente_desde=now()-interval '15 minutes' where id=regla;
 update public.perfiles set voz_consentimiento_en=now()-interval '15 minutes' where id=a;
 insert into public.ejecuciones_ingesta(id,fuente_id) values(ingesta,fuente);
 insert into public.eventos_sismicos(id,fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(evento,fuente,'TEST-VOICE',now()-interval '2 minutes',-12,-77,5,20,'Lugar de prueba','https://example.invalid',repeat('a',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'Push debe funcionar con voz apagada'; end if;
 if exists(select 1 from public.entregas_alerta where canal='voz') then raise exception 'Encolo con interruptor apagado'; end if;
 perform public.sismocore_interruptor_voz(a,cuenta,true,gen_random_uuid());
 update public.fuentes_datos set limites=limites||jsonb_build_object('voz_desde',now()-interval '10 minutes') where id=fuente;
 -- A second matching rule exercises physical-phone deduplication.
 datos:=public.sismocore_guardar_regla_alerta(a,null,'Voz',4,'{}',array[a],true,null,gen_random_uuid(),array['voz']);
 update public.reglas_alerta set vigente_desde=now()-interval '15 minutes' where id=(datos->>'id')::uuid;
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'No encolo una llamada'; end if;
 datos:=public.sismocore_guardar_regla_alerta(a,null,'Voz solapada',4,'{}',array[a],true,null,gen_random_uuid(),array['voz']);
 update public.reglas_alerta set vigente_desde=now()-interval '15 minutes' where id=(datos->>'id')::uuid;
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Duplico llamada entre reglas'; end if;
 trabajo:=public.sismocore_reservar_llamada_automatica(cuenta);
 if trabajo is null or trabajo->>'destino'<>destino then raise exception 'Reserva incorrecta'; end if;
 if public.sismocore_contenido_llamada((trabajo->>'id')::uuid,gen_random_uuid(),cuenta) is not null then raise exception 'Autorizacion falsificada'; end if;
 if public.sismocore_contenido_llamada((trabajo->>'id')::uuid,(trabajo->>'reserva_id')::uuid,cuenta) is null then raise exception 'Sin contenido autorizado'; end if;
 if public.sismocore_reservar_llamada_automatica(cuenta) is not null then raise exception 'Reserva duplicada'; end if;
 begin
  perform public.sismocore_reservar_prueba_voz(a,cuenta,destino,'1234',gen_random_uuid());
  raise exception 'Prueba ignoro cooldown automatico';
 exception when sqlstate 'PT429' then null; end;
 datos:=public.sismocore_limites_voz(cuenta);
 if (datos->>'usadas_total')::int<>2 then raise exception 'No comparte contador'; end if;
 if public.sismocore_finalizar_llamada_automatica((trabajo->>'id')::uuid,gen_random_uuid(),'queued','CA'||repeat('d',32),null) then raise exception 'Reserva final falsa'; end if;
 if not public.sismocore_finalizar_llamada_automatica((trabajo->>'id')::uuid,(trabajo->>'reserva_id')::uuid,'queued','CA'||repeat('d',32),null) then raise exception 'No finalizo reserva'; end if;
 perform public.sismocore_actualizar_llamada_automatica((trabajo->>'id')::uuid,'CA'||repeat('d',32),'completed');
 if public.sismocore_actualizar_llamada_automatica((trabajo->>'id')::uuid,'CA'||repeat('d',32),'ringing') then raise exception 'Retrocedio estado terminal'; end if;
 -- Old reports and reports preceding consent must never generate a call.
 update public.reglas_alerta set activa=false where id=regla;
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-VOICE-OLD',now()-interval '3 hours',-12,-77,5,20,'Antiguo','https://example.invalid',repeat('b',64),ingesta),
 (fuente,'TEST-BEFORE-CONSENT',now()-interval '11 minutes',-12,-77,5,20,'Anterior a autorizacion','https://example.invalid',repeat('c',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>0 then raise exception 'Encolo evento viejo o anterior a autorizacion'; end if;
 -- A fresh delivery is canceled when the shared manual/automatic daily cap is reached.
 insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
 values(fuente,'TEST-VOICE-CAP',now()-interval '1 minute',-12,-77,5,20,'Reciente','https://example.invalid',repeat('d',64),ingesta);
 if public.sismocore_evaluar_reglas_push()<>1 then raise exception 'No encolo evento reciente'; end if;
 for i in 1..3 loop
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,resultado,despues,ocurrido_en)
  values(a,'usuario','voz.solicitar','voz_pruebas','correcto',jsonb_build_object('cuenta',cuenta),now()-interval '5 minutes');
 end loop;
 if public.sismocore_reservar_llamada_automatica(cuenta) is not null then raise exception 'Ignoro limite compartido'; end if;
 if not exists(select 1 from public.entregas_alerta where canal='voz' and error_codigo='LIMITE_SISMOCORE') then raise exception 'Falta cancelacion por limite'; end if;
 perform public.sismocore_configurar_telefono_voz(a,null,null,null,false,gen_random_uuid());
 if public.sismocore_contenido_llamada((trabajo->>'id')::uuid,(trabajo->>'reserva_id')::uuid,cuenta) is not null then raise exception 'Consentimiento retirado ignorable'; end if;
 perform public.sismocore_interruptor_voz(a,cuenta,false,gen_random_uuid());
 update public.perfiles set rol='operador' where id=b;
 begin
  perform public.sismocore_guardar_regla_alerta(b,null,'Prohibida',4,'{}',array[b],false,null,gen_random_uuid(),array['voz']);
  raise exception 'Operador configuro voz';
 exception when sqlstate 'PT403' then null; end;
 if has_function_privilege('authenticated','public.sismocore_reservar_llamada_automatica(text)','EXECUTE') then raise exception 'Reserva publica'; end if;
 if has_function_privilege('anon','public.sismocore_contenido_llamada(uuid,uuid,text)','EXECUTE') then raise exception 'Contenido publico'; end if;
end $$;
rollback;
