# Proyecto Huevos - Contexto para AI Assistant

## Descripción
App PWA de gestión de pedidos de huevos. Vanilla HTML/CSS/JS, sin frameworks. Datos en localStorage + sync con Cloudflare Worker.

## Ruta del proyecto
`/media/datos/Felipe/Cosas/App/Huevos/`

## Archivos principales
- `app.js` — Lógica principal (~620 líneas)
- `index.html` — Estructura HTML (~135 líneas)
- `styles.css` — Estilos (~330 líneas)
- `sw.js` — Service Worker (cache v6)
- `manifest.json` — Manifest PWA
- `icons/` — Iconos de la app
- `worker/worker.js` — Código del worker de sync (merge seguro, v2)
- `worker/wrangler.toml` — Config del worker de sync (binding KV)

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
- **Tag base**: `v1.1.0-base`

## Funcionalidades
1. **Pedidos** — Crear, editar (✏️), eliminar, marcar como entregado
2. **Flujo de pago** — Al entregar: "¿El cliente pagó?" → Sí = pagados, No = deudores
3. **Deudores** — Lista con alerta >7 días sin pagar
4. **Pagados** — Historial ordenado de más reciente a más antiguo
5. **Compras** — Registro de cajas de huevos (1 caja = 6 bandejas), margen 30/35/40%
6. **Contabilidad** — Resumen de ventas, inversiones, ganancia neta
7. **Notas** — Textarea sincronizado entre dispositivos
8. **Sync** — Auto-sync con Cloudflare Worker cada 60s + al guardar
9. **Importar/Exportar** — Backup JSON
10. **PWA offline** — Service Worker con cache

## Estructura de datos (localStorage key: `huevos_data`)
```json
{
  "orders": [{ "id", "name", "trayCount", "pricePerTray", "total", "date", "status", "payment", "paid", "paidDate", "updatedAt", "deliveryDate?" }],
  "purchases": [{ "id", "boxCount", "pricePerBox", "markupPercent", "suggestedTrayPrice", "sellingPrice", "date" }],
  "notes": "string",
  "notesUpdatedAt": timestamp,
  "deleted": [{ "id", "type", "at" }]
}
```

## Notas importantes
- **NUNCA usar `write` tool** — falla silenciosamente. Usar siempre `bash` con heredoc `cat > file << 'EOF'`
- El `wrangler.toml` raíz es solo para Pages; el del worker está en `worker/wrangler.toml`
- Los datos del worker tienen 160 pedidos, 2 compras, notas
- El usuario tiene otra persona con la app en su celular (sync entre dispositivos)
- Los backups diarios se generan con `backup-huevos.sh`

## Historial de bugs
- `write` tool falla silenciosamente — archivos no se persisten. **NUNCA usar `write` tool**, usar `bash` con heredoc `cat > file << 'EOF'`
- Git repo se corrompió (apuntaba a `/tmp/huevos-git`) — se reinicializó
- `CLOUDFLARE_API_TOKEN` no está configurado en GitHub Secrets
- POST al worker sin data borra todos los datos (cuidado) — **CORREGIDO en worker v2** (merge seguro + rechazo de payload vacío)
- Archivos locales se sobrescribieron con versión antigua (app sin sync, 5 tabs) — se desplegó basura con `--commit-dirty=true` → **CORREGIDO**: `deploy.sh` ahora despliega desde `git archive HEAD` y aborta si el repo está sucio. Nunca usar `--commit-dirty=true` a mano.
