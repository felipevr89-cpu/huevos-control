# Proyecto Huevos - Contexto para AI Assistant

## Descripción
App PWA de gestión de pedidos de huevos. Vanilla HTML/CSS/JS, sin frameworks. Datos en localStorage + sync con Cloudflare Worker.

## Ruta del proyecto
`/media/datos/Felipe/Cosas/App/Huevos/`

## Archivos principales
- `app.js` — Lógica principal (~1280 líneas)
- `index.html` — Estructura HTML (~187 líneas)
- `styles.css` — Estilos (~330 líneas)
- `sw.js` — Service Worker (cache v11, network-first para dinámicos)
- `manifest.json` — Manifest PWA
- `icons/` — Iconos de la app
- `worker/worker.js` — Código del worker de sync (merge seguro v3 + serverTime)
- `worker/merge.mjs` — Lógica de merge LWW (testable独立)
- `worker/wrangler.toml` — Config del worker de sync (binding KV)
- `tests/worker-merge.test.mjs` — Tests del merge del worker

## Infraestructura
- **Hosting**: Cloudflare Pages (`huevos-app`)
- **Deploy**: `./deploy.sh` — despliega **desde git HEAD** (nunca desde el disco local) y **aborta si el repo está sucio**. Nunca usar `wrangler pages deploy --commit-dirty=true` manualmente.
- **Wrangler path**: `/tmp/node_modules/.bin/wrangler`
- **Sync Worker**: `https://huevos-sync.felipe-v-r-89.workers.dev/api/sync`
- **Sync Key**: `huevos-felipe`
- **Worker KV**: `HUEVOS_KV` (id `dde9bf64866847238cdd7bf799509845`)
- **Worker deploy**: `cd worker && wrangler deploy --config wrangler.toml`
- **GitHub repo**: `felipevr89-cpu/huevos-control`
- **Backups**: `/media/datos/Felipe/Cosas/Backups-Huevos/` (script `backup-huevos.sh`)
- **Tag base**: `v14.0.0`

## Funcionalidades
1. **Pedidos** — Crear, editar (✏️), eliminar, marcar como entregado
2. **Flujo de pago** — Al entregar: "¿El cliente pagó?" → Sí = pagados, No = deudores
3. **Deudores** — Lista con alerta >7 días sin pagar
4. **Pagados** — Historial ordenado de más reciente a más antiguo
5. **Compras** — Registro de cajas de huevos (1 caja = 6 bandejas), margen 30/35/40%
6. **Contabilidad** — Resumen de ventas, inversiones, ganancia neta
7. **Notas** — Textarea sincronizado entre dispositivos
8. **Sync** — Auto-sync con Cloudflare Worker cada 60s (pull+push completo) + al guardar + al volver a la pestaña + al reconectar
9. **Importar/Exportar** — Backup JSON
10. **PWA offline** — Service Worker con cache

## Estructura de datos (localStorage key: `huevos_data`)
```json
{
  "orders": [{ "id", "name", "trayCount", "pricePerTray", "total", "date", "status", "payment", "paid", "paidDate", "updatedAt", "deliveryDate?", "phone?", "payments?" }],
  "purchases": [{ "id", "boxCount", "pricePerBox", "markupPercent", "suggestedTrayPrice", "sellingPrice", "date", "updatedAt?" }],
  "notes": "string",
  "notesUpdatedAt": timestamp,
  "deleted": [{ "id", "type", "at" }],
  "settings": { "businessName", "stockAlertTrays" },
  "settingsUpdatedAt": timestamp
}
```

## Sync Metadata (localStorage key: `huevos_sync_meta`)
```json
{
  "lastUpload": timestamp,
  "everUploaded": boolean,
  "dirty": boolean,
  "clockSkewDetected": boolean,
  "lastError": "string|null",
  "lastErrorAt": timestamp
}
```

## Cómo funciona el sync (v11)
- **Pull**: GET al worker, retorna todos los datos + `serverTime`
- **Push**: POST al worker con TODOS los pedidos/compras (no solo delta). Worker hace merge LWW por `updatedAt`
- **Clock skew**: Si `Date.now()` difiere >5min del `serverTime` del worker, se fuerza `lastUpload = 0` (push completo)
- **Triggers**: Al cargar (push), cada 60s (push), al volver a la pestaña (push), al reconectar (push), al guardar (push con 500ms debounce), tap en ícono de sync (push)
- **Errores**: Se guardan en `syncMeta.lastError` y se muestran en el tooltip del ícono de sync
- **Retry**: Exponencial backoff 30s → 60s → 120s → 240s → 300s (máx)

## Notas importantes
- **NUNCA usar `write` tool** — falla silenciosamente. Usar siempre `bash` con heredoc `cat > file << 'EOF'`
- El `wrangler.toml` raíz es solo para Pages; el del worker está en `worker/wrangler.toml`
- Los datos del worker tienen ~220 pedidos, 3 compras, notas
- El usuario tiene otra persona con la app en su celular (sync entre dispositivos)
- Los backups diarios se generan con `backup-huevos.sh` Y con snapshots automáticos del worker (KV `snap:data:<key>:<fecha>`, últimos 14 días; endpoint `/api/backup`)
- Tests: `node tests/worker-merge.test.mjs` (merge del worker)
- **SW v14**: `cache: 'no-cache'` para archivos dinámicos, `huevos-v14` cache name
- **app.js** se carga con `?v=12` query string para bustear cache del navegador

## Historial de bugs
- `write` tool falla silenciosamente — archivos no se persisten. **NUNCA usar `write` tool**, usar `bash` con heredoc `cat > file << 'EOF'`
- Git repo se corrompió (apuntaba a `/tmp/huevos-git`) — se reinicializó
- `CLOUDFLARE_API_TOKEN` no está configurado en GitHub Secrets
- POST al worker sin data borra todos los datos (cuidado) — **CORREGIDO en worker v2** (merge seguro + rechazo de payload vacío)
- Archivos locales se sobrescribieron con versión antigua (app sin sync, 5 tabs) — se desplegó basura con `--commit-dirty=true` → **CORREGIDO**: `deploy.sh` ahora despliega desde `git archive HEAD` y aborta si el repo está sucio. Nunca usar `--commit-dirty=true` a mano.
- **pushLocal() usaba `o.id` en vez de `p.id`** para filtrar compras en delta push — compras modificadas no se pusheaban. **CORREGIDO** (linea 134 → `p.id`).
- **Clock skew**: si el reloj del dispositivo estaba desincronizado, `updatedAt` nunca superaba `lastUpload` y los cambios no se pusheaban. **CORREGIDO**: worker retorna `serverTime`; cliente detecta skew >5min y fuerza push completo.
- **Push delta no enviaba cambios**: El filtro `updatedAt > lastUpload` fallaba si el reloj estaba mal o `lastUpload` era incorrecto. **CORREGIDO en v11**: `pushLocal()` siempre envía TODOS los pedidos/compras. Worker merge LWW maneja deduplicación.
- **SW servía app.js cacheado**: El Service Worker cacheaba `app.js` y no detectaba actualizaciones. **CORREGIDO en v11**: cache name `huevos-v11`, `cache: 'no-cache'` para dinámicos, `?v=11` en script tag.
- **v12: contabilidad mostraba NaN** — el `avgCostPerTray`/`invPeriod`/`totalSpent` usaban `p.pricePerTray` en compras que tienen `pricePerBox`. **CORREGIDO en v12** (app.js `avgCostPerTray`, `calcAccounting`).
- **v12: crash por quota de localStorage** — `localStorage.setItem` sin try/catch. **CORREGIDO en v12** (`saveData`, `pullRemote`, notas). Ahora muestra toast "Sin espacio".
- **v12: race condition en worker** — dos POSTs simultáneos podían perder datos (read-modify-write no atómico). **CORREGIDO en v12**: re-merge contra estado fresco en el write.
- **v12: rate limiter reseteaba todos los límites** — `hitLog.clear()` a las 5000 entradas. **CORREGIDO en v12**: evicta ~20% en vez de borrar todo.
- **v12: `pricePerTray` en sync merge podría sobreescribir `payments` locales con `[]`**. **CORREGIDO en v12**: conserva payments locales si el remoto no trae.
- **v12: semana excluía domingo** (`start.getDay() - 1`). **CORREGIDO en v12**: `(getDay() + 6) % 7`.
- **v12: crash si no había radio de markup seleccionado** (`null.value`). **CORREGIDO en v12**.
- **v12: aceptaba números negativos** en pedidos/compras. **CORREGIDO en v12** (valida `>= 1`).
- **v12: undo de toast se perdía** si llegaba otro toast. **CORREGIDO en v12** (stack de callbacks).
- **v13: rediseño UI** (no bug funcional) — pass de diseño gráfico. Tamaños de toque ≥44px (botones de tarjeta 40px inline para no saturar ancho, botones primarios/header/tabs 44px), contraste mejorado (`card-detail` stone-500 = 4.8:1, `card-amount` amber-700, badges blanco/red-600), token de diseño (escala espaciado `--space-*`, tipografía `--fs-*`, `--min-touch`, `--radius-sm`), header degradado 72px con `top:72px` sticky para tabs sin solapamiento, inputs 46px con focus ring. Verificado sin desbordamiento a 390px. Cache SW `huevos-v13`, `app.js?v=13`, `set-info v13`. Screens: `/tmp/shots/`.
- **v14: rediseño app móvil moderna** — header compacto 56px (título + pill de sync + botón menú hamburguesa ☰), drawer lateral derecho con acciones (Sincronizar ahora, Exportar CSV, Exportar JSON, Importar, Ajustes) + estado de sync, barra de navegación inferior fija (`#nav-menu.bottom-nav`) con 7 secciones icono+etiqueta y badge, FAB "＋" para nuevo pedido (scroll al form y foco en nombre), tabs `stone-500` inactivo/`amber-600` activo con indicador superior, `--min-touch:48px`. `updateSyncIcon` ya no usa `#sync-label` (eliminado) y actualiza `#drawer-sync`. Verificado: sin errores JS (console_err), sin desbordamiento a 390px en 5 tabs, drawer/FAB funcionales. Versiones `huevos-v14`, `app.js?v=14`, `set-info v14`. Screens: `/tmp/shots/`.
