begin;
-- Keep the parameters actually selected during training, without changing earlier experiments.
create or replace function public.sismocore_finalizar_modelo_ml(p_actor uuid,p_id uuid,p_resultado jsonb,p_correlacion uuid)
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
 and jsonb_typeof(p_resultado->'versiones_librerias')='object'
 and (not (p_resultado ? 'hiperparametros') or jsonb_typeof(p_resultado->'hiperparametros')='object')) is not true then raise sqlstate 'PT422' using message='Resultado invalido'; end if;
 perform set_config('app.actor_id',p_actor::text,true); perform set_config('app.correlacion_id',p_correlacion::text,true);
 update public.modelos_ml set estado=p_resultado->>'estado',entrenamiento_fin=clock_timestamp(),
 metricas=coalesce(p_resultado->'metricas','{}'::jsonb),baseline=coalesce(p_resultado->'baseline','{}'::jsonb),versiones_librerias=coalesce(p_resultado->'versiones_librerias','{}'::jsonb),
 hiperparametros=coalesce(p_resultado->'hiperparametros',hiperparametros),
 artefacto_path=p_resultado->>'artefacto_path',artefacto_sha256=p_resultado->>'artefacto_sha256',
 error_resumen=case when exito then null else 'No se pudo completar el experimento. Revisa la calidad y la variedad del dataset.' end
 where id=p_id and creado_por=p_actor and estado='entrenando' returning * into m;
 if not found then raise sqlstate 'PT409' using message='El experimento cambio'; end if;
 return to_jsonb(m);
end $$;
revoke all on function public.sismocore_finalizar_modelo_ml(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.sismocore_finalizar_modelo_ml(uuid,uuid,jsonb,uuid) to service_role;
notify pgrst,'reload schema';
commit;
