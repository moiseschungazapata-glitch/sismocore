begin;
-- Pausing must remain possible if a previously selected recipient was suspended.
create or replace function public.sismocore_guardar_regla_push(p_actor uuid,p_id uuid,p_nombre text,p_magnitud double precision,
 p_zona jsonb,p_destinatarios uuid[],p_activa boolean,p_version integer,p_correlacion uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.reglas_alerta%rowtype; fuente uuid;
begin
 perform pg_catalog.pg_advisory_xact_lock(782401);
 if not exists(select 1 from public.perfiles where id=p_actor and estado='activo' and rol in ('administrador','operador')) then
  raise sqlstate 'PT403' using message='Sin permiso'; end if;
 if p_nombre is null or length(btrim(p_nombre)) not between 1 and 80 or p_magnitud is null or not(p_magnitud between 0 and 10)
  or p_activa is null or p_zona is null or jsonb_typeof(p_zona)<>'object'
  or coalesce(cardinality(p_destinatarios),0) not between 1 and 50
  or exists(select 1 from unnest(p_destinatarios) u where u is null)
  or (p_activa and exists(select 1 from unnest(p_destinatarios) u where not exists(select 1 from public.perfiles where id=u and estado='activo'))) then
  raise sqlstate 'PT422' using message='Regla invalida'; end if;
 if p_zona <> '{}'::jsonb then
  if (select count(*) from jsonb_object_keys(p_zona))<>3 or not(p_zona ?& array['latitud','longitud','radio_km']) then
   raise sqlstate 'PT422' using message='Zona invalida'; end if;
  if ((p_zona->>'latitud')::double precision between -90 and 90 and (p_zona->>'longitud')::double precision between -180 and 180
    and (p_zona->>'radio_km')::double precision between 10 and 2000) is not true then raise sqlstate 'PT422' using message='Zona invalida'; end if;
 end if;
 select id into fuente from public.fuentes_datos where codigo='igp' and (activa or not p_activa) limit 1;
 if fuente is null then raise sqlstate 'PT409' using message='Fuente IGP no disponible'; end if;
 perform set_config('app.actor_id',p_actor::text,true);
 perform set_config('app.correlacion_id',p_correlacion::text,true);
 if p_id is null then
  if (select count(*) from public.reglas_alerta where canales=array['push'])>=20 then raise sqlstate 'PT409' using message='Maximo veinte reglas'; end if;
  insert into public.reglas_alerta(nombre,fuente_id,magnitud_minima,zona,severidad,canales,destinatarios,plantilla,
   requiere_aprobacion,activa,creado_por,aprobado_por,aprobado_en,vigente_desde)
  values(btrim(p_nombre),fuente,p_magnitud,p_zona,'informativa',array['push'],to_jsonb(p_destinatarios),
   'Aviso de evento reportado por IGP',false,p_activa,p_actor,p_actor,clock_timestamp(),clock_timestamp()) returning * into r;
 else
  update public.reglas_alerta set nombre=btrim(p_nombre),magnitud_minima=p_magnitud,zona=p_zona,
   destinatarios=to_jsonb(p_destinatarios),activa=p_activa,version=version+1,aprobado_por=p_actor,
   aprobado_en=clock_timestamp(),vigente_desde=clock_timestamp()
  where id=p_id and version=p_version and canales=array['push'] returning * into r;
  if not found then raise sqlstate 'PT409' using message='Regla modificada; actualiza la lista'; end if;
 end if;
 return to_jsonb(r);
end $$;
notify pgrst,'reload schema';
commit;
