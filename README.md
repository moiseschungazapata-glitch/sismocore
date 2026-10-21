# SISMOCORE

Monitoreo local de eventos observados: USGS → sincronización FastAPI → Supabase → React.

## Iniciar en Windows

Haz doble clic en **Iniciar SISMOCORE.cmd** y mantén la ventana abierta. Abre http://localhost:5173.

También puedes ejecutar `npm run dev` desde la raíz o desde `apps/web`. Ambos comandos arrancan FastAPI y Vite; no necesitas abrir una segunda terminal. Si un servicio ya está disponible, el iniciador lo reutiliza. Ctrl+C detiene los procesos que haya iniciado esa ejecución; un servicio previo sigue perteneciendo a su terminal original.

Requisitos: Node.js LTS con npm, Python 3.11 o posterior y conexión a Internet. El iniciador prepara las dependencias que falten. Para seleccionar Python explícitamente, define PYTHON_EXE. El entorno Python local queda en `services/api/.venv`.

## Conexión privada

Copia `services/api/.env.example` a `services/api/.env` y configura SUPABASE_URL y SUPABASE_SECRET_KEY. En este equipo la conexión ya fue configurada con el proyecto vinculado. No subas ese archivo a Git ni copies su clave al frontend.

La credencial local no viaja al clonar el repositorio; cada entorno debe configurar la suya. Las migraciones ya existentes no deben ejecutarse de nuevo: usa el historial de Supabase para determinar qué falta.

El frontend usa el proxy de Vite, por lo que no necesita una clave de Supabase para el monitoreo. Para otro backend, configura VITE_API_URL (origen público) o API_PROXY_TARGET (solo desarrollo). Ninguna variable VITE_* debe contener una clave secreta.

## Qué funciona

- API en http://127.0.0.1:8000 y documentación en /docs.
- /health verifica realmente el acceso de servidor a Supabase.
- /api/v1/eventos/ consulta eventos persistidos, no solicita USGS por cada visita.
- El proceso interno sincroniza al arrancar y cada cinco minutos. Valida coordenadas, valores finitos, identificador, fecha y URL; registra ejecuciones/rechazos y conserva la primera recepción al actualizar un evento.
- La clave única proveedor/ID externo evita duplicados. Los datos guardados siguen consultables si USGS falla. La pantalla muestra la última sincronización y el resultado de la ejecución.
- Dashboard, tabla, mapa, estadísticas descriptivas y CSV comparten consulta y filtros. La interfaz vuelve a consultar cada 30 segundos.
- El botón Actualizar datos vuelve a consultar la base; no dispara una escritura ni una sincronización pública.

Cobertura inicial: últimos siete días, magnitud mínima 2.5 y rectángulo alrededor de Perú. Puede incluir países vecinos y no equivale al catálogo completo del IGP. No se inventan eventos para llenar la pantalla. La tarea vuelve a consultar la ventana reciente para recoger revisiones del proveedor; no implementa todavía un backfill histórico completo.

## Acceso y alcance

Las rutas HTTP de monitoreo son de solo lectura y entregan observaciones públicas, estado general y contadores seguros. El servidor local escucha en 127.0.0.1. Las tablas conservan RLS y el navegador no recibe la clave de servidor. No se habilitan endpoints administrativos con esa clave.

ML, reglas/envío de alertas, login, administración y consulta de auditoría siguen pendientes y aparecen indicados como tales. No se muestran métricas ficticias ni se presenta su estructura de tablas como funcionalidad terminada.

Para publicar, configurar el backend y frontend remotos, CORS, HTTPS, autenticación según el público previsto y un programador externo para la ingesta. El bucle de sincronización actual está diseñado para el proceso local persistente, no para confiar en la duración de una función serverless.

## Comprobaciones

Desde la raíz:

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run test:api
```

Las pruebas Python usan unittest/HTTPX y datos simulados; no escriben en Supabase. Cubren validación, fallos del proveedor, sincronización repetida, revisiones, preservación de ID/recepción y respuestas seguras de la API.

`scripts/smoke.mjs` comprueba la aplicación real en Chrome: catálogo, filtros, mapa, análisis, estado de fuentes y CSV. Requiere Playwright disponible o PLAYWRIGHT_MODULE apuntando a su index.mjs. Sus capturas/descargas quedan en `.runtime`, excluido de Git.

## Si no carga

- API no disponible: inicia con el archivo CMD o con `npm run dev`; revisa la salida de esa ventana.
- API disponible, Supabase desconectado: verifica el archivo privado del backend y la disponibilidad del proyecto. Reinicia después de cambiar variables.
- Catálogo vacío: espera a que termine la primera sincronización y consulta Fuentes de datos. Revisa el periodo, magnitud y filtros.
- Puerto ocupado por otra aplicación: libera ese puerto; el iniciador no termina procesos ajenos.
- USGS no responde: se conserva el catálogo anterior y se reintenta en la siguiente ejecución.

La cuenta y las claves usadas para operar la CLI no sustituyen las variables de conexión del servidor.
