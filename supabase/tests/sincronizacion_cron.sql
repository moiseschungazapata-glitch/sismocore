begin;
do $$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); datos jsonb; solicitud bigint;
begin
 insert into public.fuentes_datos(codigo,nombre,organizacion,url_api,tipo)
 values('igp','IGP','IGP','https://example.invalid','arcgis_json') on conflict(codigo) do nothing;
 if not public.sismocore_adquirir_sincronizacion(a) then raise exception 'Primera reserva rechazada'; end if;
 if public.sismocore_adquirir_sincronizacion(b) then raise exception 'Dos reservas simultaneas'; end if;
 if public.sismocore_finalizar_sincronizacion(b,'completada') then raise exception 'Otro proceso libero la reserva'; end if;
 if not public.sismocore_finalizar_sincronizacion(a,'completada') then raise exception 'No se libero reserva propia'; end if;
 if public.sismocore_adquirir_sincronizacion(b) then raise exception 'No se respeta espera entre ejecuciones'; end if;
 update public.fuentes_datos set limites=limites||jsonb_build_object('sync_inicio',now()-interval '10 minutes','sync_hasta',now()-interval '1 second','sync_reserva',a) where codigo='igp';
 if not public.sismocore_adquirir_sincronizacion(b) then raise exception 'No se recupera reserva caducada'; end if;
 if public.sismocore_finalizar_sincronizacion(a,'completada') then raise exception 'Reserva antigua modifico la nueva'; end if;
 perform public.sismocore_finalizar_sincronizacion(b,'fallida');
 update public.fuentes_datos set activa=false,limites=limites||jsonb_build_object('sync_inicio',now()-interval '10 minutes') where codigo='igp';
 if public.sismocore_adquirir_sincronizacion(a) then raise exception 'Fuente inactiva sincronizable'; end if;
 datos:=public.sismocore_estado_sincronizacion();
 if (datos->>'activo')::boolean then raise exception 'Cron no se instala pausado'; end if;
 if (select count(*) from cron.job where jobname='sismocore-igp-5-minutos' and schedule='*/5 * * * *')<>1 then raise exception 'Horario incorrecto'; end if;
 begin
  perform sismocore_private.ejecutar_cron_igp();
  raise sqlstate 'PT422' using message='Se permitio enviar sin clave';
 exception when raise_exception then null; end;
 insert into vault.secrets(name,secret) values('sismocore_sync_cron_secret',repeat('a',64));
 solicitud:=sismocore_private.ejecutar_cron_igp();
 insert into net._http_response values(solicitud,200,false);
 datos:=public.sismocore_estado_sincronizacion();
 if (datos->>'ultimo_http')::int<>200 then raise exception 'No se consulta la respuesta HTTP real'; end if;
 if datos::text like '%'||repeat('a',64)||'%' then raise exception 'Clave filtrada en estado'; end if;
 if has_function_privilege('authenticated','public.sismocore_adquirir_sincronizacion(uuid)','EXECUTE')
 or has_function_privilege('anon','public.sismocore_estado_sincronizacion()','EXECUTE')
 or has_function_privilege('service_role','sismocore_private.ejecutar_cron_igp()','EXECUTE') then raise exception 'Funciones privadas expuestas'; end if;
end $$;
rollback;
