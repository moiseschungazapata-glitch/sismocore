# Revisión del plan frente a SISMOCORE

Fecha de revisión: 20 de octubre de 2026, zona America/Lima.

## 1. Dictamen y alcance de la revisión

El proyecto tiene una base de React + TypeScript + Vite, una API FastAPI, una consulta real programada contra USGS y visualización de eventos mediante tabla y mapa Leaflet. Es un prototipo de monitoreo con integración inicial de datos. Todavía no cumple el MVP empresarial del PDF ni contiene un sistema de Machine Learning, alertas operativas o persistencia.

Se revisaron las nueve páginas del PDF, su texto completo y su representación visual; el código fuente local, configuración, dependencias declaradas y archivos versionados de C:/sismocore. El PDF se usó como referencia de requisitos: sus propuestas no se ejecutaron como instrucciones para modificar la aplicación.

Estados empleados:

- **Implementado en código:** existe lógica concreta. No equivale a verificar funcionamiento en producción.
- **Parcial:** hay una parte funcional, pero faltan elementos del requisito.
- **Maqueta:** existe pantalla, texto o control visual sin servicio funcional asociado.
- **Ausente:** no hay implementación local encontrada.
- **No verificado:** requiere un entorno, ejecución o evidencia que no está disponible.

No se auditó ningún despliegue externo ni otra copia del proyecto. No se modificó el código de la aplicación. No se asigna un porcentaje de avance: el documento no pondera requisitos y contar pantallas daría una medida engañosa.

## 2. Lo que ya está implementado

| Elemento | Evidencia local | Alcance real |
|---|---|---|
| Separación frontend/backend | apps/web y services/api | Coincide con la base del monorepositorio propuesto. |
| React + TypeScript + Vite | apps/web/package.json y src/main.tsx | Dependencias, entrada y comandos de desarrollo, build y lint declarados. |
| Interfaz de SISMOCORE | apps/web/src/App.tsx y App.css | Cabecera, menú lateral, tarjetas reutilizables, diez vistas y navegación interna. |
| Accesibilidad inicial | App.tsx y App.css | Botones nativos, varios aria-label, aria-current, estilos de foco y reducción de movimiento. No hay auditoría de accesibilidad completa. |
| Adaptación a pantallas | App.css | Reglas responsive y contenedor horizontal para tabla; comportamiento visual pendiente de prueba en navegador. |
| API FastAPI | services/api/main.py | Aplicación, título, descripción, versión e inclusión de routers. |
| Configuración inicial | services/api/app/core/config.py | Nombre, versión 0.1.0, prefijo /api/v1 y DEBUG. Valores fijos en código. |
| Comprobación básica de API | routes/health.py y src/services/api.ts | /health y cliente que muestra conexión/desconexión. |
| CORS local limitado | services/api/main.py | Dos orígenes locales permitidos. |
| Adaptador inicial de USGS | routes/eventos.py | Solicitud GeoJSON con timeout de 15 segundos y conversión a seis campos. |
| Manejo de fallos de red | routes/eventos.py | HTTPError, URLError, TimeoutError y OSError producen HTTP 502 con mensaje general. |
| Listado de eventos | App.tsx, ContenidoEventos | Tabla, carga, error, reintento y ausencia de resultados. |
| Búsqueda y filtro inicial | App.tsx, ContenidoEventos | Búsqueda local por lugar/ID; magnitudes menores a 4, de 4 a menos de 6 y desde 6. |
| Indicadores de eventos | App.tsx, ContenidoEventos | Conteo filtrado, magnitud promedio y máxima del conjunto recibido. Los dos últimos no siguen el filtro. |
| Mapa real | components/MapaSismico.tsx | Leaflet, teselas OpenStreetMap y atribución, círculos por evento, colores/tamaño por magnitud, encuadre automático y popup. |
| Tratamiento inicial de magnitud faltante | api.ts, App.tsx y MapaSismico.tsx | Tipo number o null, texto alternativo, exclusión de promedios y color gris. |
| Reproducibilidad inicial | package-lock.json y requirements.txt | Lock de frontend y versiones Python fijadas; instalación no comprobada. |

## 3. Cobertura exacta de los datos actuales

El backend consulta cada vez que se solicita GET /api/v1/eventos/:

- Fuente fija: USGS Earthquake Hazards Program.
- Periodo fijo: últimos siete días respecto al reloj UTC del servidor.
- Rectángulo fijo: latitud -20 a 0; longitud -82 a -68.
- Magnitud mínima fija: 2.5.
- Máximo fijo: 200 registros, ordenados por tiempo del proveedor.
- Tipo solicitado: earthquake.
- Respuesta por evento: id, magnitud, lugar, latitud, longitud y profundidad.
- Respuesta general: total, eventos, fuente y mensaje.

Implicaciones:

1. El rectángulo es un área alrededor de Perú, no una delimitación administrativa del país. Puede incluir países vecinos y océano; no identifica departamento, provincia ni distrito.
2. No es un catálogo de todos los sismos: el propio código limita periodo, magnitud, área y cantidad, además de la cobertura del proveedor.
3. El campo total cuenta lo devuelto después del descarte local, no el total histórico ni necesariamente todos los resultados posibles del proveedor.
4. No hay aviso si se alcanza el límite de 200, ni paginación para recuperar el resto.
5. Los registros viven en memoria de la pantalla y de la solicitud. No se guardan en PostgreSQL ni se conserva una copia persistente verificable.
6. No se devuelve la fecha del evento, aunque el proveedor la incluya. Tampoco se conserva su URL, tipo de magnitud o estado de revisión.
7. La consulta usa UTC para su ventana, pero no almacena ni expone timestamps de los eventos o de recepción.
8. No hay consulta periódica automática. Eventos y Mapa solicitan por separado al montarse; navegar entre ellos puede volver a consultar la fuente.
9. Que /health responda no demuestra que USGS, la base de datos o un proceso de ingesta estén disponibles.

## 4. Revisión de los 13 módulos del PDF

### 6.1 Inicio / Dashboard — Maqueta con comprobación de API

**Existe:** composición visual, cuatro tarjetas, accesos rápidos y estado básico del frontend/API.

**Pendiente, campo por campo:** periodo consultable; región/zona; total real de eventos; eventos recientes; distribución por magnitud; profundidad media/mediana; última sincronización; estado real de fuentes; alertas activas; calidad y latencia.

**Pendiente de interfaz:** línea de eventos por tiempo, barras de magnitud, mapa integrado y panel de conectores con datos reales.

**Detalle:** el dashboard no llama a obtenerEventos(). Sus métricas son guiones y sus textos dicen que falta conectar datos, aunque la consulta de USGS ya exista en otras vistas. El estado Frontend es fijo y el de base de datos es un texto pendiente, no una prueba de servicio.

### 6.2 Eventos sísmicos — Parcial y funcional en código

| Campo pedido | Estado actual |
|---|---|
| ID interno | Ausente; se usa directamente el ID recibido. |
| ID externo | Presente bajo id, sin separación del identificador interno. |
| Proveedor | Presente solo a nivel general de respuesta; no identificado por fila y la tarjeta muestra API / Backend SISMOCORE. |
| Fecha/hora UTC del evento | Ausente en respuesta, tipo y tabla. |
| Latitud y longitud | Presentes, sin validación de tipo ni rango. |
| Magnitud | Presente y admite null. |
| Tipo de magnitud | Ausente. |
| Profundidad en km | Presente y etiquetada como km en interfaz. |
| Región | Ausente como campo normalizado. |
| Localidad | Parcial: lugar libre del proveedor. |
| Estado de revisión | Ausente. |
| URL fuente | Ausente por evento. |
| Fecha de recepción | Ausente. |
| Hash de origen | Ausente. |

**Consulta:** hay tabla y búsqueda por lugar/ID y categorías de magnitud en el navegador. Faltan filtros por fecha, profundidad, proveedor y zona; magnitud mínima/máxima configurable; paginación; orden configurable; ficha individual; mapa dentro de la ficha y procedencia enlazada. El límite de la consulta no equivale a paginación.

### 6.3 Mapa sísmico — Parcial y funcional en código

**Existe:** coordenadas reales recibidas, mapa base, zoom, encuadre de todos los eventos, círculos y popup con lugar, magnitud, profundidad y coordenadas. El color cambia a partir de 2.5, 4 y 6; los valores nulos son grises.

**Campos pendientes:** área elegible por usuario; radio o polígono; rango temporal; magnitud mínima/máxima; selector de capa; leyenda explicativa; hora de actualización. La fuente USGS se menciona en el texto, pero no hay enlace individual de procedencia.

**Funciones pendientes:** agrupación de puntos, filtros compartidos con tabla/dashboard, detalle accesible por teclado a verificar, fecha UTC y URL en popup. La tabla es una alternativa textual útil, pero no verifica por sí sola accesibilidad del mapa.

Los círculos usan radio visual en pantalla; no representan una zona de impacto calculada. Conviene explicarlo en la leyenda para evitar una interpretación equivocada.

### 6.4 Análisis estadístico — Maqueta

**Existe:** cuatro paneles de texto para futuras gráficas.

**Campos pendientes:** fecha inicial/final; zona; magnitud mínima; profundidad; agrupación temporal; variable X/Y; resolución; dataset; método y fecha de ejecución.

**Funciones pendientes:** serie temporal; histograma; dispersión magnitud-profundidad; conteo por región; tabla exportable; tamaño de muestra y faltantes. El promedio y máximo de la vista Eventos no completan este módulo.

### 6.5 Preparación de datos — Ausente

No hay pantalla específica ni servicio de datasets.

**Todos los campos pendientes:** dataset; fuente; periodo; versión; filas; duplicados; nulos por campo; reglas de limpieza; método de imputación; variables; objetivo; partición temporal y responsable.

**Funciones pendientes:** informe de calidad, vista previa, validaciones, trazabilidad de transformaciones y aprobación del dataset. Descartar coordenadas incompletas dentro del endpoint no constituye un pipeline de calidad reproducible.

### 6.6 Modelos de Machine Learning — Maqueta

**Existe:** pantalla con indicadores sin datos y mensaje explícito de que no hay modelos integrados.

**Todos los campos pendientes:** nombre; objetivo; algoritmo; versión; dataset_version; features; target; fecha de entrenamiento; hiperparámetros; métricas; periodo de validación; ruta de artefacto; estado; responsable y limitaciones.

**Funciones pendientes:** entrenamiento, inferencia separada, registro de experimentos, comparación de modelos, real-vs-estimada y matriz de confusión. No hay código ML ni pandas, NumPy, scikit-learn o joblib declarados en requirements.txt.

### 6.7 Estimaciones experimentales — Ausente

No hay pantalla dedicada, endpoint, resultados ni persistencia.

**Todos los campos pendientes:** modelo; versión; zona/unidad espacial; ventana temporal; indicador; probabilidad o valor; intervalo/incertidumbre; fecha de cálculo; dataset; advertencia y estado de revisión.

Faltan etiquetas de experimental, contexto y aprobación. No se encontró una implementación que mezcle estimaciones con alertas oficiales, pero la separación funcional todavía no puede probarse porque no existen ambos flujos.

### 6.8 Reglas de alertas — Ausente

La pantalla Alertas no contiene un constructor de reglas.

**Todos los campos pendientes:** nombre; tipo; magnitud mínima; profundidad opcional; zona/polígono; fuente permitida; severidad; canal; destinatarios/grupo; horario; estado; cooldown; plantilla y aprobador.

Faltan simulación, prueba de condiciones, permisos para activar y motor de evaluación sobre eventos recibidos.

### 6.9 Centro de alertas — Maqueta

**Existe:** selector todas/activas/resueltas que cambia un texto, no consulta ni filtra alertas reales.

**Todos los campos pendientes:** ID; evento; regla; severidad; título; mensaje; fuente oficial; creación; aprobador; canal; destinatario; estado de envío; intentos; entrega; error y acuse.

Faltan bandeja priorizada, deduplicación, reintentos, auditoría e historial. Los estados visuales activas/resueltas tampoco modelan los estados pendiente/enviada/fallida/cancelada pedidos para entrega.

### 6.10 Fuentes de datos — Adaptador parcial; pantalla de gestión maqueta

**Existe:** una URL fija y una consulta USGS implementada en el endpoint de eventos. No hay registro administrable de fuentes.

**Campos parciales:** nombre/organización deducibles del texto y URL del conector en código. **Pendientes:** tipo administrable; frecuencia; última ejecución; último éxito; latencia; estado verificable; límites documentados; licencia; contacto y referencia de secretos cuando aplique.

Faltan logs de sincronización, sincronización manual autorizada, programación y métricas de calidad. La pantalla muestra cero fuentes e ingesta inactiva; no refleja el adaptador existente. La consulta pública implementada no necesita por sí misma que se añada un secreto.

### 6.11 Reportes — Maqueta

**Existe:** selector de tipo de informe y texto de preparación. No genera archivos.

**Campos pendientes:** nombre; periodo; zona; filtros; formato; solicitante; fecha; estado; ruta temporal y expiración.

Faltan CSV/XLSX/PDF, permisos, fuente y fecha de corte, gráficos y reportes de eventos/calidad/modelos/alertas. El tipo Estado de estaciones no corresponde a uno de los 13 módulos definidos: es alcance adicional si se decide mantenerlo.

### 6.12 Usuarios y roles — Maqueta

**Existe:** dos paneles informativos. No hay login, sesiones, usuarios reales ni permisos.

**Campos pendientes:** nombre; correo; rol; estado; último acceso; fecha de alta y permisos. MFA está condicionado por el PDF a disponibilidad.

Faltan los roles Administrador, Analista, Operador de alertas, Auditor y Solo lectura, y bloqueo efectivo tanto en frontend como en API. Tener una entrada de menú no acredita autorización.

### 6.13 Auditoría y configuración — Maqueta de auditoría; configuración funcional ausente

**Existe:** pantalla sin registros y clase de constantes técnicas del backend.

**Campos pendientes:** actor; acción; entidad; ID; antes/después sin secretos; fecha UTC; IP según política; resultado; correlación y parámetros administrables.

Faltan historial protegido, retención configurable, exportación auditada y control de cambios. La clase Settings no equivale a este módulo.

## 5. Arquitectura y carpetas frente al plan

| Componente | Resultado |
|---|---|
| apps/web | Existe. |
| src/app con router/providers/layout/guards | Ausente como organización; layout y cambio de pantalla dentro de App.tsx. |
| src/modules por dominio | Ausente; las vistas se concentran en App.tsx. |
| components reutilizables | Parcial: MapaSismico separado; tarjetas y otros componentes dentro de App.tsx. |
| services HTTP | Existe api.ts, limitado a salud/eventos. |
| hooks, schemas, types, lib | Sin carpetas dedicadas; algunos tipos/hooks están integrados en archivos existentes. |
| services/api | Existe con routers y configuración; faltan schemas, capa de negocio y acceso a datos. |
| services/ingestion | Ausente; consulta acoplada al endpoint. |
| services/ml | Ausente. |
| database/migrations, seeds, diagrams | Ausentes. |
| tests | Ausente. |
| infra | Ausente. |
| docs | Ausente al inicio de la revisión; este informe no sustituye manuales del sistema. |
| .env.example | Existe, vacío. |

La estructura del PDF es una propuesta: no es obligatorio reproducir literalmente cada carpeta. Sí falta la separación de responsabilidades que busca esa propuesta. Tailwind no es obligatorio si se usa un sistema de diseño propio; Leaflet ya satisface una de las alternativas de mapa. Redis/Celery/RQ y PostGIS son opcionales o incorporables según necesidad.

## 6. PostgreSQL: completamente pendiente

No se encontraron conexión, credenciales configurables, modelos, SQL, ORM, migraciones ni persistencia alternativa. Tampoco se declara un controlador PostgreSQL.

Tablas o conjuntos de tablas propuestos, todos sin implementar:

| Tabla | Elementos que faltan |
|---|---|
| users | Identidad, nombre, correo único, estado, alta. Integración con proveedor de identidad si se elige. |
| roles / user_roles | Roles normalizados y relaciones de asignación. |
| data_sources | Nombre, URL, tipo, estado, última sincronización y referencia de configuración. |
| ingestion_runs | Fuente, inicio/fin, estado, vistos, insertados, resumen de error e índice por fuente/fecha. |
| seismic_events | UUID, ID externo/fuente, fecha UTC, coordenadas, magnitud/tipo, profundidad, lugar, URL, recepción y revisión. |
| datasets | Nombre, versión, consulta exacta, periodo, filas, informe de calidad, autor y fecha. Inmutabilidad de versiones publicadas. |
| ml_experiments | Tarea, algoritmo, dataset, variables, objetivo, parámetros, métricas, validación, estado, artefacto y fecha. |
| model_registry | Experimento, versión, estado, aprobador, fecha y limitaciones. |
| risk_estimates | Modelo, área, ventana, métrica, valor, límites, fecha y advertencia. |
| alert_rules | Condición validada, severidad, zona, canales, cooldown, estado y creador. |
| alerts | Evento, regla, título, mensaje, fuente, estado, creación y aprobación. |
| alert_deliveries | Alerta, canal, destino, estado, intentos, última ejecución, entrega y error. |
| audit_logs | Actor, acción, entidad, antes/después sin secretos, UTC y correlación. |
| report_jobs | Solicitante, tipo, filtros, estado, archivo, creación y expiración. |

Pendientes transversales: claves UUID internas; claves foráneas; CHECK geográficos; timestamps UTC persistidos; unicidad fuente + ID externo; índices temporales, de magnitud y coordenadas; migraciones versionadas y revisadas; semilla/versiones de librerías/partición de experimentos; permisos; retención; backup y restauración.

El hash de origen aparece en los campos funcionales del módulo Eventos, aunque no figura en la lista esencial de seismic_events. Debe decidirse y documentarse cómo conservarlo al cerrar el modelo.

## 7. API: existente y pendiente

**Rutas explícitas del código actual:** GET /, GET /health y GET /api/v1/eventos/. FastAPI aporta la base para OpenAPI/documentación automática, pero no se verificó un servidor ejecutándose y no hay esquemas de respuesta definidos para estos datos.

| Dominio propuesto | Estado |
|---|---|
| GET /api/v1/events | Equivalente parcial en español /api/v1/eventos/, sin filtros de consulta ni paginación. |
| GET /api/v1/events/{id} | Ausente. |
| GET /api/v1/dashboard/summary | Ausente. |
| GET /api/v1/analytics/timeseries | Ausente. |
| GET /api/v1/events/geojson | Ausente; consumir GeoJSON de USGS internamente no equivale a exponer esta ruta. |
| GET /api/v1/sources | Ausente. |
| POST /api/v1/sources/{id}/sync | Ausente. |
| GET/POST /api/v1/datasets | Ausentes. |
| GET /api/v1/datasets/{id}/quality | Ausente. |
| POST /api/v1/ml/experiments | Ausente. |
| GET /api/v1/ml/experiments/{id} | Ausente. |
| POST /api/v1/ml/models/{id}/approve | Ausente. |
| GET /api/v1/estimates y /estimates/{id} | Ausentes. |
| GET/POST /api/v1/alert-rules | Ausentes. |
| GET /api/v1/alerts | Ausente. |
| POST /api/v1/alerts/{id}/approve | Ausente. |
| POST /api/v1/reports y GET /reports/{id} | Ausentes. |
| GET /api/v1/audit-logs | Ausente. |
| CRUD restringido de usuarios/roles | Ausente. |

El PDF llama orientativos a los endpoints. Usar eventos en vez de events no es por sí solo un incumplimiento; sí faltan sus capacidades. /health fuera del prefijo es una convención posible para infraestructura.

Pendientes de estándares: modelos Pydantic de entrada/salida; filtros y paginación validados; formato de error coherente; correlation ID; límites de frecuencia/tamaño; autorización; respuestas documentadas. Ya se usa un 502 razonable para fallos de red del proveedor y se evita devolver el detalle interno de esas excepciones.

## 8. Machine Learning y gráficas: cobertura del contenido académico

Las operaciones de la sección 10 todavía no están implementadas:

- Describir la tarea supervisada, pregunta medible, target, features y limitaciones.
- Definir y demostrar regresión lineal simple y múltiple.
- Implementar el laboratorio reproducible en Python.
- Limpiar, deduplicar, transformar/codificar y dividir por tiempo.
- Definir baseline y comparar alternativas sencillas.
- Conservar dataset/configuración exactos y separar entrenamiento de inferencia.
- Registrar semilla, librerías, artefactos y versiones.
- Publicar resultados experimentales con incertidumbre cuando sea posible.
- Medir MAE, RMSE y R² en regresión; precision, recall, F1, confusión y calibración en clasificación.
- Controlar fuga de información, revisar etiquetas, falsos positivos/negativos y validar la pregunta con especialistas.

| Gráfica requerida en sección 11 | Estado |
|---|---|
| Eventos por tiempo | Ausente. |
| Distribución por magnitud | Ausente. |
| Magnitud vs. profundidad | Ausente. |
| Mapa geográfico | Parcial: puntos y magnitud; sin filtro temporal, leyenda ni fecha de actualización. |
| Comparación de modelos | Ausente. |
| Calidad de datos | Ausente. |
| Estado de alertas | Ausente. |

Faltan, como contrato común de las visualizaciones, unidades, periodo, filtros aplicados, tamaño de muestra, actualización y fuente visible. El mapa ya muestra coordenadas, magnitud y km en popup, y el texto de la página menciona USGS.

El límite científico del PDF forma parte del alcance: el objetivo no es afirmar fecha/lugar/magnitud exactos de un futuro sismo. Este informe evalúa cumplimiento del documento; no certifica científicamente modelos o proveedores.

## 9. Problemas concretos y detalles pequeños encontrados

| Prioridad | Hallazgo | Efecto y acción pendiente |
|---|---|---|
| Alta | No se conserva fecha/hora del evento | No se puede comprobar antigüedad ni construir series temporales con la respuesta actual. Añadir timestamp de origen y recepción. |
| Alta | No hay URL de origen por evento | Falta trazabilidad y acceso a la ficha del proveedor. Conservarla y mostrarla. |
| Alta | Sin persistencia | No existe histórico propio ni ejecución de ingesta auditable. Implementar base y sincronización. |
| Alta | Coordenadas solo se validan por cantidad | Valores null o fuera de rango pasan y pueden romper .toFixed() o Leaflet. Validar esquema y rangos, contabilizar rechazos. |
| Alta | JSON inválido del proveedor no controlado | JSONDecodeError escapa del manejo actual. Añadir manejo de payload inválido y respuesta controlada. |
| Alta | API_URL fijo en 127.0.0.1:8000 | En un despliegue remoto apunta al equipo de cada visitante. Configurar por entorno o un origen compartido. |
| Alta al publicar | Sin identidad/autorización | No hay roles ni protección de operaciones futuras. Implementar antes de habilitar administración/alertas. |
| Media | Filtros y métricas no comparten conjunto | El conteo usa eventosFiltrados, pero promedio y máximo usan eventos. Aclarar ámbito o calcular todos sobre el mismo filtro. |
| Media | Mapa y tabla tienen estado separado | El filtro de Eventos no afecta al mapa; abrir cada vista puede traer otra muestra. Compartir consulta/filtros y fecha de corte. |
| Media | Datos iniciales y textos se contradicen | Dashboard, fuentes y pie dicen que la integración está pendiente. Conectar estados a la realidad del servicio. |
| Media | Límite 200 sin aviso | Un conjunto truncado puede parecer completo. Incluir paginación o marca de truncamiento. |
| Media | Ventana, magnitud y zona fijas | No son filtros ofrecidos al usuario. Exponer parámetros validados. |
| Media | Sin actualización programada | El estado puede envejecer con la vista abierta. Definir frecuencia, última actualización y control de errores. |
| Media | /health solo verifica respuesta básica | Una API disponible puede ocultar una fuente caída. Separar vida del proceso y disponibilidad de dependencias. |
| Media | Descartes silenciosos | Coordenadas incompletas desaparecen sin informe de calidad. Registrar conteo y causa. |
| Media | No hay validación completa de estructura upstream | properties null, features inválido o tipos inesperados no están cubiertos. Definir contrato de normalización. |
| Media | No hay timeout/cancelación en fetch del navegador | El timeout del proveedor no sustituye el control del cliente. Gestionar solicitudes obsoletas y errores. |
| Media | Estado API se consulta al montar o reintentar | El indicador puede quedar desactualizado. Definir política de refresco. |
| Media | DEBUG=True fijo | Adecuarlo por entorno antes de publicar. |
| Media | Navegación con useState | Sin URL propia por módulo; recargar vuelve a dashboard y no hay historial de navegación por módulo. Usar router si se necesita esa experiencia. |
| Baja | Tarjetas Epicentros y Fuente de datos llaman a una función vacía | Se anuncian como Abrir módulo, pero no hacen nada. Convertir en información o darles destino real. |
| Baja | HTML lang=en y title=web | Cambiar a es y título SISMOCORE; mejora identificación y lectura asistida. |
| Baja | App.tsx tiene 1688 líneas, muchas vacías | Separar vistas, componentes y lógica por dominio facilita ampliación. La longitud sola no es un error funcional. |
| Baja | CSS acumulado y duplicado | Hay varias definiciones de section-grid y restos de plantilla en index.css; revisar cascada e imports antes de afirmar un defecto visual. |
| Baja | Selector .app-layout sin uso en App.tsx | Estilo residual; la clase real es layout. |
| Baja | Assets de plantilla React/Vite y hero sin referencias en src | Limpieza opcional para reducir ruido. |
| Baja | README sigue siendo el de Vite | No documenta SISMOCORE, backend, entorno ni operación. |
| Baja | .env.example vacío | No explica ninguna variable y Settings no carga valores del entorno. |
| Baja | __pycache__ y .pyc versionados en backend | Añadir exclusión adecuada y retirar archivos generados del versionado en una tarea de limpieza. |
| Baja | Sin .gitignore en la raíz/backend | El .gitignore existente es solo el de apps/web; falta cobertura del servicio Python y archivos locales. |
| Alcance | Estaciones sísmicas aparece en KPI/reportes | No es un módulo exigido por este PDF. Decidir si se elimina o se planifica como extra. |

No se detectaron credenciales explícitas en los archivos de código revisados; esto no constituye un análisis completo de secretos del historial Git.

## 10. Seguridad, confiabilidad y continuidad

**Ya existe:** lista restringida de orígenes locales CORS; llamada HTTPS al proveedor; timeout del backend; mensajes genéricos para fallos de red; tratamiento visual básico de error y reintento.

**Pendiente:**

- HTTPS para servir la aplicación y API en despliegue. HTTPS hacia USGS no demuestra HTTPS de la plataforma.
- Configuración de entornos y manejo seguro de secretos cuando sean necesarios.
- Autenticación, sesiones seguras, autorización de backend y mínimo privilegio.
- Validación de entrada/salida y límites de uso, tamaño y frecuencia.
- Consultas parametrizadas cuando exista persistencia; no hay SQL actual que permita evaluarlas.
- Logs estructurados sin tokens, IDs de correlación y política de retención.
- Disponibilidad de conectores, latencia de ingesta/API, tareas y métricas de entrega.
- Ingesta y envíos idempotentes; deduplicación; reintentos con backoff.
- Backups automatizados PostgreSQL y restauración probada.
- Pruebas unitarias, integración, E2E, carga, accesibilidad, permisos y recuperación.
- Guía técnica, operación, incidentes y recuperación.
- Separación de mensajes operativos y avisos públicos con fuente y enlace.

No se exige añadir Redis, MFA o PostGIS solo para marcar una casilla: el documento los presenta como opcionales o condicionados. Las capacidades que resuelven deben diseñarse según el alcance real.

## 11. Estado de las fases 0 a 9

| Fase | Estado de su entregable |
|---|---|
| 0. Descubrimiento y viabilidad | No se encontró documento propio de alcance, usuarios, riesgos, fuentes/licencias, frecuencia, validación experta ni backlog. El código muestra una elección inicial de USGS y área alrededor de Perú. |
| 1. Base técnica y UX | Parcial: repositorio, React/Vite, FastAPI y prototipo navegable. Faltan PostgreSQL, Docker, entorno configurable, CI, esquema inicial y guía de despliegue. |
| 2. Identidad, permisos y auditoría | Pendiente. |
| 3. Ingesta y catálogo | Parcial: adaptador en solicitud. Faltan persistencia, procedencia completa, deduplicación, incrementalidad, validación, ejecuciones y sus pruebas. |
| 4. Dashboard/mapa/análisis | Parcial: tabla y mapa; KPIs de eventos limitados. Faltan dashboard real, gráficas, filtros comunes, detalle, paginación y exportación. |
| 5. Calidad y datasets | Pendiente. |
| 6. ML supervisado | Pendiente. |
| 7. Reglas y alertas | Pendiente; solo pantalla inicial. |
| 8. Reportes y administración | Pendiente; pantallas iniciales. |
| 9. Seguridad, pruebas y despliegue | Pendiente como entregable; hay controles iniciales de desarrollo. |

Ninguna fase completa está acreditada por todos sus entregables. Hay avance parcial en 1, 3 y 4; no significa que estés en fase 4 con las anteriores cerradas.

Detalle del propio plan: las duraciones individuales suman aproximadamente **15–19 semanas** si todas son secuenciales, mientras el resumen indica 14–18. Es una estimación orientativa que conviene reconciliar con dependencias y trabajo paralelo, no una fecha de entrega garantizada.

## 12. Criterios de aceptación del MVP: uno por uno

| Criterio de las páginas 8–9 | Resultado y motivo |
|---|---|
| Desplegable desde instrucciones y configuración | No acreditado: README genérico, entorno vacío y sin infraestructura. |
| Eventos con proveedor, hora, ubicación, magnitud, profundidad y enlace | Parcial: ubicación/magnitud/profundidad e identificación general del proveedor; faltan hora y enlace individual. |
| Ingesta repetible sin duplicados, con ejecución y error registrados | Pendiente: no hay ingesta persistente ni registro de ejecuciones. |
| Dashboard/mapa/gráficas respetan filtros y coinciden con API | No cumplido: dashboard/gráficas no conectados y filtros de tabla no compartidos con mapa. |
| Modelos con dataset, periodo, features, versión, métricas y límites | Pendiente: no hay modelos. |
| Estimaciones separadas de alertas oficiales | Sin evidencia funcional: no existen los flujos; los textos no publican predicciones. |
| Reglas probables, sin duplicados y entrega consultable | Pendiente. |
| Roles bloquean interfaz y API | Pendiente. |
| Reportes con corte, filtros, fuente y solicitante | Pendiente. |
| Pruebas, backup probado, operación e incidentes | Pendiente. |

Ninguno de los diez criterios queda completamente acreditado en la copia local. Esto mide el MVP completo solicitado por el PDF, no niega el trabajo funcional de tabla/mapa/API.

## 13. Comprobaciones realizadas y sus límites

1. Inventario de archivos y revisión de código/configuración; búsqueda de instrucciones AGENTS.md sin resultados en el proyecto.
2. Lectura de las nueve páginas y renderizado visual del PDF. El renderizador informó sustituciones de dos fuentes; se contrastó el contenido con extracción textual.
3. Análisis sintáctico de los 4 archivos Python: correcto. No demuestra importación exitosa de dependencias.
4. Ejecución aislada de la función real listar_eventos extraída de su AST, con proveedor simulado y sustitución mínima de HTTPException. Se comprobó:
   - Conversión correcta longitud/latitud y respuesta de un evento válido.
   - Descarte de coordenadas con menos de tres elementos.
   - Traducción de fallo de red a 502.
   - JSON inválido produce JSONDecodeError sin controlar.
   - Coordenadas null y coordenadas 999/999 se aceptan y devuelven.
5. No había node_modules ni entorno Python local del servicio. El Python auxiliar disponible no tenía FastAPI, httpx o pytest. No se ejecutaron build/lint, servidor FastAPI, tests de integración ni navegador de la aplicación. No se instalaron dependencias ni se cambió el lockfile.
6. No se consultó USGS en vivo en esta revisión: se verifica el conector en código y su transformación simulada, no disponibilidad actual ni exhaustividad científica de la fuente.
7. No se verificaron servicios externos, contenedores, base remota, despliegue, accesibilidad real, carga ni restauración.

Los resultados aislados anteriores no deben presentarse como pruebas E2E ni como una suite existente del proyecto.

## 14. Orden concreto para completar el proyecto

### Prioridad 1: cerrar la base de datos y el catálogo verificable

- Documentar alcance Perú/área, usuarios iniciales, fuente, cobertura, términos de uso, frecuencia y límites.
- Configurar entorno y URL de API; preparar guía real de instalación y ejecución.
- Incorporar PostgreSQL y migraciones; empezar con data_sources, ingestion_runs y seismic_events.
- Definir esquema de evento completo, UTC, URL, recepción, revisión, tipo de magnitud y validaciones.
- Extraer el conector de la ruta; sincronizar con upsert/clave única, registros de ejecución, errores y rechazos.
- Probar repetición sin duplicados, caídas, payload inválido y actualización de un evento revisado por el proveedor.

**Cierre verificable:** la misma ingesta repetida no duplica, los eventos sobreviven reinicios y cada uno conserva hora y procedencia.

### Prioridad 2: completar monitoreo y análisis

- API de listado con filtros/paginación/detalle y agregados.
- Estado/filtros comunes para tabla, mapa y dashboard.
- KPIs reales, serie temporal, histograma y dispersión; fuente/corte/muestra/faltantes visibles.
- Leyenda, filtros temporales y agrupación del mapa según volumen.
- Exportación básica reproducible y corrección de textos desactualizados.

**Cierre verificable:** conteos y gráficas coinciden para el mismo filtro, y se llega desde un punto o fila a su fuente original.

### Prioridad 3: identidad y trazabilidad antes de administración o publicación

- Autenticación, sesiones y roles; autorización por endpoint.
- Auditoría de operaciones críticas, configuración por entorno y controles de uso.
- Automatizar checks de instalación, pruebas y build; preparar despliegue reproducible.

La fase de identidad del PDF debe resolverse junto con la base, antes de abrir funciones administrativas, aprobación o envío.

### Prioridad 4: datasets y trabajo académico de ML

- Calidad/versionado/corte temporal; pregunta supervisada y target revisados.
- Baseline, regresión simple/múltiple y clasificación según objetivos.
- Registro reproducible, métricas, comparación y artefactos.
- Estimaciones experimentales con revisión, versión e incertidumbre.

### Prioridad 5: alertas, reportes y operación completa

- Reglas, simulación, permisos/aprobación, deduplicación, entrega y reintentos.
- Exportaciones/reportes completos con caducidad y auditoría.
- HTTPS, CI/CD, monitorización, backup restaurado y manuales.
- Verificación final de los diez criterios de aceptación con evidencia.

## 15. Evidencias principales para localizar los hallazgos

- services/api/app/api/routes/eventos.py:18–80: consulta, parámetros, manejo de errores y campos devueltos.
- services/api/app/core/config.py:2–9: configuración fija y DEBUG.
- services/api/main.py:10–32: aplicación, CORS y routers.
- services/api/app/api/routes/health.py:7–13: salud básica.
- services/api/requirements.txt: dependencias actuales, sin persistencia ni ML.
- apps/web/src/services/api.ts:2–43: host fijo, contratos de seis campos y llamadas fetch.
- apps/web/src/App.tsx:179–451: estado de conexión y navegación interna.
- apps/web/src/App.tsx:455–675: dashboard y tarjetas sin datos reales.
- apps/web/src/App.tsx:925–1299: eventos, filtros, indicadores y tabla.
- apps/web/src/App.tsx:1303–1398: consulta separada de mapa.
- apps/web/src/components/MapaSismico.tsx:19–103: encuadre, colores y marcadores.
- apps/web/src/App.tsx:1400–1666: maquetas de análisis, ML, alertas, reportes, usuarios, fuentes y auditoría.
- apps/web/src/App.tsx:1670–1684: pie con texto de integración pendiente.
- apps/web/index.html:2–8: idioma y título de plantilla.
- apps/web/src/App.css y index.css: estilos responsive, accesibilidad inicial y reglas acumuladas.
- apps/web/README.md y .env.example: documentación genérica y entorno vacío.

Los números de línea corresponden a los archivos observados al revisar; cambiarán con ediciones futuras.
