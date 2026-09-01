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
- **Tag base**: `v11.0.0`

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
- **SW v11**: `cache: 'no-cache'` para archivos dinámicos, `huevos-v11` cache name
- **app.js** se carga con `?v=11` query string para bustear cache del navegador

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
