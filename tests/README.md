# Pruebas de la revisión

Estas suites son las pruebas usadas para verificar los hallazgos documentados en
`CHANGELOG.md`. No forman parte del servidor de producción: cada una levanta su
propia instancia o analiza el código fuente.

## Ejecutar

Desde la raíz del proyecto:

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

Cada suite imprime una tabla y termina con `ALL CHECKS PASSED` o `FAILURES: n`.

## Notas

- `auth-gaps` (3445), `group-check` (3444) y `rate-limit` (3446) levantan servidores
  de prueba en puertos propios y usan credenciales ficticias.
- Por decisión operativa del 15/11/2026, `/pantalla1..4`, `/pantalla.html` y
  `/connect_client_alt` no piden clave. `auth-gaps` lo verifica y comprueba que
  `/screen`, `/get_clients`, `/connect_client`, `/share_camera*` y `/sse_events`
  de operador siguen protegidos.
- `group-check` levanta un LDAP simulado en el puerto 1389; `auth-gaps` y
  `rate-limit` usan simulados en 1390 y 1391.
- `capture-refresh` copia la aplicación a un directorio temporal, levanta el servidor
  en 3498 con un mock en 19090 y usa capturas ficticias; no toca
  `public/img/captures` de producción.
- `capture-upload` hace lo mismo en 3499 con un mock en 19091: valida catálogo,
  tamaño, base64 y firma JPEG, y comprueba que un `data` no texto no tumbe el
  proceso.
- `capture-merge`, `preview-mapping` y `remaining-fixes` hacen pruebas unitarias y/o
  levantan un servidor aislado en el puerto 3497.
- En PowerShell, los avisos TLS de Node en `stderr` pueden hacer que el comando
  devuelva código 1 aunque la suite haya pasado. Hay que leer la última línea.
- Las suites usan rutas absolutas a `E:\inapa_hikvision_api_proxy`. Si el proyecto se
  mueve, hay que actualizar `ROOT` / `APP_DIR` en cada archivo.
