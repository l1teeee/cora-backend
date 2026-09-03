# cora-backend

## 0. Infraestructura ya provisionada

El proyecto y la base de datos ya estan creados en Railway. No hay que repetir el Paso 1.

| Recurso | Valor |
| --- | --- |
| Proyecto Railway | `CORA` -> https://railway.com/project/2ac97729-b42c-4c07-b816-1bdcd2655c60 |
| Servicio DB | `MySQL` (mysql:8.0, volumen `mysql-data` en `/var/lib/mysql`) |
| Base de datos | `railway` |
| Acceso privado | `${{MySQL.MYSQL_URL}}` (host `mysql.railway.internal`) |
| Acceso publico | proxy TCP activo sobre el puerto 3306 (host y puerto en `MYSQL_PUBLIC_URL`) |
| Tabla `llamadas` | ya migrada |

La contrasena esta en el servicio `MySQL` -> pestana `Variables` -> `MYSQL_PUBLIC_URL`. Copia esa
cadena completa a `DATABASE_URL` en tu `.env` local. Nunca la subas al repo: `.env` esta en `.gitignore`.

Falta unicamente: crear el repo en GitHub, conectarlo como segundo servicio del proyecto y setear
sus variables (Pasos 2 y 3).


## 1. Qué hace

CORA es un sistema de atención telefónica con IA para una universidad. Vapi orquesta la llamada completa: transcribe con STT, genera las respuestas con Claude Sonnet y las convierte a voz con ElevenLabs TTS. Al terminar cada llamada, Vapi envía un webhook `end-of-call-report` a este backend. El backend guarda esa información (transcripción, resumen, duración, costo, grabación) en MySQL sobre Railway. También expone un endpoint para listar llamadas y otro para sincronizar el historial completo desde la API de Vapi.

## 2. Stack y estructura de archivos

Node 24 + Fastify 5 + MySQL (mysql2).

```
cora-backend/
  package.json          scripts: start, dev, migrate, sync
  railway.json
  .env.example
  src/server.js         Fastify, corre la migracion al arrancar, escucha en 0.0.0.0:$PORT
  src/db.js             pool mysql2 (DATABASE_URL o MYSQLHOST/PORT/USER/PASSWORD/DATABASE)
  src/migrate.js        crea la tabla desde src/schema.sql
  src/schema.sql        tabla `llamadas`
  src/vapi/normalize.js payload de Vapi -> fila de la tabla
  src/vapi/client.js    GET https://api.vapi.ai/call (paginado por createdAtLt)
  src/repository/llamadas.js  UPSERT por call_id + listado paginado
  src/routes/webhook.js   POST /webhook/vapi
  src/routes/llamadas.js  GET /llamadas
  src/routes/sync.js      GET|POST /sync/vapi
  src/scripts/sync.js     npm run sync
```

Endpoints:

| Endpoint | Auth |
| --- | --- |
| `GET /health` | publico |
| `POST /webhook/vapi` | `x-vapi-secret` (el Server URL Secret de Vapi) |
| `GET /llamadas?page=1&limit=20` | `x-admin-key` |
| `GET\|POST /sync/vapi` | `x-admin-key` |

`GET /llamadas` devuelve telefonos, resumenes y URLs de grabaciones de estudiantes, asi que pide
`x-admin-key` igual que el sync. Si el dashboard que lo consuma ya hace su propia autenticacion y
prefieres abrirlo, quita la linea `rechazaSinAdminKey` de `src/routes/llamadas.js`.

### Como se obtiene el resumen

El structured output `resumen_llamada` **no llega en el webhook**: Vapi lo procesa de forma
asincrona y no dispara ningun evento cuando termina. Hay que ir a buscarlo.

1. Llega `end-of-call-report` -> se guarda la llamada completa con `resumen = NULL` y se responde
   200 a Vapi de inmediato (la respuesta no espera al resumen).
2. A los 15s se hace `GET https://api.vapi.ai/call/{call_id}` y se lee
   `analysis.structuredData.resumen_llamada` (con `analysis.summary` de respaldo).
3. Si ya esta -> `UPDATE llamadas SET resumen = ?`. Si no -> un segundo intento a los 15s.
4. Tras 2 intentos se abandona: el registro queda con `resumen = NULL` y nada falla.

Ajusta el intervalo con `RESUMEN_ESPERA_MS` (default 15000). El maximo de 2 intentos es fijo a
proposito: evita timers acumulados por cada llamada cuyo resumen nunca se genere.

Requiere `VAPI_API_KEY`. Sin ella el webhook sigue guardando todo lo demas, solo loguea un warning
y el resumen queda NULL. Los timers viven en memoria: si Railway reinicia el contenedor entre el
webhook y el reintento, ese resumen se pierde (lo recupera despues `npm run sync`).

**Fail closed en produccion**: si `VAPI_SERVER_SECRET` no esta definido y el proceso corre en Railway
(`RAILWAY_ENVIRONMENT` presente), `/webhook/vapi` responde 503 en vez de aceptar cualquier peticion.
En local sin esa variable el webhook sigue abierto para poder probar con curl.

Tabla `llamadas`: `id, call_id (UNIQUE), fecha, duracion (seg), costo, transcripcion, resumen, razon_finalizacion, numero_telefono, url_grabacion, usuario_asignado, created_at, updated_at`.

Variables: `PORT, RESUMEN_ESPERA_MS, DATABASE_URL, MYSQLHOST, MYSQLPORT, MYSQLUSER, MYSQLPASSWORD, MYSQLDATABASE, VAPI_SERVER_SECRET, VAPI_SECRET_HEADER (default x-vapi-secret), VAPI_API_KEY, ADMIN_API_KEY`.

## 3. Paso 1 - Crear MySQL en Railway

1. Entra a [railway.app](https://railway.app) con tu cuenta.
2. Si es un proyecto nuevo: `New Project` -> `Deploy MySQL`.
   Si ya tienes un proyecto abierto: botón `Create` (o `+ New`) -> `Database` -> `Add MySQL`.
3. Railway crea y aprovisiona el servicio MySQL solo, sin configuración adicional.
4. Espera a que el servicio quede desplegado (icono en verde).

Railway genera automáticamente solo estas variables en el servicio de MySQL:

- `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE`
- `MYSQL_URL`: host interno `mysql.railway.internal`, solo accesible desde otros servicios del mismo proyecto.
- `MYSQL_PUBLIC_URL`: host `*.proxy.rlwy.net`, accesible desde fuera de Railway. Úsala para conectarte desde tu máquina o desde un cliente como TablePlus o DBeaver.

Para verlas: entra al servicio MySQL -> pestaña `Variables`.

## 4. Paso 2 - Desplegar el backend en Railway

En el mismo proyecto: `+ New` -> `GitHub Repo` (conecta este repositorio), o `Empty Service` y luego `railway up` desde la Railway CLI.

Railway detecta que es un proyecto Node por el `package.json` y ejecuta `npm start`. El `railway.json` de este repo ya fija el `startCommand`, no hace falta tocar nada en `Settings` -> `Deploy`.

No hay que setear `PORT` a mano: Railway la inyecta sola y `src/server.js` ya lee `process.env.PORT`.

## 5. Paso 3 - Conectar backend y MySQL por variables

En el servicio del backend -> `Variables` -> `New Variable`. Usa referencias entre servicios con esta sintaxis exacta:

```
DATABASE_URL = ${{MySQL.MYSQL_URL}}
```

`MySQL` es el nombre del servicio de base de datos; si lo renombraste, usa ese nombre en la referencia. Esta referencia se resuelve dentro de la red privada del proyecto: no expone la base hacia afuera y no genera costo de egress.

Agrega también: `VAPI_SERVER_SECRET`, `VAPI_API_KEY`, `ADMIN_API_KEY`.

Luego: servicio backend -> `Settings` -> `Networking` -> `Generate Domain` para obtener la URL pública `https://<algo>.up.railway.app`.

Troubleshooting: si la conexión privada falla al arrancar, cambia temporalmente `DATABASE_URL` a `${{MySQL.MYSQL_PUBLIC_URL}}` para descartar problemas de red interna.

## 6. Paso 4 - Configurar Vapi

En el dashboard de Vapi: Assistant -> `Advanced` (o `Messaging` / `Server`) y configura:

- **Server URL**: `https://<tu-dominio>.up.railway.app/webhook/vapi`
- **Server URL Secret**: el mismo valor que pusiste en `VAPI_SERVER_SECRET`.

Vapi manda ese secret en el header `x-vapi-secret` en cada petición; el backend lo compara y responde 401 si no coincide.

También se puede configurar a nivel de Phone Number o de Organización (`Settings` -> `Server URL`) si quieres que aplique a todo. Asegúrate de que el evento `end-of-call-report` esté activo en "Server Messages".

## 7. Paso 5 - Traer el historial existente

Consigue la API key privada en Vapi -> `Organization Settings` -> `API Keys` (usa la **private key**, no la public). Ponla en `VAPI_API_KEY`.

Luego, dos formas de disparar la sincronización:

- Local: `npm run sync` (opcional `npm run sync -- --limit=100 --maxPaginas=50`)
- Remoto: `curl -X POST "https://<dominio>/sync/vapi" -H "x-admin-key: <ADMIN_API_KEY>"`

Es idempotente: reejecutarlo no duplica nada porque hace UPSERT por `call_id`.

## 8. Probar en local antes de conectar Vapi

```
npm install
cp .env.example .env        # en Windows PowerShell: copy .env.example .env
```

Edita `.env`: pon `DATABASE_URL` apuntando al `MYSQL_PUBLIC_URL` de Railway (así pruebas contra la base real sin instalar MySQL local) y deja `VAPI_SERVER_SECRET` vacío para saltarte la validación mientras pruebas.

```
npm run migrate
npm run dev
```

### Smoke test automatico (lo mas rapido para saber si todo funciona)

```
npm run smoke
```

No necesita el server levantado. Contra la base real: normaliza los dos payloads de `test/`,
los guarda, y comprueba con 25 asserts que el segundo webhook (el del `analysis`, sin `messages`)
**no borra** la transcripcion ya guardada, que no se duplica la fila y que la paginacion capa el limit.
Imprime `TODO VERDE` o la lista de fallas.

### Health

```
curl http://localhost:3000/health
```

PowerShell:

```
Invoke-RestMethod -Uri http://localhost:3000/health
```

### Webhook con payload de ejemplo

```
curl -X POST http://localhost:3000/webhook/vapi -H "Content-Type: application/json" -H "x-vapi-secret: mi-secret" -d @test/payload-ejemplo.json
```

PowerShell:

```
Invoke-RestMethod -Uri http://localhost:3000/webhook/vapi -Method Post -ContentType 'application/json' -Headers @{ 'x-vapi-secret' = 'mi-secret' } -InFile test\payload-ejemplo.json
```

### Segundo envío con el resumen (demuestra el UPSERT)

```
curl -X POST http://localhost:3000/webhook/vapi -H "Content-Type: application/json" -H "x-vapi-secret: mi-secret" -d @test/payload-resumen.json
```

PowerShell:

```
Invoke-RestMethod -Uri http://localhost:3000/webhook/vapi -Method Post -ContentType 'application/json' -Headers @{ 'x-vapi-secret' = 'mi-secret' } -InFile test\payload-resumen.json
```

Este segundo payload trae el MISMO `call_id` y solo el `analysis`; tras enviarlo, la fila conserva la transcripción del primer envío y ahora además tiene el resumen.

### Listar llamadas

```
curl -H "x-admin-key: cambia-esto" "http://localhost:3000/llamadas?page=1&limit=10"
```

PowerShell:

```
Invoke-RestMethod -Uri "http://localhost:3000/llamadas?page=1&limit=10" -Headers @{ 'x-admin-key' = 'cambia-esto' }
```

### Sync protegido

```
curl -X POST http://localhost:3000/sync/vapi -H "x-admin-key: cambia-esto"
```

PowerShell:

```
Invoke-RestMethod -Uri http://localhost:3000/sync/vapi -Method Post -Headers @{ 'x-admin-key' = 'cambia-esto' }
```

### Exponer el local a Vapi para probar de verdad

```
npx localtunnel --port 3000
```

o con ngrok:

```
ngrok http 3000
```

Pega la URL que te den + `/webhook/vapi` como Server URL en Vapi.

## 9. Notas de comportamiento

- El evento `end-of-call-report` puede llegar con `analysis: {}` y el resumen llegar después en otro evento con el mismo `call_id`: el UPSERT usa COALESCE, así que un campo vacío nunca pisa uno ya guardado.
- `usuario_asignado` no lo toca el webhook nunca; es para asignación manual desde la app.
- Eventos distintos de `end-of-call-report` responden 200 y se ignoran (si devolviéramos error, Vapi reintentaría).
- Sin `call_id` -> 400. Error de base -> 500 (Vapi reintenta).
- `bodyLimit` de Fastify subido a 10MB por las transcripciones largas.
