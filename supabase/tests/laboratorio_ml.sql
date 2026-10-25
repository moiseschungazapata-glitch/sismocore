begin;
do $$
declare a uuid:=gen_random_uuid(); analyst uuid:=gen_random_uuid(); reader uuid:=gen_random_uuid();
 d uuid:=gen_random_uuid(); d2 uuid:=gen_random_uuid(); m uuid:=gen_random_uuid(); m2 uuid:=gen_random_uuid();
 info jsonb; result jsonb; correlation uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(a,a||'@example.invalid'),(analyst,analyst||'@example.invalid'),(reader,reader||'@example.invalid');
 update public.perfiles set rol='administrador',estado='activo' where id=a;
 update public.perfiles set rol='analista',estado='activo' where id=analyst;
 update public.perfiles set rol='lectura',estado='activo' where id=reader;
 if has_function_privilege('authenticated','public.sismocore_crear_dataset_ml(uuid,uuid,text,jsonb,uuid)','EXECUTE') or
 has_function_privilege('anon','public.sismocore_aprobar_modelo_ml(uuid,uuid,uuid)','EXECUTE') then raise exception 'FALLO: RPC expuesta'; end if;
 info:=jsonb_build_object('snapshot_path','datasets/'||d||'.json','snapshot_sha256',repeat('a',64),'numero_filas',50,
 'especificacion','{"fuente":"igp"}'::jsonb,'informe_calidad','{"validos":50}'::jsonb,'transformaciones','[]'::jsonb,
 'particion_temporal','{"entrenamiento":40,"evaluacion":10,"fin_entrenamiento":"2026-01-03T00:00:00Z","inicio_evaluacion":"2026-01-04T00:00:00Z"}'::jsonb,
 'periodo_inicio','2026-01-01T00:00:00Z','periodo_fin','2026-01-05T00:00:00Z');
 begin
 perform public.sismocore_crear_dataset_ml(reader,d,'Prueba ML',info,correlation);
 raise exception 'FALLO: lector creó dataset'; exception when sqlstate 'PT403' then null; end;
 begin
 perform public.sismocore_crear_dataset_ml(analyst,d,'Prueba ML',info-'snapshot_path',correlation);
 raise exception 'FALLO: snapshot incompleto'; exception when sqlstate 'PT422' then null; end;
 result:=public.sismocore_crear_dataset_ml(analyst,d,'Prueba ML',info,correlation);
 if result->>'estado'<>'borrador' or (result->>'version')::int<>1 then raise exception 'FALLO: dataset inicial'; end if;
 begin
 perform public.sismocore_reservar_modelo_ml(analyst,m,d,'Regresión','lineal_simple',42,correlation);
 raise exception 'FALLO: dataset sin publicar'; exception when sqlstate 'PT422' then null; end;
 begin
 perform public.sismocore_publicar_dataset_ml(analyst,d,correlation);
 raise exception 'FALLO: analista publica'; exception when sqlstate 'PT403' then null; end;
 perform public.sismocore_publicar_dataset_ml(a,d,correlation);
 begin
 update public.datasets set snapshot_sha256=repeat('b',64) where id=d;
 raise exception 'FALLO: snapshot publicado mutable';
 exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
 info:=jsonb_set(info,'{snapshot_path}',to_jsonb('datasets/'||d2||'.json'));
 result:=public.sismocore_crear_dataset_ml(analyst,d2,'Prueba ML',info,correlation);
 if (result->>'version')::int<>2 then raise exception 'FALLO: versión dataset'; end if;
 result:=public.sismocore_reservar_modelo_ml(analyst,m,d,'Regresión','lineal_simple',42,correlation);
 if result->>'estado'<>'entrenando' or result->'features'<>'["magnitud"]'::jsonb or result->'validacion'->>'dataset_sha256'<>repeat('a',64) then raise exception 'FALLO: manifiesto entrenamiento'; end if;
 begin
 perform public.sismocore_reservar_modelo_ml(a,m2,d,'Regresión','lineal_simple',42,correlation);
 raise exception 'FALLO: dos entrenamientos simultáneos'; exception when sqlstate 'PT409' then null; end;
 begin
 perform public.sismocore_finalizar_modelo_ml(analyst,m,'{"estado":"evaluado"}',correlation);
 raise exception 'FALLO: resultado incompleto'; exception when sqlstate 'PT422' then null; end;
 perform public.sismocore_finalizar_modelo_ml(analyst,m,jsonb_build_object('estado','evaluado','artefacto_path','modelos/'||m||'.json','artefacto_sha256',repeat('c',64),
 'metricas','{"mae":10}'::jsonb,'baseline','{"mae":15}'::jsonb,'versiones_librerias','{"test":"1"}'::jsonb),correlation);
 begin
 perform public.sismocore_finalizar_modelo_ml(analyst,m,'{"estado":"fallido"}',correlation);
 raise exception 'FALLO: sobrescritura de éxito'; exception when sqlstate 'PT409' then null; end;
 begin
 perform public.sismocore_aprobar_modelo_ml(analyst,m,correlation);
 raise exception 'FALLO: analista aprueba'; exception when sqlstate 'PT403' then null; end;
 perform public.sismocore_aprobar_modelo_ml(a,m,correlation);
 begin
 update public.modelos_ml set metricas='{"mae":0}'::jsonb where id=m;
 raise exception 'FALLO: métricas aprobadas mutables';
 exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
 result:=public.sismocore_reservar_modelo_ml(analyst,m2,d,'Regresión','lineal_multiple',42,correlation);
 if (result->>'version')::int<>2 then raise exception 'FALLO: versión modelo'; end if;
 perform public.sismocore_finalizar_modelo_ml(analyst,m2,'{"estado":"fallido"}',correlation);
 if not exists(select 1 from public.auditoria where entidad='modelos_ml' and entidad_id=m and actor_id=a and correlacion_id=correlation) then raise exception 'FALLO: auditoría ausente'; end if;
end $$;
rollback;
