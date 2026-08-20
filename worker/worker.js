// worker.js - Sync worker con merge seguro (v2)
// Fix 1: no borra datos si llega un POST con data vacía
// Fix 2: hace merge por id/updatedAt en vez de sobrescribir
import { mergeData } from "./merge.mjs";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, X-Sync-Key"
        }
      });
    }

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": "application/json"
    };

    try {
      const syncKey = request.headers.get("X-Sync-Key");
      if (!syncKey) {
        return new Response(JSON.stringify({ error: "No key" }), { status: 401, headers: corsHeaders });
      }
      const key = "data:" + syncKey;

      if (request.method === "GET" && path === "/api/sync") {
        const stored = await env.HUEVOS_KV.get(key, { type: "json" });
        return new Response(JSON.stringify({ data: stored || { orders: [], purchases: [], notes: "", deleted: [] } }), { headers: corsHeaders });
      }

      if ((request.method === "POST" || request.method === "PUT") && path === "/api/sync") {
        const body = await request.json();
        if (!body || !body.data) {
          return new Response(JSON.stringify({ error: "No data" }), { status: 400, headers: corsHeaders });
        }
        const incoming = body.data || {};

        const stored = await env.HUEVOS_KV.get(key, { type: "json" });
        const base = stored || { orders: [], purchases: [], notes: "", notesUpdatedAt: 0, deleted: [] };

        const merged = mergeData(base, incoming);

        const incomingHasData = (incoming.orders && incoming.orders.length) ||
          (incoming.purchases && incoming.purchases.length) ||
          (incoming.notes && incoming.notes.length) ||
          (incoming.deleted && incoming.deleted.length);
        const baseHasData = (base.orders && base.orders.length) ||
          (base.purchases && base.purchases.length) ||
          base.notes;
        if (!incomingHasData && baseHasData) {
          return new Response(JSON.stringify({ error: "Empty payload rejected" }), { status: 400, headers: corsHeaders });
        }

        await env.HUEVOS_KV.put(key, JSON.stringify(merged));
        return new Response(JSON.stringify({ ok: true, synced: new Date().toISOString() }), { headers: corsHeaders });
      }

      if (path === "/api/health") {
        return new Response(JSON.stringify({ ok: true }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
  }
};