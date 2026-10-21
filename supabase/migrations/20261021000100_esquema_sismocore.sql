-- SISMOCORE: instalacion inicial en un proyecto Supabase vacio.
-- No ejecutar sobre tablas existentes sin reconciliar antes sus migraciones.
-- Escrituras: FastAPI/worker de confianza; lecturas: JWT + RLS.
begin;

create schema if not exists sismocore_private;
revoke all on schema sismocore_private from public, anon, authenticated;

create table public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text not null default '',
  rol text not null default 'lectura'
    check (rol in ('administrador','analista','operador','auditor','lectura')),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','activo','suspendido')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.fuentes_datos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (btrim(codigo) <> ''),
  nombre text not null,
  organizacion text not null,
  url_api text not null check (url_api like 'https://%'),
  tipo text not null default 'fdsn_geojson',
  activa boolean not null default true,
  frecuencia_segundos integer not null default 300 check (frecuencia_segundos >= 60),
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object'),
  limites jsonb not null default '{}'::jsonb check (jsonb_typeof(limites) = 'object'),
  licencia_url text,
  contacto text,
  secreto_ref text,
  cursor_sincronizacion jsonb not null default '{}'::jsonb
    check (jsonb_typeof(cursor_sincronizacion) = 'object'),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.ejecuciones_ingesta (
  id uuid primary key default gen_random_uuid(),
  fuente_id uuid not null references public.fuentes_datos(id) on delete restrict,
  solicitado_por uuid references public.perfiles(id) on delete set null,
  estado text not null default 'en_cola'
    check (estado in ('en_cola','ejecutando','completada','fallida','cancelada')),
  iniciado_en timestamptz not null default now(),
  finalizado_en timestamptz,
  parametros jsonb not null default '{}'::jsonb check (jsonb_typeof(parametros) = 'object'),
  cursor_resultado jsonb not null default '{}'::jsonb check (jsonb_typeof(cursor_resultado) = 'object'),
  registros_recibidos integer not null default 0 check (registros_recibidos >= 0),
  registros_insertados integer not null default 0 check (registros_insertados >= 0),
  registros_actualizados integer not null default 0 check (registros_actualizados >= 0),
  registros_rechazados integer not null default 0 check (registros_rechazados >= 0),
  registros_sin_cambios integer not null default 0 check (registros_sin_cambios >= 0),
  calidad jsonb not null default '{}'::jsonb check (jsonb_typeof(calidad) = 'object'),
  error_resumen text,
  correlacion_id uuid not null default gen_random_uuid(),
  check (finalizado_en is null or finalizado_en >= iniciado_en),
  check (estado not in ('completada','fallida','cancelada') or finalizado_en is not null),
  check (registros_insertados + registros_actualizados + registros_rechazados + registros_sin_cambios <= registros_recibidos),
  unique (id, fuente_id)
);

create table public.eventos_sismicos (
  id uuid primary key default gen_random_uuid(),
  fuente_id uuid not null references public.fuentes_datos(id) on delete restrict,
  id_externo text not null check (btrim(id_externo) <> ''),
  ocurrido_en timestamptz not null,
  latitud numeric(9,6) not null check (latitud between -90 and 90),
  longitud numeric(10,6) not null check (longitud between -180 and 180),
  magnitud double precision check (magnitud > '-Infinity'::double precision and magnitud < 'Infinity'::double precision),
  tipo_magnitud text,
  profundidad numeric(9,3) not null check (profundidad <> 'NaN'::numeric),
  region text,
  lugar text not null,
  estado_revision text not null default 'sin_especificar',
  url_fuente text not null check (url_fuente like 'https://%'),
  recibido_en timestamptz not null default now(),
  actualizado_fuente_en timestamptz,
  actualizado_en timestamptz not null default now(),
  hash_origen text not null check (hash_origen ~ '^[0-9a-f]{64}$'),
  ultima_ingesta_id uuid not null,
  unique (fuente_id, id_externo),
  foreign key (ultima_ingesta_id, fuente_id)
    references public.ejecuciones_ingesta(id, fuente_id) on delete restrict
);

create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  version integer not null check (version > 0),
  estado text not null default 'borrador' check (estado in ('borrador','publicado','archivado')),
  especificacion jsonb not null check (jsonb_typeof(especificacion) = 'object'),
  periodo_inicio timestamptz not null,
  periodo_fin timestamptz not null,
  numero_filas integer not null default 0 check (numero_filas >= 0),
  informe_calidad jsonb not null default '{}'::jsonb check (jsonb_typeof(informe_calidad) = 'object'),
  transformaciones jsonb not null default '[]'::jsonb check (jsonb_typeof(transformaciones) = 'array'),
  particion_temporal jsonb not null default '{}'::jsonb check (jsonb_typeof(particion_temporal) = 'object'),
  snapshot_path text,
  snapshot_sha256 text check (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  aprobado_por uuid references public.perfiles(id) on delete set null,
  publicado_en timestamptz,
  unique (nombre, version),
  check (periodo_fin > periodo_inicio),
  check (estado = 'borrador' or
    (snapshot_path is not null and snapshot_sha256 is not null and publicado_en is not null))
);

-- Una fila = un experimento/version. No se duplica un registro de modelos.
create table public.modelos_ml (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  version integer not null check (version > 0),
  dataset_id uuid not null references public.datasets(id) on delete restrict,
  objetivo text not null,
  tarea text not null check (tarea in ('regresion','clasificacion')),
  algoritmo text not null,
  features text[] not null check (cardinality(features) > 0),
  target text not null,
  hiperparametros jsonb not null default '{}'::jsonb check (jsonb_typeof(hiperparametros) = 'object'),
  semilla integer not null default 42,
  versiones_librerias jsonb not null default '{}'::jsonb check (jsonb_typeof(versiones_librerias) = 'object'),
  validacion jsonb not null check (jsonb_typeof(validacion) = 'object'),
  metricas jsonb not null default '{}'::jsonb check (jsonb_typeof(metricas) = 'object'),
  baseline jsonb not null default '{}'::jsonb check (jsonb_typeof(baseline) = 'object'),
  estado text not null default 'en_cola'
    check (estado in ('en_cola','entrenando','evaluado','aprobado','rechazado','fallido','retirado')),
  artefacto_path text,
  artefacto_sha256 text check (artefacto_sha256 ~ '^[0-9a-f]{64}$'),
  limitaciones text not null,
  error_resumen text,
  creado_por uuid references public.perfiles(id) on delete set null,
  creado_en timestamptz not null default now(),
  entrenamiento_inicio timestamptz,
  entrenamiento_fin timestamptz,
  aprobado_por uuid references public.perfiles(id) on delete set null,
  aprobado_en timestamptz,
  unique (nombre, version),
  check (entrenamiento_fin is null or
    (entrenamiento_inicio is not null and entrenamiento_fin >= entrenamiento_inicio)),
  check (estado <> 'aprobado' or (artefacto_path is not null and artefacto_sha256 is not null
    and aprobado_en is not null and entrenamiento_fin is not null and metricas <> '{}'::jsonb))
);

create table public.estimaciones (
  id uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references public.modelos_ml(id) on delete restrict,
  zona jsonb not null check (jsonb_typeof(zona) = 'object'),
  zona_codigo text not null,
  ventana_inicio timestamptz not null,
  ventana_fin timestamptz not null,
  metrica text not null,
  valor double precision not null check (valor > '-Infinity'::double precision and valor < 'Infinity'::double precision),
  limite_inferior double precision check (limite_inferior > '-Infinity'::double precision and limite_inferior < 'Infinity'::double precision),
  limite_superior double precision check (limite_superior > '-Infinity'::double precision and limite_superior < 'Infinity'::double precision),
  incertidumbre jsonb not null default '{}'::jsonb check (jsonb_typeof(incertidumbre) = 'object'),
  calculado_en timestamptz not null default now(),
  estado text not null default 'pendiente' check (estado in ('pendiente','publicada','rechazada')),
  revisado_por uuid references public.perfiles(id) on delete set null,
  revisado_en timestamptz,
  advertencia text not null default 'Estimacion experimental; no constituye una alerta oficial ni predice con certeza un sismo.'
    check (btrim(advertencia) <> ''),
  unique (modelo_id, zona_codigo, ventana_inicio, ventana_fin, metrica),
  check (ventana_fin > ventana_inicio),
  check ((limite_inferior is null and limite_superior is null) or
    (limite_inferior is not null and limite_superior is not null
      and limite_inferior <= valor and valor <= limite_superior)),
  check (estado <> 'publicada' or revisado_en is not null)
);

create table public.reglas_alerta (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  version integer not null default 1 check (version > 0),
  fuente_id uuid not null references public.fuentes_datos(id) on delete restrict,
  tipo text not null default 'evento_observado' check (tipo = 'evento_observado'),
  magnitud_minima double precision not null
    check (magnitud_minima > '-Infinity'::double precision and magnitud_minima < 'Infinity'::double precision),
  profundidad_maxima numeric(9,3) check (profundidad_maxima <> 'NaN'::numeric),
  zona jsonb not null default '{}'::jsonb check (jsonb_typeof(zona) = 'object'),
  severidad text not null check (severidad in ('informativa','atencion','alta')),
  canales text[] not null default array['interno']::text[]
    check (cardinality(canales) > 0 and canales <@ array['interno','email','sms','webhook']::text[]),
  destinatarios jsonb not null default '[]'::jsonb check (jsonb_typeof(destinatarios) = 'array'),
  horario jsonb not null default '{}'::jsonb check (jsonb_typeof(horario) = 'object'),
  cooldown_segundos integer not null default 0 check (cooldown_segundos >= 0),
  plantilla text not null,
  requiere_aprobacion boolean not null default true,
  activa boolean not null default false,
  creado_por uuid references public.perfiles(id) on delete set null,
  aprobado_por uuid references public.perfiles(id) on delete set null,
  aprobado_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (not activa or aprobado_en is not null)
);

create table public.alertas (
  id uuid primary key default gen_random_uuid(),
  evento_id uuid not null references public.eventos_sismicos(id) on delete restrict,
  regla_id uuid not null references public.reglas_alerta(id) on delete restrict,
  regla_version integer not null check (regla_version > 0),
  severidad text not null check (severidad in ('informativa','atencion','alta')),
  titulo text not null,
  mensaje text not null,
  url_fuente text not null check (url_fuente like 'https://%'),
  contexto jsonb not null check (jsonb_typeof(contexto) = 'object'),
  estado text not null default 'pendiente'
    check (estado in ('pendiente','aprobada','enviando','enviada','fallida','cancelada')),
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  aprobado_por uuid references public.perfiles(id) on delete set null,
  aprobado_en timestamptz,
  correlacion_id uuid not null default gen_random_uuid(),
  unique (evento_id, regla_id),
  check (estado not in ('aprobada','enviando','enviada') or aprobado_en is not null)
);

create table public.entregas_alerta (
  id uuid primary key default gen_random_uuid(),
  alerta_id uuid not null references public.alertas(id) on delete restrict,
  canal text not null check (canal in ('interno','email','sms','webhook')),
  destinatario text not null check (btrim(destinatario) <> ''),
  usuario_id uuid references public.perfiles(id) on delete set null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente','procesando','enviada','fallida','cancelada')),
  intentos integer not null default 0 check (intentos >= 0),
  historial_intentos jsonb not null default '[]'::jsonb
    check (jsonb_typeof(historial_intentos) = 'array'),
  proximo_intento_en timestamptz,
  ultimo_intento_en timestamptz,
  entregado_en timestamptz,
  error_codigo text,
  proveedor_mensaje_id text,
  acuse_en timestamptz,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  unique (alerta_id, canal, destinatario),
  check (jsonb_array_length(historial_intentos) = intentos),
  check (intentos = 0 or ultimo_intento_en is not null),
  check (estado <> 'enviada' or entregado_en is not null)
);

create table public.reportes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tipo text not null check (tipo in ('eventos','calidad','modelos','alertas','fuentes')),
  formato text not null check (formato in ('csv','xlsx','pdf')),
  filtros jsonb not null check (jsonb_typeof(filtros) = 'object'),
  fecha_corte timestamptz not null,
  manifiesto jsonb not null default '{}'::jsonb check (jsonb_typeof(manifiesto) = 'object'),
  solicitado_por uuid references public.perfiles(id) on delete set null,
  estado text not null default 'en_cola'
    check (estado in ('en_cola','generando','completado','fallido','expirado')),
  archivo_path text,
  archivo_sha256 text check (archivo_sha256 ~ '^[0-9a-f]{64}$'),
  error_resumen text,
  creado_en timestamptz not null default now(),
  finalizado_en timestamptz,
  expira_en timestamptz not null default (now() + interval '7 days'),
  check (expira_en > creado_en),
  check (finalizado_en is null or finalizado_en >= creado_en),
  check (estado <> 'completado' or
    (archivo_path is not null and archivo_sha256 is not null and finalizado_en is not null))
);

create table public.auditoria (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.perfiles(id) on delete set null,
  actor_tipo text not null default 'sistema' check (actor_tipo in ('usuario','sistema')),
  accion text not null,
  entidad text not null,
  entidad_id uuid,
  antes jsonb,
  despues jsonb,
  resultado text not null default 'correcto' check (resultado in ('correcto','error','denegado')),
  ocurrido_en timestamptz not null default now(),
  correlacion_id uuid,
  ip inet
);

create index eventos_fecha_idx on public.eventos_sismicos (ocurrido_en desc);
create index eventos_fuente_fecha_idx on public.eventos_sismicos (fuente_id, ocurrido_en desc);
create index eventos_magnitud_idx on public.eventos_sismicos (magnitud);
create index eventos_coordenadas_idx on public.eventos_sismicos (latitud, longitud);
create index eventos_ingesta_fuente_idx on public.eventos_sismicos (ultima_ingesta_id, fuente_id);
create index ingestas_fuente_fecha_idx on public.ejecuciones_ingesta (fuente_id, iniciado_en desc);
create unique index ingestas_una_activa_idx on public.ejecuciones_ingesta (fuente_id)
  where estado in ('en_cola','ejecutando');
create index modelos_dataset_idx on public.modelos_ml (dataset_id);
create index estimaciones_fecha_idx on public.estimaciones (calculado_en desc);
create index reglas_fuente_idx on public.reglas_alerta (fuente_id);
create index alertas_regla_idx on public.alertas (regla_id);
create index alertas_estado_fecha_idx on public.alertas (estado, creado_en desc);
create index entregas_pendientes_idx on public.entregas_alerta (proximo_intento_en)
  where estado in ('pendiente','fallida');
create index entregas_usuario_idx on public.entregas_alerta (usuario_id);
create index reportes_usuario_fecha_idx on public.reportes (solicitado_por, creado_en desc);
create index auditoria_fecha_idx on public.auditoria (ocurrido_en desc);
create index auditoria_entidad_idx on public.auditoria (entidad, entidad_id, ocurrido_en desc);
create index auditoria_actor_idx on public.auditoria (actor_id);

create function sismocore_private.actualizar_fecha()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- El rol nunca se copia de user_metadata (editable por el propio usuario).
create function sismocore_private.crear_perfil()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles(id, nombre_completo)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  return new;
end;
$$;
create trigger sismocore_auth_perfil after insert on auth.users
for each row execute function sismocore_private.crear_perfil();

-- Usuarios Auth anteriores a esta migracion quedan pendientes, nunca administradores.
insert into public.perfiles(id, nombre_completo)
select id, coalesce(raw_user_meta_data ->> 'full_name', '') from auth.users
on conflict (id) do nothing;

create function sismocore_private.rol_actual()
returns text language sql stable security definer set search_path = '' as $$
  select rol from public.perfiles where id = (select auth.uid()) and estado = 'activo';
$$;
grant usage on schema sismocore_private to authenticated;
revoke all on function sismocore_private.rol_actual() from public, anon;
grant execute on function sismocore_private.rol_actual() to authenticated;

-- Snapshot publicado: contenido y procedencia inmutables; permite archivar y anonimizar autor.
create function sismocore_private.proteger_dataset()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.estado <> 'borrador' and new.aprobado_por is null then
      raise exception 'Publicar requiere aprobador';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.estado <> 'borrador' then raise exception 'No se elimina un dataset publicado'; end if;
    return old;
  end if;
  if old.estado <> 'borrador' and (
    (to_jsonb(new) - array['estado','creado_por','aprobado_por']) is distinct from
    (to_jsonb(old) - array['estado','creado_por','aprobado_por'])
    or new.estado = 'borrador') then
    raise exception 'Crear una nueva version del dataset para modificar su contenido';
  end if;
  if old.estado = 'borrador' and new.estado <> 'borrador' and new.aprobado_por is null then
    raise exception 'Publicar requiere aprobador';
  end if;
  return new;
end;
$$;
create trigger datasets_inmutables before insert or update or delete on public.datasets
for each row execute function sismocore_private.proteger_dataset();

create function sismocore_private.validar_modelo_estimacion()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if (tg_table_name = 'modelos_ml' and old.estado in ('aprobado','retirado'))
       or (tg_table_name = 'estimaciones' and old.estado = 'publicada') then
      raise exception 'No se elimina un modelo aprobado ni una estimacion publicada';
    end if;
    return old;
  end if;
  if tg_table_name = 'modelos_ml' then
    if not exists (select 1 from public.datasets where id = new.dataset_id and estado <> 'borrador') then
      raise exception 'El modelo requiere un dataset publicado';
    end if;
    if tg_op = 'UPDATE' and old.estado in ('aprobado','retirado') and
      ((to_jsonb(new) - array['estado','creado_por','aprobado_por']) is distinct from
       (to_jsonb(old) - array['estado','creado_por','aprobado_por'])
       or new.estado not in ('aprobado','retirado')) then
      raise exception 'Crear otra version para cambiar un modelo aprobado';
    end if;
    if new.estado = 'aprobado' and new.aprobado_por is null then
      -- Se permite anonimizar al eliminar un usuario, sin revocar la aprobacion historica.
      if tg_op = 'INSERT' or old.aprobado_por is null then
        raise exception 'Aprobar modelo requiere aprobador';
      end if;
    end if;
  else
    if tg_op = 'UPDATE' and old.estado = 'publicada' and
      ((to_jsonb(new) - array['estado','revisado_por']) is distinct from
       (to_jsonb(old) - array['estado','revisado_por']) or new.estado = 'pendiente') then
      raise exception 'No se modifica el contenido de una estimacion publicada';
    end if;
    if new.estado = 'publicada' and (tg_op = 'INSERT' or old.estado <> 'publicada') then
    if not exists (select 1 from public.modelos_ml where id = new.modelo_id and estado = 'aprobado') then
      raise exception 'Solo se publican estimaciones de un modelo aprobado';
    end if;
    if new.revisado_por is null then
      raise exception 'Publicar estimacion requiere revisor';
    end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger modelos_validacion before insert or update or delete on public.modelos_ml
for each row execute function sismocore_private.validar_modelo_estimacion();
create trigger estimaciones_validacion before insert or update or delete on public.estimaciones
for each row execute function sismocore_private.validar_modelo_estimacion();

create function sismocore_private.validar_alerta()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.eventos_sismicos e join public.reglas_alerta r on r.fuente_id = e.fuente_id
    where e.id = new.evento_id and r.id = new.regla_id and r.version = new.regla_version and r.activa
  ) then
    raise exception 'La alerta requiere evento y regla activa de la misma fuente/version';
  end if;
  return new;
end;
$$;
create trigger alertas_validacion before insert on public.alertas
for each row execute function sismocore_private.validar_alerta();

-- Auditoria estructurada de cambios criticos, sin copiar mensajes, destinos o secretos.
-- FastAPI conectado por transaccion puede fijar app.actor_id y app.correlacion_id con SET LOCAL.
-- Con service key via REST, registrar actor/correlacion explicitamente desde el backend.
create function sismocore_private.auditar_cambio()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  anterior jsonb; siguiente jsonb; actor uuid; fila_id uuid;
  claves text[] := array['id','nombre','nombre_completo','rol','estado','activa','version',
    'dataset_id','modelo_id','fuente_id','evento_id','regla_id','aprobado_por','aprobado_en',
    'magnitud_minima','profundidad_maxima','zona','severidad','canales','horario',
    'cooldown_segundos','requiere_aprobacion','frecuencia_segundos','snapshot_sha256',
    'artefacto_sha256','revisado_por','revisado_en','tipo','formato','fecha_corte'];
begin
  if tg_op <> 'INSERT' then
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into anterior
    from jsonb_each(to_jsonb(old)) where key = any(claves);
  end if;
  if tg_op <> 'DELETE' then
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into siguiente
    from jsonb_each(to_jsonb(new)) where key = any(claves);
  end if;
  actor := coalesce(auth.uid(), nullif(current_setting('app.actor_id',true),'')::uuid);
  -- Una baja Auth no debe quedar bloqueada por un actor eliminado.
  if actor is not null and not exists (select 1 from public.perfiles where id = actor) then actor := null; end if;
  fila_id := coalesce((siguiente ->> 'id')::uuid, (anterior ->> 'id')::uuid);
  insert into public.auditoria(actor_id,actor_tipo,accion,entidad,entidad_id,antes,despues,correlacion_id)
  values (actor,case when actor is null then 'sistema' else 'usuario' end,
    tg_op,tg_table_name,fila_id,anterior,siguiente,
    nullif(current_setting('app.correlacion_id',true),'')::uuid);
  return null;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['perfiles','fuentes_datos','eventos_sismicos','reglas_alerta','alertas','entregas_alerta'] loop
    execute format('create trigger actualizar_fecha before update on public.%I for each row execute function sismocore_private.actualizar_fecha()',t);
  end loop;
  foreach t in array array['perfiles','fuentes_datos','datasets','modelos_ml','estimaciones','reglas_alerta','alertas','reportes'] loop
    execute format('create trigger auditar_cambio after insert or update or delete on public.%I for each row execute function sismocore_private.auditar_cambio()',t);
  end loop;
  foreach t in array array['perfiles','fuentes_datos','ejecuciones_ingesta','eventos_sismicos','datasets','modelos_ml','estimaciones','reglas_alerta','alertas','entregas_alerta','reportes','auditoria'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on table public.%I from public, anon, authenticated',t);
    execute format('grant select on table public.%I to authenticated',t);
    execute format('grant select, insert, update, delete on table public.%I to service_role',t);
  end loop;
end;
$$;

-- Audit logs son append-only para el servicio normal. El propietario de BD conserva administracion.
revoke update, delete on public.auditoria from service_role;

create policy perfiles_lectura on public.perfiles for select to authenticated
using (id = (select auth.uid()) or (select sismocore_private.rol_actual()) in ('administrador','auditor'));
create policy fuentes_lectura on public.fuentes_datos for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','analista','auditor'));
create policy ingestas_lectura on public.ejecuciones_ingesta for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','analista','auditor'));
create policy eventos_lectura on public.eventos_sismicos for select to authenticated
using ((select sismocore_private.rol_actual()) is not null);
create policy datasets_lectura on public.datasets for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','analista','auditor'));
create policy modelos_lectura on public.modelos_ml for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','analista','auditor'));
create policy estimaciones_lectura on public.estimaciones for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','analista','auditor') or
  ((select sismocore_private.rol_actual()) is not null and estado = 'publicada'));
create policy reglas_lectura on public.reglas_alerta for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','operador','auditor'));
create policy alertas_lectura on public.alertas for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','operador','auditor') or
  ((select sismocore_private.rol_actual()) is not null and estado = 'enviada'));
create policy entregas_lectura on public.entregas_alerta for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','operador','auditor') or
  ((select sismocore_private.rol_actual()) is not null and usuario_id = (select auth.uid())));
create policy reportes_lectura on public.reportes for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','auditor') or
  ((select sismocore_private.rol_actual()) is not null and solicitado_por = (select auth.uid())));
create policy auditoria_lectura on public.auditoria for select to authenticated
using ((select sismocore_private.rol_actual()) in ('administrador','auditor'));

-- Funcion de trigger: sin invocacion directa por clientes.
revoke all on function sismocore_private.actualizar_fecha() from public, anon, authenticated;
revoke all on function sismocore_private.crear_perfil() from public, anon, authenticated;
revoke all on function sismocore_private.proteger_dataset() from public, anon, authenticated;
revoke all on function sismocore_private.validar_modelo_estimacion() from public, anon, authenticated;
revoke all on function sismocore_private.validar_alerta() from public, anon, authenticated;
revoke all on function sismocore_private.auditar_cambio() from public, anon, authenticated;

-- Un bucket privado, tres prefijos: datasets/, modelos/, reportes/.
-- Sin politicas de cliente: acceso a traves de FastAPI y URLs firmadas autorizadas.
insert into storage.buckets (id,name,public)
values ('sismocore-privado','sismocore-privado',false)
on conflict (id) do nothing;

-- Configuracion inicial real del conector existente; no inventa eventos ni terminos de uso.
insert into public.fuentes_datos(codigo,nombre,organizacion,url_api,parametros,limites)
values ('usgs','USGS Earthquake Hazards Program','USGS',
  'https://earthquake.usgs.gov/fdsnws/event/1/query',
  '{"dias":7,"minlatitude":-20,"maxlatitude":0,"minlongitude":-82,"maxlongitude":-68,"minmagnitude":2.5,"eventtype":"earthquake"}',
  '{"limite_actual":200,"timeout_segundos":15,"terminos_verificados":false}');

commit;
