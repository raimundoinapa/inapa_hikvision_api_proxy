# Changelog — Revisión de seguridad y correctitud

Este documento registra los cambios hechos durante la revisión asistida por IA del
proyecto **inapa_hikvision_api_proxy**. El sistema fue diseñado y construido a mano;
la revisión no viene a señalar errores, sino a dejar por escrito **qué pasaba, por qué
pasaba, qué se cambió y cómo se comprobó**, para que sirva de aprendizaje y de
referencia futura.

- **Autor del sistema:** Raimundo Araujo.
- **Alcance de esta revisión:** hallazgos #1 a #9, el endurecimiento de LDAP y dos
  correcciones adicionales encontradas al validar los cambios posteriores.
- **Fecha de esta versión del documento:** 15/11/2026.
- **Nota sobre las líneas:** los números de línea corresponden a esa fecha. Si el
  código cambia, usa el nombre de la función o el comentario como ancla.

> Los valores de `.env`, `ssl/server.key`, los respaldos y las URLs completas de
> stream **no se imprimen** en este documento ni en las pruebas. Solo se muestran
> nombres de variables, esquemas (`rtsp:`, `ws:`, `ldaps:`), códigos HTTP y conteos.

---

## Resumen

| # | Hallazgo | Severidad | Estado |
|---|----------|-----------|--------|
| 1 | Path traversal en el servidor de archivos estáticos | Alta | Corregido |
| 2 | Secretos reales en `env.example` y arranque con valores por defecto | Alta | Corregido |
| 3 | LDAP sin cifrar y contraseña enviada por una llamada HTTP interna | Alta | Corregido |
| 4 | Endpoints de operador y de pantallas sin autenticación | Crítica | Corregido |
| 5 | Usuarios de AD sin verificación de pertenencia al grupo CCTV | Alta | Corregido |
| 6 | Rate limiter evadible y contador de IP reseteable | Media | Corregido |
| 7 | Capturas siempre vencidas por `birthtime` y refresco costoso | Media | Corregido |
| 8 | Capturas locales perdidas al refrescar el catálogo | Media | Corregido |
| 9 | Mapeo posicional de streams, typo de frontend, protocolo ignorado, body abortado y PTZ sin límite | Mixta | Corregido |
| A | Respuesta doble por falta de `return` en la captura (encontrado al validar cambios posteriores) | Media | Corregido |
| B | Endurecimiento de LDAP ante entradas inválidas y errores no controlados | Alta | Corregido |
| C | `capture-upload` sin catálogo, sin tope de tamaño y con caída ante `data` no texto | Alta | Corregido |
| D | Pantallas 1-4 y su SSE sin clave, por decisión operativa | Aceptada | Aplicado |
| E | Helpers de arranque/parada peligrosos y ACL del lanzador de la tarea | Media | Corregido |

Resultado de las suites: **#4 40/40, #5 7/7, #6 11/11, #7 25/25, #8 17/17,
#9 mapeo 23/23, #9 restantes 30/30, C 24/24**. Las suites quedaron copiadas en
`tests/`.

---

## #1 — Path traversal en archivos estáticos

**Síntoma.** Una petición con `..` podía salir de `public/` y leer archivos del
proyecto, incluido `.env` o la llave TLS. También había que comprobar las formas
codificadas (`%2e%2e`, `%252e`, `%2f`, `%5c`), porque son la forma habitual de
intentar colar el mismo ataque.

**Causa.** El servidor construía la ruta con `path.join(public, req._url)` y luego
hacía `fs.readFile(req._filePath)` sin comprobar que el resultado siguiera dentro de
`public/`. `path.join` normaliza `..`, así que la cadena final ya apuntaba fuera de
la carpeta permitida.

**Cambio.** En `http-server.js:294-310`, después de resolver la ruta:

```js
const relativePath = path.relative(this.public, req._filePath);
if (relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    res.writeHead(404, {'Content-Type': 'text/html'});
    res.end('404: File not found');

    return;
}
```

No se “limpian” los `../` de la cadena: se resuelve la ruta y se comprueba que el
resultado esté contenido en la carpeta pública. Es una lista blanca, no una lista
negra. `path.relative` evita además comparar prefijos de texto y detecta unidades o
UNC distintas en Windows.

**Sobre las codificaciones (punto que conviene dejar explícito).** Node entrega
`req.url` tal como llegó: **no** decodifica `%2e%2e`, `%252e`, `%2f` ni `%5c`. Por
tanto `path.join` los trata como nombres de archivo literales dentro de `public/` y
la lectura falla; no hay un “descodificador” posterior que pueda convertirlos en
`../`. Si delante hubiera un proxy que **sí** decodifica, entonces el `../` llega
literal, `path.join` lo resuelve y la comprobación `path.relative` lo rechaza. Las
dos situaciones quedan cubiertas sin mantener una lista negra de codificaciones.

**Prueba.** La suite `tests/path-traversal.test.js` levanta un `HttpServer` real con
un archivo señuelo **fuera** de `public/` y envía peticiones HTTP crudas por socket,
para que el cliente no normalice la ruta. Resultado: **23/23 comprobaciones**, con
el archivo permitido en 200 y ningún señuelo leído.

| Ruta solicitada | Resultado | ¿Leyó el señuelo? |
|---|---|---|
| `/allowed.txt` | 200 | no aplica |
| `/../secret-canary.txt` | 404 | no |
| `/%2e%2e/secret-canary.txt` | 404 | no |
| `/%2e%2e%2fsecret-canary.txt` | 404 | no |
| `/..%2fsecret-canary.txt` | 404 | no |
| `/%2e%2e/%2e%2e/secret-canary.txt` | 404 | no |
| `/%252e%252e%252fsecret-canary.txt` | 404 | no |
| `/..%5csecret-canary.txt` | 404 | no |
| `/%2e%2e%5csecret-canary.txt` | 404 | no |
| `/js/../../../secret-canary.txt` | 404 | no |
| `/..\\secret-canary.txt` | 404 | no |
| `/....//secret-canary.txt` | 404 | no |

**Lección.** No decodificar es parte de la defensa, pero no conviene confiar solo en
ello: la comprobación se hace sobre la ruta **resuelta**, no sobre el texto, y cubre
también lo que un proxy intermedio pueda decodificar antes de llegar al servidor.
Los filtros de texto se saltan con codificaciones y con separadores de Windows.

---

## #2 — `env.example` y arranque sin secretos

**Síntoma.** La plantilla `env.example` podía confundirse con una configuración real,
y el servidor podía arrancar con valores por defecto si faltaba alguna variable.

**Causa.** La plantilla se había creado a partir del entorno real. Además, los
secretos críticos tenían respaldos en el código, de modo que un despliegue mal
configurado no fallaba: arrancaba con un secreto conocido.

**Cambio.**
- `env.example` quedó solo con marcadores (`change-me-...`, `your-...`,
  `replace-with-...`) y comentarios de cómo generar cada valor.
- `server.js:11-17` exige `JWT_SECRET`, `ADMIN_PASSWORD_HASH`,
  `HIKVISION_API_URL`, `HIKVISION_PARTNER_KEY` y `HIKVISION_PARTNER_SECRET`.
  Si falta alguna, el proceso termina con código 1 y solo imprime los **nombres**.
- El `.env` real no se tocó. El repositorio es privado y no se reescribió el
  historial; se decidió no mover secretos que ya estaban en uso.

**Prueba.**

- Arranque desde un directorio vacío, sin `.env`:

  ```text
  Variables de entorno requeridas no definidas: JWT_SECRET, ADMIN_PASSWORD_HASH,
  HIKVISION_API_URL, HIKVISION_PARTNER_KEY, HIKVISION_PARTNER_SECRET
  exit: 1
  ```

- Comparación de las claves sensibles de `env.example` contra `.env`, sin imprimir
  valores: **0 valores idénticos**. `SSL_KEY` coincide solo porque ambos están vacíos.

**Lección.** Una plantilla también es código: nunca debe llevar valores reales. Es
mejor que el proceso no arranque a que arranque con un secreto por defecto.

---

## #3 — LDAP cifrado y sin llamada HTTP interna

**Síntoma.** Con la aplicación en HTTPS, el login seguía hablando con los DC por
`ldap://` en el puerto 389. Además, `/auth/login` se llamaba a sí mismo por HTTP
para validar contra `/ldap/login`, enviando la contraseña por la red interna.

**Causa.** El esquema de LDAP estaba fijo, no seguía a `PROTOCOL`, y la validación
de AD se resolvía con una petición HTTP al propio servidor en lugar de una función
en proceso.

**Cambio.**
- `ldap-config.js:7-24` convierte las URLs según `PROTOCOL`:
  `http -> ldap://...:389`, `https -> ldaps://...:636`.
- `ldap-config.js:27-37` arma las opciones TLS (`rejectUnauthorized`, `ca`).
- `server.js:56-58` usa ese resultado; `server.js:514-669` define
  `authenticateLdap()` y `server.js:672` / `server.js:724` la llaman **directamente**.
  Ya no hay petición HTTP interna con la contraseña.
- Se agregó HTTPS en el mismo puerto con un demultiplexor TCP
  (`http-server.js:11`, `446-521`, `578`): el primer byte `0x16` es TLS; si no,
  se responde `301` para GET/HEAD y `308` para el resto. El `Host` del redirect se
  valida contra una lista (`HTTP_REDIRECT_ALLOWED_HOSTS`) para no crear un open
  redirect.

**Prueba.**

```text
PROTOCOL: https
LDAP URL count: 2
schemes: ldaps:
ports: 636
certificate check enabled: false   <- temporal, ver pendientes
```

- `https://.../health` → 200
- `http://.../` → 301 a HTTPS
- `POST http://.../api/login` → 308 a HTTPS (conserva método y body)

**Nota pendiente.** La validación del certificado de los DC está desactivada
temporalmente (`LDAP_TLS_REJECT_UNAUTHORIZED=false`) hasta renovar el certificado de
DC-02 y exportar la CA raíz. En `env.example` ya están documentadas
`LDAP_TLS_REJECT_UNAUTHORIZED` y `LDAP_TLS_CA`.

**Lección.** El cifrado tiene que ser de extremo a extremo: no sirve HTTPS en el
navegador si la contraseña viaja en claro entre el servidor y el DC. Y un servidor no
debería llamarse a sí mismo por la red para reutilizar una función.

---

## #4 — Autenticación de operadores y pantallas

**Síntoma.** Había endpoints de operador y de pantalla accesibles sin credenciales.
La clave de pantalla, si se usaba, no distinguía entre “puedo ver la TV” y “puedo
operar el sistema”.

**Causa.** La autorización se aplicaba solo a una parte de las rutas. Las pantallas
no tenían un mecanismo propio y los endpoints que no estaban bajo `/api` quedaban
fuera del middleware de JWT.

**Cambio.**
- `server.js:158-208`: helpers de JWT (`Authorization: Bearer` o `?token=` solo para
  SSE) y de clave de pantalla (`?key=` o `X-Screen-Key`), con comparación en tiempo
  constante.
- `server.js:391-425`: todos los endpoints de `endpoints.protected` exigen JWT
  (401 sin token, 403 con token inválido).
- `server.js:427-462`: se separan dos grupos:
  - **solo JWT:** `/generatehash`, `/share_camera`, `/share_camera_alt` y el SSE de
    cliente.
  - **clave de pantalla o JWT:** `/screen`, `/pantalla*`, `/get_clients`,
    `/connect_client*` y el SSE de pantalla.
- `server.js:671-687` y `server.js:689-758`: el login ya no devuelve el registro de
  AD (nombre, correo, grupos, SID). Solo devuelve estado y, si se pide, el token.
- La clave de pantalla **no** puede ejecutar acciones de operador.

**Prueba (servidor real).**

| Petición | Resultado |
|---|---|
| `/screen` sin clave | 401 |
| `/screen` con clave incorrecta | 401 |
| `/screen` con clave correcta | 200 |
| `/screen?key=<clave>` | 200 |
| `/get_clients` sin clave | 401 |
| `/generatehash` sin credenciales | 401 |
| `/generatehash` con clave de pantalla | 401 |
| `/share_camera` con clave de pantalla | 401 |
| `POST /api/cameras` sin JWT | 401 |
| `POST /api/camera/integral` sin JWT | 401 |

Suite `tests/auth-gaps.test.js`: **38/38**.

**Lección.** Autenticación no es autorización. Una credencial de pantalla debe servir
solo para leer y mostrar, no para operar. Es más seguro declarar primero qué rutas
son públicas y luego proteger todo lo demás.

---

## #5 — Pertenencia al grupo CCTV

**Síntoma.** Cualquier usuario que se autenticara contra AD podía usar la aplicación,
aunque no perteneciera al grupo `CCTV`.

**Causa.** `LDAP_ALLOWED_DN` existía en la configuración, pero no se comprobaba
`memberOf`. El login solo validaba usuario y contraseña.

**Cambio.**
- `server.js:491-512`: `getGroupCN()` extrae el CN del DN y
  `isMemberOfAllowedGroups()` acepta `memberOf` como arreglo o como string, compara
  sin distinguir mayúsculas y **falla cerrado** si no hay grupos configurados.
- `server.js:61-62`: se acepta `LDAP_ALLOWED_CN` y, por compatibilidad,
  `LDAP_ALLOWED_DN`; por defecto `CCTV`.
- `server.js:656-666`: después de un bind correcto, si el usuario no está en ningún
  grupo permitido se devuelve 401 y se registra el intento.
- Los usuarios locales (`ADMIN_USERNAME` y `ADDITIONAL_USERS`) no pasan por LDAP ni
  por este chequeo (`server.js:49-54`, comentario en `server.js:656-657`).

**Prueba (suite con LDAP simulado):**

| Usuario | Escenario | Resultado |
|---|---|---|
| alice | arreglo con CCTV | 200 |
| carol | un solo grupo (string), `cn=cctv` | 200 |
| bob | arreglo sin CCTV | 401 |
| dave | un solo grupo ajeno (string) | 401 |
| erin | sin `memberOf` | 401 |
| alice | contraseña incorrecta | 401 |
| localadmin | usuario local hardcoded | 200, sin tocar LDAP |

Suite `tests/group-check.test.js`: **7/7**. Los rechazos quedan registrados en el log.

**Pendiente.** No se expanden grupos anidados de AD. Si `CCTV` contiene a otro grupo
y el usuario está en el grupo hijo, hoy no se detecta. Hay que decidir si se resuelve
con una búsqueda recursiva o con un grupo de distribución plano.

**Lección.** Autenticar es solo la mitad; la autorización por grupo es lo que separa
“tiene cuenta” de “tiene permiso”. Además, `memberOf` no siempre llega igual: puede
ser string o arreglo.

---

## #6 — Rate limiter de login

**Síntoma.** El limitador podía bloquear a un usuario válido, se reseteaba con un
login correcto y confiaba en `X-Forwarded-For` de cualquier cliente.

**Causa.**
- Cada intento consumía puntos, incluso los exitosos.
- Un login correcto borraba el contador compartido por IP, así que una cuenta válida
  podía “regalar” intentos a toda la red.
- `X-Forwarded-For` / `X-Real-IP` se leían sin comprobar si la conexión venía de un
  proxy de confianza.
- Mayúsculas y dominio (`alice`, `ALICE`, `alice@dominio`) creaban contadores
  distintos.
- Los GET también pasaban por el limitador.

**Cambio.**
- `server.js:227-240`: normaliza el usuario (minúsculas, sin `@dominio`) y arma las
  claves `ip` y `ip:usuario`.
- `server.js:243-277`: `getBlockedLimiter()` solo consulta; `registerFailedLogin()`
  solo se llama con 401; `clearUserLimiter()` borra únicamente la clave del usuario,
  nunca la de la IP.
- `server.js:671-758`: solo `POST /auth/login` y `POST /ldap/login` pasan por el
  limitador. Los GET no consumen.
- `http-server.js:85-90` y `159-184`: `TRUST_PROXY` define qué IPs pueden enviar
  cabeceras reenviadas; se recorre `X-Forwarded-For` de derecha a izquierda y se toma
  el primer salto que no sea un proxy conocido.
- `rate-limit.js:7-20`: límites por usuario+IP y por IP, configurables por entorno.

**Prueba (suite dedicada):**

| Comprobación | Resultado |
|---|---|
| XFF no confiable, mismo header 3 veces | 401, 401, 429 |
| XFF no confiable rotando header | 429 (no evade) |
| X-Real-IP no confiable | 429 |
| 3 fallos y luego login válido | 401, 401, 401 \| 200 \| 401 |
| El límite por IP sigue aplicando después del login válido | 429, 429 |
| `/ldap/login` 4 intentos correctos | 200, 200, 200, 200 |
| 3 intentos incorrectos | 401, 401, 429 |
| `alice`, `ALICE`, `alice@test.local` comparten contador | 401, 401, 429, 429 |
| 5 usuarios distintos desde la misma IP | 401, 401, 401, 401, 429 |
| 6 GET a `/ldap/login` | 404 x6, sin consumir |
| POST después de los GET | 401, 429 |

Suite `tests/rate-limit.test.js`: **11/11**.

**Lección.** Un límite debe contar fallos, no éxitos; y jamás debe confiar en
cabeceras que el cliente puede inventar. Normalizar la identidad antes de contar
evita multiplicar contadores con el mismo usuario.

---

## #7 — Vencimiento y refresco de capturas

**Síntoma.** Las capturas se consideraban vencidas casi siempre, y el trabajo de
refresco era más pesado de lo necesario.

**Causa.**
- Se usaba `birthtimeMs` para medir la antigüedad. En Windows, reescribir un archivo
  no cambia su fecha de creación, así que la caché nunca se veía “fresca” y tanto el
  visor como el barrido pedían la captura a HikCentral una y otra vez.
- El refresco usaba `getIntegralCameraData()`, que además pide streams y datos de
  PTZ que el trabajo no necesita.
- El barrido fijo de 4 horas **no era el defecto**: es el piso intencional para no
  cargar HikCentral. La frescura normal la aporta el visor, que captura y sube una
  imagen al detener cada stream, mientras `/api/camera/capture` sirve desde disco
  hasta que vence el TTL de 1 hora.

**Cambio.**
- `server.js:93-105`: `getCaptureAge()` usa `stats.mtimeMs`.
- `server.js:71-77`: se conserva el TTL de 1 hora y el barrido vuelve a ser de
  **4 horas** por defecto (`CAPTURE_REFRESH_INTERVAL`, `14400000` ms). No se deriva
  del TTL: un barrido cada TTL/2 multiplica las peticiones y golpea cámaras fuera de
  línea sin mejorar lo que ve el operador.
- `server.js:1318-1388`: el refresco usa `getCameras()` (solo índice de cámaras),
  reescribe únicamente las vencidas, deja una pausa entre capturas y usa una cadena
  de `setTimeout` para que dos ciclos no se solapen. Un error de HikCentral no detiene
  el ciclo.
- `server.js:858-901`: la ruta de captura también compara con `mtime` y sirve desde
  disco si está vigente.

**Prueba.**

- Suite `tests/capture-refresh.test.js`: **25/25**. La fase C ahora verifica que el
  valor por defecto sea 240 min para cualquier TTL, y que el override explícito siga
  ganando.
- Arranque real:

  ```text
  Refresco de capturas cada 240 min (TTL 60 min)
  ```

**Lección.** Los timestamps del sistema de archivos no son portables: para “última
modificación” hay que usar `mtime`. Y antes de cambiar una política de frescura hay
que entender quién consume el dato: aquí el visor es la fuente principal y el barrido
es solo una red de seguridad de bajo consumo.

---

## #8 — Mezcla de capturas locales al refrescar el catálogo

**Síntoma.** Al actualizar el catálogo, algunas cámaras perdían la captura que ya
estaba guardada en el navegador, o la captura se asociaba a otra cámara.

**Causa.** Se lanzaba un arreglo de promesas (`Promise.all`) y se mezclaba el
resultado por posición. El orden de resolución no está garantizado y la posición no
es una identidad estable.

**Cambio.**
- `public/js/script.js:1196-1213`: `mergeCachedCaptures()` crea un `Map` por
  `cameraIndexCode` y copia `capture` y `captureTimestamp` a la cámara remota
  correspondiente.
- `public/js/script.js:1245-1251`: se hace una sola lectura local y se usa el helper;
  ya no se consulta una vez por cámara ni se mezcla un arreglo de promesas.

**Prueba.** Suite `tests/capture-merge.test.js`: **17/17**. El caso de contraste
demuestra que el patrón viejo pierde la captura (`null`) y el nuevo la conserva.

**Lección.** Nunca se asocian resultados asíncronos por posición: se usa una clave
estable del dominio (`cameraIndexCode`).

---

## #9 — Correcciones adicionales de streams, frontend y PTZ

### 9.1 Mapeo posicional de previews

**Síntoma.** Se asumía que la respuesta de HikCentral traía `cameraIndexCode` en cada
elemento. En la instalación real, cada entrada trae solo `{url, authentication}`, sin
identificador.

**Causa.** El código mapeaba por posición sin comprobar que la cantidad de URLs
coincidiera con la cantidad de cámaras solicitadas. Si HikCentral devolvía menos
entradas, la cámara N recibía el stream de la N+1.

**Cambio.** `hikcentral.js:596-636`:
- Calcula `expectedCount`, `mainStreamComplete` y `subStreamComplete`.
- Si el stream principal llega incompleto, devuelve `status: 'fail'` con
  `code: 'previewURLs/mismatch'` y **no asigna nada**.
- Solo asigna el sub-stream si ambos llegaron completos.
- Si llega completo, arma `{ [cameraIndexCode]: { mainStream, subStream } }`.

**Prueba.**
- Sonda real: 701 solicitadas → 701 entradas con URL; 16 → 16; 2 → 2; un código
  inválido hace fallar la llamada completa (`code "2"`), no devuelve lista.
- Suite `tests/preview-mapping.test.js`: **23/23**.
- Servidor real: `POST /api/cameras/streams` con 2 ids → 2 claves, esquema `rtsp:`;
  `POST /api/cameras/integral` → 701/701 con stream principal.

**Límite conocido.** Si HikCentral devolviera las mismas entradas en otro orden, no
hay forma de detectarlo desde el cliente porque las entradas no traen identificador.
La comprobación de cantidad detecta truncamiento, no reordenamiento.

### 9.2 Typo en el nombre del encoder

**Síntoma.** El nombre completo de la cámara no incluía el nombre del dispositivo de
codificación.

**Causa.** El frontend leía `camera.encodingDeviceInfo`, pero el campo real es
`encodeDeviceInfo`.

**Cambio.** `public/js/script.js:478`:

```js
const cameraFullName = [camera.cameraName, camera?.area?.name, camera?.encodeDeviceInfo?.encodeDevName].filter(f => f).join(' - ');
```

**Prueba.** Suite `tests/remaining-fixes.test.js`, casos A1-A4: con
`{cameraName:'GARITA', area:{name:'Arroyo'}, encodeDeviceInfo:{encodeDevName:'DVR-01'}}`
el nombre pasa de `GARITA - Arroyo` a `GARITA - Arroyo - DVR-01`. La cadena vieja se
reproduce en la prueba para mostrar la diferencia.

### 9.3 Protocolo ignorado en la cámara individual

**Síntoma.** `POST /api/camera/integral` con `protocol: 'rtsp'` devolvía URLs
`ws:` porque el parámetro no se pasaba a `getCameraPreviewURL()`.

**Causa.** `getIntegralSingleCameraData(indexCode, protocol)` recibía el protocolo,
pero llamaba a `getCameraPreviewURL(cameraIndexCode)` sin el segundo argumento.
Además, `protocol` no tenía valor por defecto ni validación.

**Cambio.** `hikcentral.js:1361-1369` valida contra la lista permitida
(`rtsp`, `websocket`, `rtsp_s`, `websocket_s`, `hls`, `rtmp`), usa
`websocket` por defecto y pasa el protocolo a `getCameraPreviewURL()`.

**Prueba real (extremo a extremo, solo esquemas):**

| Body | `main` | `sub` | Estado |
|---|---|---|---|
| `protocol: 'rtsp'` | `rtsp:` | `rtsp:` | 200 |
| `protocol: 'websocket'` | `ws:` | `ws:` | 200 |
| sin `protocol` | `ws:` | `ws:` | 200 |
| `protocol: 'quic'` | — | — | `status: "fail"`, `"Invalid protocol"` |

### 9.4 Body abortado, error de request y 413

**Síntoma.** Si el cliente cortaba la conexión a mitad de un POST, el handler quedaba
colgado para siempre. Si el body superaba el máximo, el cliente recibía
`ECONNRESET` en lugar de `413`.

**Causa.**
- `getPostBody()` solo resolvía en `data`/`end`; `aborted` y `error` no resolvían.
- El listener `req.on('error')` se registraba **después** de `await getPostBody()`;
  el error podía ocurrir antes y quedar sin manejador.
- El `413` se respondía después de `req.destroy()`.

**Cambio.**
- `http-server.js:198-282`: `settle()` garantiza una sola resolución;
  `aborted` y `error` resuelven `null`; `data` corta al superar `MAX_POST_SIZE`.
- `http-server.js:311-332`: el listener de `error` se registra antes de leer el body;
  responde `400` antes de destruir si aún no se enviaron cabeceras.
- `http-server.js:338-350`: si el request abortó, no se entrega el body al router.
- `http-server.js:362-372`: el `413` se responde antes de destruir el socket.

**Prueba.** Suite `tests/remaining-fixes.test.js`, casos C1-C7:
- Abortar durante la lectura resuelve en vez de colgarse.
- Un POST normal sigue parseándose (`{hello:'world'}`).
- La ruta no se ejecuta con un body abortado (`0` llamadas).
- El servidor sigue respondiendo `/health` después del aborto.
- Un body de 50 bytes con límite de 10 devuelve `413`.

### 9.5 PTZ sin límite de concurrencia

**Síntoma.** Al construir el catálogo, cada cámara PTZ generaba 2 llamadas
(presets y patrols) lanzadas todas a la vez. Con 138 cámaras PTZ, eso son **276
peticiones simultáneas** a HikCentral.

**Causa.** `camerasList.map(async ...)` abría todas las promesas al mismo tiempo.

**Cambio.** `hikcentral.js:1144-1192`:
- Encoder y área se resuelven en memoria, sin I/O, en un `forEach`.
- Los presets/patrullas se procesan con un pool de workers:
  `PTZ_MAX_CONCURRENCY` (por defecto 4) limita cuántas cámaras se atienden a la vez;
  cada cámara sigue usando 2 llamadas en paralelo.
- Si una cámara falla, se guardan listas vacías y el catálogo continúa.
- `env.example:80-82` documenta la variable.

**Prueba.** Suite `tests/remaining-fixes.test.js`, casos D1-D13:
- Con 20 PTZ, el máximo en vuelo es 8 (4 cámaras x 2).
- Las 20 reciben presets y patrols; ninguna se consulta dos veces.
- `PTZ_MAX_CONCURRENCY=2` limita a 4 llamadas en vuelo.
- Con 1 cámara, el máximo es 2.
- El patrón viejo, sobre los mismos datos, llega a 40 llamadas simultáneas.
- Catálogo real: 701 cámaras, 138 PTZ (el código viejo habría abierto 276).

**Lección.** Las APIs externas no siempre devuelven un identificador; si no lo hay,
es mejor fallar que etiquetar mal. Y cualquier abanico de llamadas a un servicio
externo necesita un límite.

---

## A — Captura: falta de `return` después de responder

**Contexto.** Al validar los cambios manuales posteriores se encontró que
`POST /api/camera/capture` validaba el `id` y respondía `200` vacío, pero no salía de
la función.

**Síntoma.** Un `id` inválido entraba igual al resto del handler. Después de
`res.end('')` se volvía a llamar `res.writeHead()` al servir o guardar la captura.
En un handler `async`, eso produce `ERR_HTTP_HEADERS_SENT` como rechazo no manejado,
y Node 22 puede terminar el proceso.

**Cambio.** `server.js:830-838`:

```js
if (! id || ! /^\d+$/.test(id)) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('');

    return false;
}
```

También se eliminó un bloque `if (! forceRefresh) {}` que no hacía nada.

**Nota.** La validación numérica del `id` es una buena defensa para la ruta de
archivo: el id se usa para construir `public/img/captures/<id>.jpeg`, y aceptar
`../` o separadores permitiría escribir fuera de la carpeta. En esta instalación las
701 cámaras tienen id numérico, así que el guard es correcto. Si en el futuro
HikCentral usara GUIDs, habría que ampliarlo a un conjunto seguro como
`[A-Za-z0-9_-]+` (sin `/`, `\`, `:` ni `.`), no a cualquier cadena.

**Prueba (servidor real).**

```text
id="abc"      status=200 bodyLength=0
id=""         status=200 bodyLength=0
id=undefined  status=200 bodyLength=0
capture-upload con payload inválido: 200 {"status":"fail", ...}
health después de los ids inválidos: 200
```

**Lección.** Después de responder hay que salir. En funciones `async`, un `throw`
fuera de un `try` no lo atrapa el router y puede tumbar el proceso. Validar el id
antes de construir una ruta de archivo es tan importante como validar la ruta
estática.

---

## B — Endurecimiento de LDAP

**Síntoma.** Durante las pruebas de login, una entrada inesperada o un error del
directorio podía provocar una excepción no controlada y dejar el proceso inestable.

**Causa.** El flujo de LDAP tenía varios puntos sin red de seguridad:
- Se asumía que `username` era string y se llamaba a `.split()` sin comprobar.
- Un usuario vacío podía terminar en bind anónimo y un filtro inválido.
- El filtro se construía concatenando texto, lo que abre la puerta a inyección LDAP.
- `client.bind`, `client.search` y `client.unbind` podían lanzar o emitir errores sin
  un camino claro de resolución.

**Cambio.** `server.js:514-669`:
- Valida tipo, longitud y caracteres del usuario (`/^[A-Za-z0-9._-]+$/`) antes de
  tocar LDAP.
- Usa `new ldap.EqualityFilter({attribute:'sAMAccountName', value: username})` en
  lugar de concatenar el filtro.
- Envuelve `bind`, `search` y `unbind` en `try/catch`; agrega manejadores para
  `error`, `connectError`, `close`, `searchEntry`, `search` error y `end`.
- Resuelve una sola vez y devuelve `500` ante fallo del directorio, sin tumbar el
  proceso.
- La comprobación de grupo se hace solo después de un bind correcto.

**Prueba (servidor real).**

| Entrada | Resultado |
|---|---|
| `username` objeto | 401 |
| `password: null` | 401 |
| `username: ''` | 401 |
| credenciales inválidas | 401 |
| `/health` después de todos los intentos | 200 |

Suite `tests/group-check.test.js`: **7/7**, incluyendo bind correcto, password
incorrecta y usuario sin `memberOf`.

**Lección.** Un directorio también es una fuente no confiable: el filtro se arma con
objetos, no con texto. Todo callback asíncrono necesita un camino de error; si no,
el proceso entero paga por una petición mal formada.

---

## C — Endurecimiento de `capture-upload`

**Síntoma.** El endpoint existía para que el navegador guardara la captura tomada por
el plugin local. Aceptaba cualquier `id` numérico y confiaba en el prefijo del data
URI; además, un `data` que no fuera texto podía tumbar el proceso.

**Causa.**
- No se comparaba el `id` con el catálogo: `999999999` era un archivo válido. Con un
  JWT legítimo se podían crear archivos sin límite (llenado de disco).
- `data.startsWith(...)` se ejecutaba sin comprobar el tipo. Un número u objeto
  producía `TypeError` dentro de un callback `async` sin `catch`, y Node terminaba el
  proceso.
- Solo se validaba el prefijo `data:image/jpeg;base64,`; el contenido podía ser
  cualquier cosa.
- `if (! captureAge ...)` trataba `0` como “no existe” (inofensivo, pero incorrecto).

**Cambio.** `server.js`:
- `knownCameraIds` (`server.js:86`) se llena con `getCameras()` antes de abrir el
  puerto (`refreshKnownCameraIds`, `server.js:119-129` y `1296-1298`) y en cada refresco
  de capturas (`setKnownCameraIds`, `server.js:107-115` y `1316-1317`). Si HikCentral
  falla, se conserva el catálogo anterior; nunca se vacía por un error.
- El handler (`server.js:943-1021`) exige `id` numérico **y** presente en el catálogo,
  `data` de tipo texto, tamaño máximo (`CAPTURE_UPLOAD_MAX_BYTES`, 4 MB por defecto),
  alfabeto base64 válido y firma JPEG `FF D8 FF`. La comprobación de vencimiento usa
  `null === captureAge`.
- Un fallo de escritura ahora responde `fail` en vez de `success`.

**Prueba.** `tests/capture-upload.test.js`: **24/24**.

| Caso | Resultado |
|---|---|
| Sin JWT | 401, no escribe |
| `id` no numérico | `Invalid camera index code captured data` |
| `id` numérico fuera del catálogo | `Unknown camera index code`, no escribe |
| `data` no texto | `fail`, el proceso sigue en `/health` 200 |
| Contenido que no es JPEG | `Captured data is not a JPEG image`, no escribe |
| Base64 inválido | `Invalid captured data encoding` |
| 2 KB con tope de 1 KB | `Captured data size is invalid`, no escribe |
| JPEG válido | `success`, archivo idéntico byte a byte |
| Archivo vigente | `success`, no se reescribe (mtime igual) |
| Archivo vencido / inexistente | se reescribe / se crea |

**Lección.** Validar el formato de entrada no es validar el recurso: el `id` debe
existir en el catálogo y el contenido debe comprobarse por sus bytes, no por su
etiqueta. Y todo callback `async` necesita un `try/catch` o una comprobación de tipo
antes de tocar el cuerpo de la petición.

---

## D — Pantallas 1-4 sin clave (decisión operativa, 15/11/2026)

**Contexto.** Las pantallas `/pantalla1` a `/pantalla4` se usan en televisores para
personal no técnico. Se indicó quitar la clave para que abran directo, asumiendo el
riesgo en una red interna.

**Alcance del cambio.** `server.js:427-467`:
- Se agregó `openScreenEndpoints` (`server.js:438-441`) y el bypass
  (`server.js:447-449`) para `/pantalla1..4`, `/pantalla.html` y `/connect_client_alt`.
- `/connect_client_alt` es el canal SSE que la propia página abre para recibir el
  stream (`pantalla.html:163`); sin él la pantalla carga pero queda en blanco.
- `pantalla.html:46-50` conserva `?key=` como opcional, por si se vuelve a exigir.

**Qué sigue protegido** (probado sin clave/JWT):
- `/screen`, `/screen.html`, `/get_clients`, `/connect_client` → 401
  (`Screen access key required`).
- `/sse_events?isScreen=true` sin clave → 401.
- `/share_camera`, `/share_camera_alt`, `/generatehash` y `/sse_events` de operador →
  JWT obligatorio (401 sin token).
- Todos los `/api/...` → JWT obligatorio.

**Prueba (servidor real).**

| Petición sin clave/JWT | Resultado |
|---|---|
| `GET /pantalla1` | 200 HTML |
| `GET /pantalla2` | 200 HTML |
| `GET /pantalla3` | 200 HTML |
| `GET /pantalla4` | 200 HTML |
| `GET /pantalla.html` | 200 HTML |
| `GET /connect_client_alt?clientId=...` | 200 `text/event-stream`, evento `connect` |
| `GET /screen` | 401 |
| `GET /get_clients` | 401 |
| `POST /connect_client` | 401 |
| `POST /share_camera` | 401 |
| `GET /sse_events?isScreen=true` | 401 |
| `POST /api/cameras` | 401 |

Suite `tests/auth-gaps.test.js`: **40/40**. La sección 9 se actualizó: antes esperaba
401 en `/pantalla*`; ahora verifica 200 sin clave, 200 en el SSE de pantalla y que
`/screen` sigue en 401.

**Riesgo aceptado.** Cualquiera en la red interna puede abrir las pantallas y
suscribirse a `/connect_client_alt`; no puede operar cámaras ni cambiar el stream,
porque el envío lo hace `/share_camera_alt`, que sigue exigiendo JWT.

**Cómo revertir.** Quitar `/pantalla1..4`, `/pantalla.html` y `/connect_client_alt`
de `openScreenEndpoints` (`server.js:438-441`) y devolverlos a `screenEndpoints`
(`server.js:442-445`). La página ya reenvía `?key=` si está presente, así que no hay
que tocar el frontend.

---

## E — Scripts de arranque/parada y ACL del lanzador (15/11/2026)

**Contexto.** La tarea programada `CCTV Viewer` corre como `SYSTEM` y ejecuta
`C:\ProgramData\CCTV\cctv_viewer.bat`, que hace `cd /d` al proyecto y lanza
`node server.js` escribiendo en `logs\cctv-viewer.log`. El lanzador vive **fuera**
del proyecto a propósito: reemplazar, comprimir o limpiar la carpeta del proyecto no
borra el arranque automático. La contra es que la ruta del proyecto está fija en el
`cd /d`; si el proyecto se mueve, hay que actualizar esa línea.

Dentro del proyecto quedaban dos helpers manuales con problemas.

**Hallazgos.**
- `detener cctv_viewer (Ejecutar com Adminstrador).bat` ejecutaba
  `taskkill /IM node.exe /F`, que termina **todos** los `node.exe` de la máquina.
  En este servidor hay cuatro procesos `node.exe` de HikCentral (OpenAPI), así que
  el helper podía tumbar servicios ajenos al visor.
- `start_cctv_viewer.bat` usaba `node server.js --watch`: el `--watch` queda como
  argumento del programa y **no** activa el modo watch (el mismo detalle medido en
  la nota 9 de pendientes).
- `C:\ProgramData\CCTV` heredaba `BUILTIN\Users: Write` sobre la carpeta. El `.bat`
  en sí ya era `ReadAndExecute` para Users (no modificable), pero un usuario estándar
  podía crear archivos en esa carpeta.

**Cambios.**
- `start_cctv_viewer.bat`: exige elevación, inicia la tarea `CCTV Viewer` con
  `schtasks /run` y, si la tarea no existe o falla, cae a un arranque manual oculto
  con `node --watch server.js` (orden correcto). Al final consulta
  `/health` en `https://127.0.0.1:3000/health`.
- `detener cctv_viewer (...).bat`: exige elevación, hace `schtasks /end` de la tarea
  y termina **solo** el PID que escucha en el puerto 3000, deduplicando las líneas
  IPv4/IPv6 de `netstat`. No usa `taskkill /IM`.
- ACL de `C:\ProgramData\CCTV`: se desactivó la herencia, se quitó `Users` y se
  volvió a conceder solo lectura y ejecución. Resultado medido:
  `SYSTEM` y `Administradores` con `FullControl`, `Users` con
  `ReadAndExecute, Synchronize`, sin `Write`.

**Prueba.**
- Copias de ambos `.bat` con `schtasks`, `taskkill`, `curl` y `pause` reemplazados
  por `echo`: el de arranque llega al final con código 0; el de parada detecta el
  PID real `43720` una sola vez y no mata nada.
- `netstat -ano` filtrado por `:3000 .*LISTENING` devuelve el PID que escucha.
- ACL posterior verificada con `Get-Acl`; el servidor siguió en `/health` 200 con
  el mismo PID después de las pruebas.
- No hay suite automática para estos `.bat`; la validación fue la ejecución de las
  copias neutralizadas y la inspección de ACL.

**Lección.** Un script que se ejecuta como `SYSTEM` al arrancar debe vivir en una
ruta que solo administradores puedan escribir, y nunca debe detener procesos por
nombre cuando ese nombre es compartido (`node.exe`).

---

## Cambios manuales posteriores a esta revisión

Estos cambios los hizo el autor después de la revisión; se documentan para que el
changelog no los atribuya a la IA y para dejar claro por qué el harness de #7 cambió.

- **Subida de capturas desde el cliente.** Se agregó
  `POST /api/camera/capture-upload` (`server.js:943-1021`) y su uso en
  `public/js/script.js:27` y `public/js/script.js:736-745`. El endpoint está dentro de
  `endpoints.protected` (exige JWT), valida que `id` sea numérico y que el dato
  empiece con `data:image/jpeg;base64,`, y solo escribe si la captura no existe o
  está vencida. El frontend solo sube la imagen cuando la tomó el plugin local
  (`isLocalPicture`), no cuando ya vino del servidor. El hallazgo **C** endureció
  después este endpoint (catálogo, tamaño y firma JPEG).
- **Validación numérica del id en `/api/camera/capture`.** Evita que el id se use
  para salir de `public/img/captures/`. Es la razón por la que el harness de #7 se
  actualizó de `CAM1..CAM4` a `101..104`: los ids reales de esta instalación son
  numéricos.
- **Ajustes en `public/index.html`.** Sin impacto en los hallazgos de esta revisión.

La revisión encontró y corrigió el hallazgo **A** al validar estos cambios.

---

## Cómo reproducir las pruebas

Las suites quedaron en `tests/` (copiadas desde el entorno temporal para que no se
pierdan). Se ejecutan desde la raíz del proyecto:

```powershell
node tests\auth-gaps.test.js
node tests\group-check.test.js
node tests\rate-limit.test.js
node tests\capture-refresh.test.js
node tests\capture-upload.test.js
node tests\capture-merge.test.js
node tests\preview-mapping.test.js
node tests\remaining-fixes.test.js
```

- Las suites levantan instancias de prueba en puertos propios (3444, 3445, 3446,
  3497, 3498 y 3499) y no tocan las capturas de producción.
- `group-check` levanta un LDAP simulado en el puerto 1389.
- Las pruebas de protocolo y los chequeos contra el servidor real se hicieron aparte,
  con un JWT firmado con el secreto del entorno; solo imprimen estados y esquemas.
- En PowerShell, los avisos TLS de Node en `stderr` pueden hacer que el comando
  devuelva código 1 aunque la suite haya pasado. Hay que leer la última línea
  (`ALL CHECKS PASSED`), no solo el código de salida.

---

## Limpieza de artefactos obsoletos (15/11/2026)

- **`public/js/script.min.js` eliminado.** Estaba viejo (incluía una credencial de
  ejemplo `admin123`) y ningún HTML lo cargaba. Antes de borrarlo se copió a
  `%TEMP%\opencode\removed-min-files\` por si hiciera falta. Verificado en el
  servidor real: `/js/script.min.js` → 404, `/js/script.js` → 200.
- **`server.min.js` eliminado.** Tenía un secreto JWT por defecto y un `/shutdown`
  sin autenticación; no se servía. También quedó respaldado en la misma carpeta.
  Verificado: `/server.min.js` → 404.
- **`public/index.min.html` eliminado.** Era una copia vieja de `index.html` y ningún
  archivo la referenciaba; cargaba `./js/script.js`, así que tampoco ejecutaba código
  viejo. Respaldada en la misma carpeta temporal. Verificado en el servidor real:
  `/index.min.html` → 404, `/index.html` → 200.
- **Volcado de AD real eliminado de `server.js`.** El bloque comentado entre antiguas
  líneas 633-699 (nombre, correo, teléfono, cuenta, grupos, SID y GUID de un usuario
  real) se reemplazó por una nota corta (`server.js:633`). La eliminación se hizo por
  líneas con comprobación de inicio/fin para no alterar los bytes del resto del
  archivo; `node --check server.js` pasó después. El `CHANGELOG` conserva la lección,
  no los datos.
- **Log de producción truncado.** `logs/cctv-viewer.log` pasó de **343.492.386 bytes a
  0**. El crecimiento venía de versiones anteriores que imprimían la respuesta
  completa de HikCentral (incluido el base64 de cada captura); el código actual ya
  imprime solo el resumen. Queda pendiente agregar rotación.

---

## Pendientes y notas de riesgo

Estos puntos **no** forman parte de los #1-#9, A, B, C y E corregidos; quedan
documentados para decidir el siguiente paso.

1. **Validación del certificado LDAP desactivada.** Estado medido el 15/11/2026:
   - `172.20.0.13` (DC-00) presenta un certificado **autofirmado** con
     `CN=*.inapa.local`, SAN `DNS:*.inapa.local`, válido 18/01/2024 → 18/01/2034.
     Verificar contra las CA de Node falla con `DEPTH_ZERO_SELF_SIGNED_CERT`.
     Si se usa `inapa-dc-00.inapa.local` como nombre y se fija ese certificado como
     CA, la verificación **pasa** (probado). Con la IP como nombre falla por
     `ERR_TLS_CERT_ALTNAME_INVALID`.
   - `172.20.0.14` (DC-02) presenta un certificado emitido por
     `inapa-APS-RADIUS-01-CA` con SAN `DNS:INAPA-DC-02.inapa.local`, **vencido el
     01/10/2025**. Falla con `CERT_HAS_EXPIRED` incluso fijando el certificado.
     El nombre `INAPA-DC-02.inapa.local` resuelve a `172.20.0.14`.
   - `inapa-dc-01.inapa.local` no resuelve (`ENOTFOUND`).
   Plan: renovar DC-02, exportar la cadena de la CA emisora a un PEM, usar nombres
   DNS en `LDAP_URLS` (no IP, para que coincida el SAN), poner
   `LDAP_TLS_REJECT_UNAUTHORIZED=true` y `LDAP_TLS_CA=<ruta>`. Para DC-00, decidir
   entre emitir un certificado de la CA interna o fijar el autofirmado.
2. **`NODE_ENV=development` en `.env`.** Probado el 15/11/2026: con
   `NODE_ENV=production` y verificación TLS activa, `getCameras()` devuelve
   `503 / fetch failed`. El certificado de HikCentral (`172.20.2.99:443`) es
   autofirmado, `CN=127.0.0.1`, sin SAN. Añadirlo con `NODE_EXTRA_CA_CERTS` tampoco
   alcanza: falla con `ERR_TLS_CERT_ALTNAME_INVALID` porque el nombre no coincide.
   Por eso hoy el modo `development` (que desactiva TLS globalmente en
   `hikcentral.js:6-9`) es lo que mantiene la app funcionando. Opciones:
   (a) dejar `development` como está; (b) instalar en HikCentral un certificado
   válido para `172.20.2.99` y pasar a `production`; (c) limitar la excepción TLS al
   cliente de HikCentral en el código.
3. **Grupos anidados de AD.** La comprobación es por CN exacto en `memberOf`; no se
   expanden grupos dentro de grupos (`server.js:499-512`, `658`).
4. **Reordenamiento de previews.** La comprobación de cantidad detecta truncamiento,
   pero no un reordenamiento, porque HikCentral no devuelve un identificador por
   entrada (`hikcentral.js:596-636`).
5. **Guard numérico de ids.** Es correcto para las 701 cámaras actuales. Si se
   integra otro HikCentral con ids alfanuméricos/GUID, hay que ampliarlo a un conjunto
   seguro, no a cualquier cadena.
6. **Sin control de versiones.** No hay `git` en el entorno. Conviene inicializar un
   repositorio y hacer un commit de este estado; no reescribir el historial de
   secretos del repositorio privado.
7. **Cabeceras de caché.** Los estáticos no envían `Cache-Control`/`ETag`
   (`http-server.js:415-416`). No es un problema de seguridad, pero un navegador
   puede seguir usando un `script.js` viejo; si un cambio no aparece, hacer recarga
   forzada.
8. **Log de producción sin rotación.** `logs/cctv-viewer.log` ya se truncó a 0 bytes
   (venía de ~343 MB), pero el archivo no rota: con el tiempo volverá a crecer. El
   código actual imprime solo el resumen, no la respuesta completa de HikCentral.
   Conviene agregar rotación (por tamaño o por fecha).
9. **Arranque en producción.** La tarea programada `CCTV Viewer` (SYSTEM, al
    arrancar, con reintentos) ejecuta `C:\ProgramData\CCTV\cctv_viewer.bat`, que llama
    `node server.js` **sin** `--watch` y escribe en `logs/cctv-viewer.log`. Los
    procesos lanzados a mano pueden morir cuando termina la sesión que los creó; para
    producción conviene usar la tarea, no una consola oculta. **Estado 15/11/2026:**
    producción corre con la tarea, el proceso pertenece a `NT AUTHORITY\SYSTEM` y
    `/health` responde 200. Dato medido: con `node server.js --watch` Node **no**
    activa el modo watch (las opciones deben ir antes del script:
    `node --watch server.js`); `--watch` queda como argumento del programa. Por eso los
    cambios recientes requerían reiniciar el proceso.
    El lanzador vive fuera del proyecto (`C:\ProgramData\CCTV\cctv_viewer.bat`);
    si el proyecto se mueve, hay que actualizar su `cd /d`.
10. **Contacto del autor en la cabecera.** `server.js:1` conserva el crédito original
    con un teléfono. Es intencional y no se tocó; si el archivo se publica fuera del
    repositorio privado, conviene decidir si ese dato debe quedarse.
11. **Pantallas 1-4 abiertas (riesgo aceptado).** Por decisión operativa del
    15/11/2026, `/pantalla1..4`, `/pantalla.html` y `/connect_client_alt` no piden
    clave para que el personal no técnico las abra en los televisores. Cualquiera en
    la red interna puede verlas y suscribirse al SSE de pantalla, pero **no** puede
    operar: `/share_camera*`, `/generatehash`, `/connect_client`, `/get_clients`,
    `/screen` y `/api/...` siguen protegidos. Detalle y reversión en la sección D.

---

## Lo que se aprendió

- **Fallar cerrado** es más seguro que “arreglar” una cadena: rutas resueltas,
  listas blancas y grupos obligatorios.
- **Los secretos no van en plantillas** y el arranque debe negarse si faltan.
- **Cifrar el borde no alcanza:** si el servidor habla con LDAP en claro o con una
  llamada HTTP interna, la contraseña sigue expuesta.
- **Autenticación ≠ autorización.** Una clave de pantalla no debe poder operar.
- **Los límites se cuentan por fallo**, no por intento, y no se confía en cabeceras
  del cliente.
- **Las APIs externas mienten por omisión:** si no devuelven un identificador, hay
  que fallar, no adivinar por posición.
- **`return` después de responder** y **try/catch en callbacks** evitan que una
  petición mal formada tumbe todo el servicio.
- **Una prueba real vale más que una suposición.** Cada hallazgo de este documento
  tiene una salida concreta; si el código cambia, la prueba debe volver a ejecutarse.
