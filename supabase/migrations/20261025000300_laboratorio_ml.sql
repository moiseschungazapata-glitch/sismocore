begin;
-- Reuse datasets/modelos_ml and the private bucket; no additional business tables.
create function public.sismocore_crear_dataset_ml(p_actor uuid,p_id uuid,p_nombre text,p_info jsonb,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.datasets%rowtype; v integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(782406);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol in ('administrador','analista')) then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if (p_id is not null and length(btrim(p_nombre)) between 2 and 80 and jsonb_typeof(p_info)='object'
 and p_info->>'snapshot_path'='datasets/'||p_id::text||'.json'
 and (p_info->>'snapshot_sha256') ~ '^[a-f0-9]{64}$'
 and (p_info->>'numero_filas')::int between 50 and 5000
 and jsonb_typeof(p_info->'informe_calidad')='object'
 and jsonb_typeof(p_info->'especificacion')='object'
 and jsonb_typeof(p_info->'transformaciones')='array'
 and jsonb_typeof(p_info->'particion_temporal')='object'
 and (p_info->'particion_temporal'->>'entrenamiento')::int>=30
 and (p_info->'particion_temporal'->>'evaluacion')::int>=10
 and (p_info->'particion_temporal'->>'entrenamiento')::int+(p_info->'particion_temporal'->>'evaluacion')::int=(p_info->>'numero_filas')::int
 and (p_info->'particion_temporal'->>'fin_entrenamiento')::timestamptz<(p_info->'particion_temporal'->>'inicio_evaluacion')::timestamptz
 and (p_info->>'periodo_inicio')::timestamptz<(p_info->>'periodo_fin')::timestamptz) is not true then raise sqlstate 'PT422' using message='Dataset invalido'; end if;
 if (select count(*) from public.datasets)>=50 or (select count(*) from public.datasets where creado_por=p_actor and creado_en>=date_trunc('day',now()))>=5 then raise sqlstate 'PT409' using message='Limite de datasets'; end if;
 select coalesce(max(version),0)+1 into v from public.datasets where nombre=btrim(p_nombre);
 perform set_config('app.actor_id',p_actor::text,true); perform set_config('app.correlacion_id',p_correlacion::text,true);
 insert into public.datasets(id,nombre,version,especificacion,periodo_inicio,periodo_fin,numero_filas,informe_calidad,transformaciones,particion_temporal,snapshot_path,snapshot_sha256,creado_por)
 values(p_id,btrim(p_nombre),v,p_info->'especificacion',(p_info->>'periodo_inicio')::timestamptz,(p_info->>'periodo_fin')::timestamptz,
 (p_info->>'numero_filas')::int,p_info->'informe_calidad',p_info->'transformaciones',p_info->'particion_temporal',p_info->>'snapshot_path',p_info->>'snapshot_sha256',p_actor) returning * into d;
 return to_jsonb(d);
end $$;

create function public.sismocore_publicar_dataset_ml(p_actor uuid,p_id uuid,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.datasets%rowtype;
begin
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 perform set_config('app.actor_id',p_actor::text,true); perform set_config('app.correlacion_id',p_correlacion::text,true);
 update public.datasets set estado='publicado',aprobado_por=p_actor,publicado_en=clock_timestamp()
 where id=p_id and estado='borrador' and numero_filas>=50 and snapshot_path is not null and snapshot_sha256 is not null returning * into d;
 if not found then raise sqlstate 'PT409' using message='Dataset no publicable'; end if;
 return to_jsonb(d);
end $$;

create function public.sismocore_reservar_modelo_ml(p_actor uuid,p_id uuid,p_dataset uuid,p_nombre text,p_algoritmo text,p_semilla integer,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.datasets%rowtype; m public.modelos_ml%rowtype; v integer; tarea text; vars text[];
begin
 perform pg_catalog.pg_advisory_xact_lock(782406);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol in ('administrador','analista')) then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if (p_id is not null and length(btrim(p_nombre)) between 2 and 80 and p_algoritmo in ('lineal_simple','lineal_multiple','logistica') and p_semilla between 0 and 2147483647) is not true then raise sqlstate 'PT422' using message='Experimento invalido'; end if;
 select * into d from public.datasets where id=p_dataset and estado='publicado';
 if not found then raise sqlstate 'PT422' using message='Publica primero el dataset'; end if;
 perform set_config('app.actor_id',p_actor::text,true); perform set_config('app.correlacion_id',p_correlacion::text,true);
 update public.modelos_ml set estado='fallido',entrenamiento_fin=clock_timestamp(),error_resumen='Ejecucion interrumpida; crea otro experimento.' where estado in ('en_cola','entrenando') and creado_en<now()-interval '10 minutes';
 if exists(select 1 from public.modelos_ml where estado in ('en_cola','entrenando')) then raise sqlstate 'PT409' using message='Ya hay un entrenamiento en curso'; end if;
 if (select count(*) from public.modelos_ml)>=100 or (select count(*) from public.modelos_ml where creado_por=p_actor and creado_en>=date_trunc('day',now()))>=10 then raise sqlstate 'PT409' using message='Limite de experimentos'; end if;
 select coalesce(max(version),0)+1 into v from public.modelos_ml where nombre=btrim(p_nombre);
 tarea:=case when p_algoritmo='logistica' then 'clasificacion' else 'regresion' end;
 vars:=case when p_algoritmo='lineal_simple' then array['magnitud'] else array['magnitud','latitud','longitud'] end;
 insert into public.modelos_ml(id,nombre,version,dataset_id,objetivo,tarea,algoritmo,features,target,hiperparametros,semilla,validacion,estado,creado_por,entrenamiento_inicio,limitaciones)
 values(p_id,btrim(p_nombre),v,d.id,'Analisis retrospectivo de profundidad de eventos ya observados',tarea,p_algoritmo,vars,
 case when tarea='clasificacion' then 'rango_profundidad' else 'profundidad' end,
 case when tarea='clasificacion' then '{"C":1,"max_iter":1000,"solver":"lbfgs"}'::jsonb else '{}'::jsonb end,
 p_semilla,d.particion_temporal||jsonb_build_object('dataset_sha256',d.snapshot_sha256),'entrenando',p_actor,clock_timestamp(),
 'Experimental. No predice terremotos ni determina peligro. Muestra limitada al proveedor y periodo; correlacion no implica causalidad.') returning * into m;
 return to_jsonb(m);
end $$;

create function public.sismocore_finalizar_modelo_ml(p_actor uuid,p_id uuid,p_resultado jsonb,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.modelos_ml%rowtype; exito boolean;
begin
 perform pg_catalog.pg_advisory_xact_lock(782406);
 exito:=p_resultado->>'estado'='evaluado';
 if (p_resultado->>'estado' in ('evaluado','fallido')) is not true then raise sqlstate 'PT422' using message='Estado invalido'; end if;
 if exito and not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol in ('administrador','analista')) then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if exito and (p_resultado->>'artefacto_path'='modelos/'||p_id::text||'.json' and (p_resultado->>'artefacto_sha256') ~ '^[a-f0-9]{64}$'
 and jsonb_typeof(p_resultado->'metricas')='object' and p_resultado->'metricas'<>'{}'::jsonb
 and jsonb_typeof(p_resultado->'baseline')='object' and p_resultado->'baseline'<>'{}'::jsonb
 and jsonb_typeof(p_resultado->'versiones_librerias')='object') is not true then raise sqlstate 'PT422' using message='Resultado invalido'; end if;
 perform set_config('app.actor_id',p_actor::text,true); perform set_config('app.correlacion_id',p_correlacion::text,true);
 update public.modelos_ml set estado=p_resultado->>'estado',entrenamiento_fin=clock_timestamp(),
 metricas=coalesce(p_resultado->'metricas','{}'::jsonb),baseline=coalesce(p_resultado->'baseline','{}'::jsonb),versiones_librerias=coalesce(p_resultado->'versiones_librerias','{}'::jsonb),
 artefacto_path=p_resultado->>'artefacto_path',artefacto_sha256=p_resultado->>'artefacto_sha256',
 error_resumen=case when exito then null else 'No se pudo completar el experimento. Revisa la calidad y la variedad del dataset.' end
 where id=p_id and creado_por=p_actor and estado='entrenando' returning * into m;
 if not found then raise sqlstate 'PT409' using message='El experimento cambio'; end if;
 return to_jsonb(m);
end $$;

create function public.sismocore_aprobar_modelo_ml(p_actor uuid,p_id uuid,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare m public.modelos_ml%rowtype;
begin
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol='administrador') then raise sqlstate 'PT403' using message='Sin permiso'; end if;
 perform set_config('app.actor_id',p_actor::text,true); perform set_config('app.correlacion_id',p_correlacion::text,true);
 update public.modelos_ml set estado='aprobado',aprobado_por=p_actor,aprobado_en=clock_timestamp() where id=p_id and estado='evaluado' and metricas<>'{}'::jsonb and artefacto_path is not null returning * into m;
 if not found then raise sqlstate 'PT409' using message='Modelo no aprobable'; end if;
 return to_jsonb(m);
end $$;

revoke all on function public.sismocore_crear_dataset_ml(uuid,uuid,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_publicar_dataset_ml(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_reservar_modelo_ml(uuid,uuid,uuid,text,text,integer,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_finalizar_modelo_ml(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.sismocore_aprobar_modelo_ml(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sismocore_crear_dataset_ml(uuid,uuid,text,jsonb,uuid) to service_role;
grant execute on function public.sismocore_publicar_dataset_ml(uuid,uuid,uuid) to service_role;
grant execute on function public.sismocore_reservar_modelo_ml(uuid,uuid,uuid,text,text,integer,uuid) to service_role;
grant execute on function public.sismocore_finalizar_modelo_ml(uuid,uuid,jsonb,uuid) to service_role;
grant execute on function public.sismocore_aprobar_modelo_ml(uuid,uuid,uuid) to service_role;
notify pgrst,'reload schema';
commit;
