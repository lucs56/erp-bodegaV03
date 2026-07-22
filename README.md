# ERP de Insumos para Bodega

> Rama experimental destinada al repositorio `lucs56/erp-bodegaV03`. Utiliza la base D1 independiente `erpcompras` (`48598a0a-0415-46fd-8918-cfa1d0928a6b`) y no modifica los datos del ERP V02.

## Planificación mensual y navegación lateral

- Nueva sección `Plan mensual`, separada de la programación semanal existente.
- Importa estimados en formato largo (`Mes`, `Código producto`, `Botellas`, `Cj x`) o ancho, con columnas `Agosto`, `Septiembre`, etc.
- Relaciona automáticamente el código del vino con su BOM y obtiene los códigos de botellas, cierres, cápsulas, etiquetas, cajas y demás insumos.
- Calcula cajas enteras según presentación de 6 o 12 botellas.
- Importa las compras pendientes de recepción con mes previsto, proveedor y orden de compra.
- Proyecta mes por mes: `necesidad bruta − stock − pendiente por llegar = compra a planificar`.
- El saldo disponible se arrastra al mes siguiente y una entrega futura no cubre consumos anteriores.
- Mantiene visible el stock desglosado por depósito y exporta programa, pendientes y plan de compras en un único Excel.
- Programa y pendientes se guardan en las tablas D1 `monthly_plan_rows` e `incoming_materials`, creadas automáticamente sin alterar los datos existentes.
- La navegación principal pasa a una barra lateral en escritorio y conserva el formato adaptable en pantallas pequeñas.
- Incluye `public/examples/Plantilla-Estimado-Mensual.xlsx` y `public/examples/Plantilla-Pendientes-Recepcion.xlsx` para comenzar las pruebas.

## Corrección de pantalla blanca v33

- El tablero ya no intenta leer la etiqueta de una semana inexistente mientras Google Sheets está cargando o devuelve temporalmente cero semanas.
- Muestra un estado seguro `Sin programación cargada` y mantiene disponible la interfaz.
- Los gráficos evitan dividir por cero cuando todavía no hay operaciones.
- El `401` de `/api/auth` continúa siendo la respuesta normal cuando no existe una sesión iniciada.

## Mejoras de la versión 32

- El aviso de cambios abre Programación y filtra las filas agregadas o modificadas.
- La configuración operativa es editable únicamente por administradores y se guarda en Cloudflare D1.
- Permite configurar el ID del Sheet, los intervalos de sincronización y caché, y los depósitos incluidos.
- La caché de programación es compartida en D1 para evitar reprocesamientos entre navegadores y reducir el riesgo del Error 1102.
- Se recomiendan 60 segundos de sincronización y caché; el botón de actualización inmediata continúa disponible.
- Las credenciales privadas de Google permanecen protegidas como secretos de Cloudflare.

## Mejoras de la versión 28

- Programación conectada a Google Sheets sin caché, actualización automática cada 30 segundos con la pestaña visible y botón manual.
- Importación de hasta 20.000 insumos en lotes D1, reemplazo de la fotografía anterior y verificación de la cantidad realmente guardada.
- Recálculo de faltantes y compras después de confirmar la importación completa.
- Reporte general y reporte Excel individual por insumo, nombrado con la descripción del material.
- Administración de usuarios: altas, bajas, perfiles, permisos, bloqueo, restablecimiento de contraseña y estado de credenciales.
- Cambio de contraseña propio desde el menú de perfil. Las contraseñas son hashes irreversibles y nunca se muestran en texto plano.
- Asistente con respuestas conversacionales y búsqueda por código o nombre.
- Indicador de Fraccionamiento calculado según la cantidad real de pestañas/semanas detectadas en Google Sheets.

## Mejoras de la versión 29

- Stock total con desglose por depósitos `2`, `C18`, `R18` y `2OB`.
- Nueva tabla D1 `stock_depot_items`, creada automáticamente al iniciar la aplicación.
- Depósitos visibles en Stock, Faltantes, Compras y reportes Excel individuales.
- Lecturas de Google Sheets reutilizadas durante 15 segundos para evitar picos y errores 503.
- Sincronizaciones simultáneas consolidadas en una única descarga; el botón manual fuerza una lectura nueva.
- Respuestas de error de API controladas para evitar mensajes `Unexpected token '<'`.
- Fuentes locales del sistema para eliminar los 404 de archivos Geist.

## Mejoras de la versión 30

- Exportación de Compras por tipo de insumo, con un botón independiente para Botellas, Tapones, Cápsulas, Cajas y cada categoría detectada.
- Una sola fila por código de insumo dentro de cada archivo; los productos consumidores quedan consolidados en una celda.
- Nombre automático del archivo según la categoría, por ejemplo `reporte-compras-Tapones-AAAA-MM-DD.xlsx`.

## Mejoras de la versión 31

- Administración conserva intacta la gestión de usuarios y agrega pestañas informativas de Configuración y Diagnóstico.
- Diagnóstico muestra conexión, última lectura, semanas, operaciones, stock y estado del motor de cálculo, con botón para probar la conexión.
- El depósito `13` se identifica como Producción y se suma al stock disponible para calcular Faltantes y Compras.
- Los depósitos permanecen desglosados en pantalla y en Excel: `13 (Producción)`, `C18 (Calidad)`, `2 (Depósito 2)`, `R18` y `2OB`.
- Prueba de control: necesidad 300.000 menos 230.000 disponibles entre depósitos produce una compra de 70.000.

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout and then validates the Sites artifact. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm test`: build, validate, and verify the rendered development-preview metadata
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build and validation commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
