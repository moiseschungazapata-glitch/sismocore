-- Ejecutar SOLO en un proyecto de prueba, tras la migracion, como propietario.
-- Inserta identidades ficticias y revierte todos los datos al terminar.
begin;
do $$ begin
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind='r' and c.relrowsecurity) <> 13 then
    raise exception 'FALLO: deben existir 13 tablas protegidas con RLS'; end if;
  if exists (select 1 from pg_tables where schemaname='public' and
    (has_table_privilege('authenticated', format('%I.%I',schemaname,tablename), 'INSERT') or
     has_table_privilege('authenticated', format('%I.%I',schemaname,tablename), 'UPDATE') or
     has_table_privilege('authenticated', format('%I.%I',schemaname,tablename), 'DELETE') or
     has_table_privilege('anon', format('%I.%I',schemaname,tablename), 'SELECT'))) then
    raise exception 'FALLO: privilegios de cliente excesivos'; end if;
end $$;
select set_config('test.admin_id', gen_random_uuid()::text, true);
select set_config('test.reader_id', gen_random_uuid()::text, true);
select set_config('test.source_id', gen_random_uuid()::text, true);
select set_config('test.run_id', gen_random_uuid()::text, true);
select set_config('test.event_id', gen_random_uuid()::text, true);
select set_config('test.dataset_id', gen_random_uuid()::text, true);
select set_config('test.model_id', gen_random_uuid()::text, true);
select set_config('test.rule_id', gen_random_uuid()::text, true);
select set_config('test.alert_id', gen_random_uuid()::text, true);

insert into auth.users(id,email,raw_user_meta_data)
values
  (current_setting('test.admin_id')::uuid, current_setting('test.admin_id') || '@example.invalid', '{"full_name":"Prueba Admin"}'),
  (current_setting('test.reader_id')::uuid, current_setting('test.reader_id') || '@example.invalid', '{"role":"administrador"}');

do $$ begin
  if not exists(select 1 from public.perfiles where id=current_setting('test.reader_id')::uuid
    and rol='lectura' and estado='pendiente') then
    raise exception 'FALLO: metadata no debe otorgar permisos';
  end if;
end $$;
update public.perfiles set estado='activo',rol='administrador' where id=current_setting('test.admin_id')::uuid;
update public.perfiles set estado='activo' where id=current_setting('test.reader_id')::uuid;

insert into public.fuentes_datos(id,codigo,nombre,organizacion,url_api)
values(current_setting('test.source_id')::uuid,current_setting('test.source_id'),'Prueba','Prueba','https://example.invalid');
insert into public.ejecuciones_ingesta(id,fuente_id)
values(current_setting('test.run_id')::uuid,current_setting('test.source_id')::uuid);
insert into public.eventos_sismicos(id,fuente_id,id_externo,ocurrido_en,latitud,longitud,magnitud,
  profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
values(current_setting('test.event_id')::uuid,current_setting('test.source_id')::uuid,'evento-prueba',now(),
  -12,-77,4.5,20,'Prueba','https://example.invalid/event',repeat('a',64),current_setting('test.run_id')::uuid);

do $$ begin
  begin
    insert into public.eventos_sismicos(fuente_id,id_externo,ocurrido_en,latitud,longitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id)
    select fuente_id,id_externo,ocurrido_en,latitud,longitud,profundidad,lugar,url_fuente,hash_origen,ultima_ingesta_id
    from public.eventos_sismicos where id=current_setting('test.event_id')::uuid;
    raise exception 'FALLO: evento duplicado aceptado';
  exception when unique_violation then null; end;
  begin
    update public.eventos_sismicos set latitud=999 where id=current_setting('test.event_id')::uuid;
    raise exception 'FALLO: latitud invalida aceptada';
  exception when check_violation then null; end;
  begin
    update public.eventos_sismicos set latitud=null where id=current_setting('test.event_id')::uuid;
    raise exception 'FALLO: latitud nula aceptada';
  exception when not_null_violation then null; end;
  begin
    update public.eventos_sismicos set magnitud='NaN' where id=current_setting('test.event_id')::uuid;
    raise exception 'FALLO: NaN aceptado';
  exception when check_violation then null; end;
  begin
    insert into public.ejecuciones_ingesta(fuente_id) values(current_setting('test.source_id')::uuid);
    raise exception 'FALLO: dos ingestas activas';
  exception when unique_violation then null; end;
  begin
    update public.eventos_sismicos set fuente_id=(select id from public.fuentes_datos where codigo='usgs')
      where id=current_setting('test.event_id')::uuid;
    raise exception 'FALLO: evento asociado a ingesta de otra fuente';
  exception when foreign_key_violation then null; end;
end $$;
-- Valores negativos pueden ser validos en el origen; no imponer >= 0.
update public.eventos_sismicos set magnitud=-0.5,profundidad=-1 where id=current_setting('test.event_id')::uuid;

insert into public.datasets(id,nombre,version,especificacion,periodo_inicio,periodo_fin)
values(current_setting('test.dataset_id')::uuid,current_setting('test.dataset_id'),1,'{}',now()-interval '7 days',now());

do $$ begin
  begin
    update public.datasets set estado='publicado' where id=current_setting('test.dataset_id')::uuid;
    raise exception 'FALLO: publicacion sin snapshot/aprobacion';
  exception when check_violation or raise_exception then
    if sqlerrm like 'FALLO:%' then raise; end if;
  end;
end $$;
update public.datasets set estado='publicado', snapshot_path='datasets/prueba.csv',snapshot_sha256=repeat('b',64),
  aprobado_por=current_setting('test.admin_id')::uuid,publicado_en=now()
where id=current_setting('test.dataset_id')::uuid;
do $$ begin
  begin
    update public.datasets set numero_filas=123 where id=current_setting('test.dataset_id')::uuid;
    raise exception 'FALLO: dataset publicado mutable';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    delete from public.datasets where id=current_setting('test.dataset_id')::uuid;
    raise exception 'FALLO: dataset publicado eliminable';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;

insert into public.modelos_ml(id,nombre,version,dataset_id,objetivo,tarea,algoritmo,features,target,validacion,limitaciones)
values(current_setting('test.model_id')::uuid,current_setting('test.model_id'),1,current_setting('test.dataset_id')::uuid,
  'Prueba','regresion','linear',array['profundidad'],'magnitud','{}','Solo prueba');
do $$ begin
  begin
    insert into public.estimaciones(modelo_id,zona,zona_codigo,ventana_inicio,ventana_fin,metrica,valor,estado,revisado_en,revisado_por)
    values(current_setting('test.model_id')::uuid,'{}','PE',now(),now()+interval '1 day','indice',1,
      'publicada',now(),current_setting('test.admin_id')::uuid);
    raise exception 'FALLO: estimacion de modelo no aprobado';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;
update public.modelos_ml set estado='aprobado',artefacto_path='modelos/prueba.joblib',artefacto_sha256=repeat('c',64),
  metricas='{"mae":1}',entrenamiento_inicio=now(),entrenamiento_fin=now(),
  aprobado_por=current_setting('test.admin_id')::uuid,aprobado_en=now()
where id=current_setting('test.model_id')::uuid;
do $$ begin
  begin
    update public.modelos_ml set hiperparametros='{"cambio":true}' where id=current_setting('test.model_id')::uuid;
    raise exception 'FALLO: modelo aprobado mutable';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    delete from public.modelos_ml where id=current_setting('test.model_id')::uuid;
    raise exception 'FALLO: modelo aprobado eliminable';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;
insert into public.estimaciones(modelo_id,zona,zona_codigo,ventana_inicio,ventana_fin,metrica,valor,estado,revisado_en,revisado_por)
values(current_setting('test.model_id')::uuid,'{}','PE',now(),now()+interval '1 day','indice',1,
  'publicada',now(),current_setting('test.admin_id')::uuid);
update public.modelos_ml set estado='retirado' where id=current_setting('test.model_id')::uuid;

insert into public.reglas_alerta(id,nombre,fuente_id,magnitud_minima,severidad,plantilla,activa,aprobado_en,aprobado_por)
values(current_setting('test.rule_id')::uuid,'Prueba',current_setting('test.source_id')::uuid,4,'informativa',
  'Prueba',true,now(),current_setting('test.admin_id')::uuid);
do $$ begin
  begin
    insert into public.alertas(evento_id,regla_id,regla_version,severidad,titulo,mensaje,url_fuente,contexto)
    values(current_setting('test.event_id')::uuid,current_setting('test.rule_id')::uuid,99,
      'informativa','Prueba','Prueba','https://example.invalid','{}');
    raise exception 'FALLO: alerta con version incorrecta';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
  begin
    update public.reglas_alerta set fuente_id=(select id from public.fuentes_datos where codigo='usgs')
      where id=current_setting('test.rule_id')::uuid;
    insert into public.alertas(evento_id,regla_id,regla_version,severidad,titulo,mensaje,url_fuente,contexto)
    values(current_setting('test.event_id')::uuid,current_setting('test.rule_id')::uuid,1,
      'informativa','Prueba','Prueba','https://example.invalid','{}');
    raise exception 'FALLO: alerta de otra fuente';
  exception when raise_exception then if sqlerrm like 'FALLO:%' then raise; end if; end;
end $$;
insert into public.alertas(id,evento_id,regla_id,regla_version,severidad,titulo,mensaje,url_fuente,contexto)
values(current_setting('test.alert_id')::uuid,current_setting('test.event_id')::uuid,current_setting('test.rule_id')::uuid,
  1,'informativa','Prueba','Prueba','https://example.invalid','{}');
insert into public.entregas_alerta(alerta_id,canal,destinatario,usuario_id)
values(current_setting('test.alert_id')::uuid,'interno',current_setting('test.reader_id'),current_setting('test.reader_id')::uuid);
do $$ begin
  begin
    insert into public.entregas_alerta(alerta_id,canal,destinatario)
    values(current_setting('test.alert_id')::uuid,'interno',current_setting('test.reader_id'));
    raise exception 'FALLO: entrega duplicada';
  exception when unique_violation then null; end;
  begin
    update public.entregas_alerta set intentos=1,ultimo_intento_en=now()
    where alerta_id=current_setting('test.alert_id')::uuid;
    raise exception 'FALLO: contador de intentos sin historial';
  exception when check_violation then null; end;
end $$;

-- Simular JWT de lector. No modificar los identificadores generados.
select set_config('request.jwt.claim.sub',current_setting('test.reader_id'),true);
select set_config('request.jwt.claims',json_build_object('sub',current_setting('test.reader_id'),'role','authenticated')::text,true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.eventos_sismicos where id=current_setting('test.event_id')::uuid) <> 1 then
    raise exception 'FALLO: lector activo no puede leer evento'; end if;
  if exists(select 1 from public.auditoria) then raise exception 'FALLO: lector ve auditoria'; end if;
  if exists(select 1 from public.reglas_alerta) then raise exception 'FALLO: lector ve reglas privadas'; end if;
  if exists(select 1 from public.perfiles where id=current_setting('test.admin_id')::uuid) then
    raise exception 'FALLO: lector ve perfil de otro usuario'; end if;
  if not exists(select 1 from public.entregas_alerta where usuario_id=current_setting('test.reader_id')::uuid) then
    raise exception 'FALLO: lector no puede ver entrega propia'; end if;
  begin
    update public.perfiles set rol='administrador' where id=current_setting('test.reader_id')::uuid;
    raise exception 'FALLO: escalada de privilegios';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

set local role service_role;
do $$ begin
  begin
    update public.auditoria set accion='alterada' where false;
    raise exception 'FALLO: servicio puede alterar auditoria';
  exception when insufficient_privilege then null; end;
  if not exists(select 1 from public.eventos_sismicos where id=current_setting('test.event_id')::uuid) then
    raise exception 'FALLO: servicio no accede al catalogo'; end if;
end $$;
reset role;
update public.perfiles set estado='suspendido' where id=current_setting('test.reader_id')::uuid;
set local role authenticated;
do $$ begin
  if exists(select 1 from public.eventos_sismicos) then
    raise exception 'FALLO: usuario suspendido lee eventos'; end if;
end $$;
reset role;

-- Baja Auth: conserva negocio y publicaciones incluso si el modelo esta retirado.
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','{}',true);
delete from auth.users where id=current_setting('test.admin_id')::uuid;
do $$ begin
  if exists(select 1 from public.perfiles where id=current_setting('test.admin_id')::uuid) then
    raise exception 'FALLO: perfil no eliminado en cascada'; end if;
  if not exists(select 1 from public.estimaciones where modelo_id=current_setting('test.model_id')::uuid
    and revisado_por is null and estado='publicada') then
    raise exception 'FALLO: publicacion historica perdida'; end if;
  if not exists(select 1 from public.auditoria where entidad_id=current_setting('test.rule_id')::uuid) then
    raise exception 'FALLO: cambio critico sin auditoria'; end if;
end $$;
select 'Comprobaciones del esquema completadas; los datos de prueba se revierten.' as resultado;
rollback;
