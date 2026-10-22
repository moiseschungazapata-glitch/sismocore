# Activar IGP/CENSIS en SISMOCORE

La fuente principal es el servicio público de Sismos Reportados del IGP:
https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0

El adaptador consulta 30 días por defecto, pagina los resultados y valida los registros.
No necesita una clave del IGP. Al sincronizar registra automáticamente el conector
`igp` en `fuentes_datos` si falta. No elimina datos ni modifica el conector USGS;
el catálogo nuevo solo muestra registros y ejecuciones de la fuente IGP.
Las fechas recibidas como epoch se interpretan en UTC y la pantalla muestra hora de Perú.
El proveedor no especifica aquí la escala de magnitud ni la fecha de última revisión;
esos campos quedan sin dato, no se inventan.

## 1. Subir los cambios

Publicar los archivos modificados, incluidos `.github/workflows/sync-igp.yml`,
`scripts/sync-catalog.py` y `services/api/app/services/igp.py`, en la rama `main`.
No subir `.env` ni `.runtime`.

## 2. Configurar GitHub Actions

En el repositorio abrir **Settings → Secrets and variables → Actions → New repository secret**.
Crear estos dos secretos usando los mismos valores del servidor:

| Nombre | Valor |
| --- | --- |
| SUPABASE_URL | URL del proyecto Supabase usado por SISMOCORE |
| SUPABASE_SECRET_KEY | Clave privada del servidor de ese mismo proyecto |

En **Actions → Sincronizar sismos del IGP → Run workflow**, lanzar una ejecución
manual y comprobar que termina correctamente. Después se ejecutará aproximadamente
cada diez minutos. No hace falta guardar una clave del IGP ni programar un cron de Vercel.
GitHub puede retrasar las tareas y desactivar las programadas en repositorios públicos
tras 60 días sin actividad. Revisar Actions si la última sincronización deja de avanzar.

## 3. Configurar Vercel

Conservar las variables privadas de conexión, `AUTH_COOKIE_SECURE=true` y
`CORS_ORIGINS` con el dominio de producción. Establecer:

```dotenv
CATALOG_DAYS=30
SYNC_INTERVAL_SECONDS=600
```

Volver a desplegar después de cambiar variables. Vercel sirve las consultas;
GitHub Actions ejecuta la ingesta. El bucle local de sincronización se desactiva
automáticamente cuando `VERCEL=1`, para evitar depender de procesos persistentes.

## 4. Comprobar el sistema

Abrir Fuentes de datos: debe indicar IGP/CENSIS y una ejecución completada.
Los contadores muestran los registros reales recibidos, insertados, actualizados o rechazados.
Dashboard, tabla, mapa, análisis y reporte Excel comparten el catálogo del IGP.
El botón Actualizar datos consulta lo ya guardado; no ejecuta una importación.

Una consulta cada diez minutos no garantiza nuevos sismos ni publicación inmediata del IGP.
La última sincronización y la fecha del último evento son datos diferentes.

## Comprobaciones locales

```powershell
services/api/.venv/Scripts/python.exe scripts/sync-catalog.py --check-only
services/api/.venv/Scripts/python.exe scripts/sync-catalog.py
```

El primer comando solo consulta y valida el servicio público. El segundo escribe
la sincronización en el Supabase configurado, conservando los IDs al actualizar registros.
