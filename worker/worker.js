// worker.js - Sync worker con merge seguro (v3)
// v2: no borra datos si llega un POST vacío; merge por id/updatedAt
// v3: snapshots diarios automáticos en KV (backup server-side) + endpoints /api/backup
import { mergeData } from "./merge.mjs";

const SNAPSHOT_KEEP = 14;

const RATE_LIMIT = 120;
const RATE_WINDOW = 60000;
const hitLog = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const arr = (hitLog.get(ip) || []).filter(t => now - t < RATE_WINDOW);
  arr.push(now);
  hitLog.set(ip, arr);
  if (hitLog.size > 5000) {
    // Evict ~20% of oldest entries instead of clearing everyone's limits
    const keys = [...hitLog.keys()];
    const toEvict = Math.floor(keys.length * 0.2);
    for (let i = 0; i < toEvict && i < keys.length; i++) hitLog.delete(keys[i]);
  }
  return arr.length > RATE_LIMIT;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

async function takeSnapshot(env, key, dataObj) {
  const snapKey = "snap:" + key + ":" + dayKey();
  try {
    const existing = await env.HUEVOS_KV.get(snapKey);
    if (existing) return false;
    await env.HUEVOS_KV.put(snapKey, JSON.stringify({ savedAt: new Date().toISOString(), data: dataObj }));
    try {
      const list = await env.HUEVOS_KV.list({ prefix: "snap:" + key + ":" });
      const names = list.keys.map(k => k.name).sort();
      while (names.length > SNAPSHOT_KEEP) {
        await env.HUEVOS_KV.delete(names.shift());
      }
    } catch (_) {}
    return true;
  } catch (_) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Sync-Key",
          "Access-Control-Max-Age": "86400"
        }
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    };

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (isRateLimited(ip)) {
      return new Response(JSON.stringify({ error: "Too many requests" }), { status: 429, headers: corsHeaders });
    }

    try {
      const syncKey = request.headers.get("X-Sync-Key");
      if (!syncKey) {
        return new Response(JSON.stringify({ error: "No key" }), { status: 401, headers: corsHeaders });
      }
      const key = "data:" + syncKey;

      if (request.method === "GET" && path === "/api/sync") {
        const stored = await env.HUEVOS_KV.get(key, { type: "json" });
        return new Response(JSON.stringify({ data: stored || { orders: [], purchases: [], notes: "", deleted: [] }, serverTime: Date.now() }), { headers: corsHeaders });
      }

      if ((request.method === "POST" || request.method === "PUT") && path === "/api/sync") {
        const body = await request.json();
        if (!body || !body.data) {
          return new Response(JSON.stringify({ error: "No data" }), { status: 400, headers: corsHeaders });
        }
        const incoming = body.data || {};

        // Rechazar payloads vacíos ANTES de hacer merge o gastar un snapshot
        const incomingHasData = (incoming.orders && incoming.orders.length) ||
          (incoming.purchases && incoming.purchases.length) ||
          (incoming.notes && incoming.notes.length) ||
          (incoming.deleted && incoming.deleted.length);

        // Leer el estado actual (base) para el merge
        const stored = await env.HUEVOS_KV.get(key, { type: "json" });
        const base = stored || { orders: [], purchases: [], notes: "", notesUpdatedAt: 0, deleted: [] };

        const baseHasData = (base.orders && base.orders.length) ||
          (base.purchases && base.purchases.length) ||
          base.notes;
        if (!incomingHasData && baseHasData) {
          return new Response(JSON.stringify({ error: "Empty payload rejected" }), { status: 400, headers: corsHeaders });
        }

        await takeSnapshot(env, key, base);

        // Write con retry para mitigar races: si el KV cambió entre la lectura
        // y la escritura, releemos y re-mergeamos contra el estado más fresco.
        let written = mergeData(base, incoming);
        for (let attempt = 0; attempt < 5; attempt++) {
          await env.HUEVOS_KV.put(key, JSON.stringify(written));
          const after = await env.HUEVOS_KV.get(key, { type: "json" });
          const afterStr = JSON.stringify(after || null);
          if (afterStr === JSON.stringify(written)) break;
          // Otro writer avanzó el estado; re-mergeamos contra el más fresco.
          written = mergeData(after, incoming);
        }

        return new Response(JSON.stringify({ ok: true, synced: new Date().toISOString() }), { headers: corsHeaders });
      }

      if (request.method === "GET" && path === "/api/backup") {
        const list = await env.HUEVOS_KV.list({ prefix: "snap:" + key + ":" });
        const names = list.keys.map(k => k.name).sort();
        const wanted = url.searchParams.get("date");
        if (wanted) {
          const snapKey = "snap:" + key + ":" + wanted;
          const snap = await env.HUEVOS_KV.get(snapKey, { type: "json" });
          if (!snap) {
            return new Response(JSON.stringify({ error: "No snapshot for date", available: names.map(n => n.split(":").pop()) }), { status: 404, headers: corsHeaders });
          }
          return new Response(JSON.stringify({ snapshot: wanted, data: snap.data !== undefined ? snap.data : snap }), { headers: corsHeaders });
        }
        if (!names.length) {
          return new Response(JSON.stringify({ error: "No snapshots yet", available: [] }), { status: 404, headers: corsHeaders });
        }
        const latestName = names[names.length - 1];
        const snap = await env.HUEVOS_KV.get(latestName, { type: "json" });
        return new Response(JSON.stringify({
          snapshot: latestName.split(":").pop(),
          data: snap.data !== undefined ? snap.data : snap,
          available: names.map(n => n.split(":").pop())
        }), { headers: corsHeaders });
      }

      if (request.method === "POST" && path === "/api/backup") {
        const stored = await env.HUEVOS_KV.get(key, { type: "json" });
        const base = stored || { orders: [], purchases: [], notes: "", notesUpdatedAt: 0, deleted: [] };
        const created = await takeSnapshot(env, key, base);
        return new Response(JSON.stringify({ ok: true, created: created, snapshot: dayKey() }), { headers: corsHeaders });
      }

      if (path === "/api/health") {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
    } catch (e) {
      console.error("Worker error:", e && e.message);
      return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: corsHeaders });
    }
  }
};