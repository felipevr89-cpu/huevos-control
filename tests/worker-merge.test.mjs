// tests/worker-merge.test.mjs
// Tests unitarios del merge del worker (worker/merge.js).
// Uso: node tests/worker-merge.test.mjs
import assert from "node:assert";
import { mergeData } from "../worker/merge.mjs";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.error("  ✗ " + name + "\n      " + e.message);
  }
}

console.log("Worker merge tests");

const base = {
  orders: [
    { id: "a", name: "A", updatedAt: 100 },
    { id: "b", name: "B", updatedAt: 100 }
  ],
  purchases: [
    { id: "p1", boxCount: 2, updatedAt: 100 }
  ],
  notes: "notas base",
  notesUpdatedAt: 100,
  deleted: []
};

test("añade pedidos nuevos del incoming", () => {
  const r = mergeData(base, { orders: [{ id: "c", name: "C", updatedAt: 200 }] });
  assert.strictEqual(r.orders.length, 3);
  assert.ok(r.orders.some(o => o.id === "c"));
});

test("no borra pedidos del base si el incoming no los trae", () => {
  const r = mergeData(base, { orders: [{ id: "c", name: "C", updatedAt: 200 }] });
  assert.ok(r.orders.some(o => o.id === "a"));
  assert.ok(r.orders.some(o => o.id === "b"));
});

test("el pedido con updatedAt más reciente gana", () => {
  const r = mergeData(base, { orders: [{ id: "a", name: "A-editado", updatedAt: 300 }] });
  const a = r.orders.find(o => o.id === "a");
  assert.strictEqual(a.name, "A-editado");
});

test("el pedido más antiguo no pisa al más nuevo", () => {
  const r = mergeData(base, { orders: [{ id: "a", name: "A-viejo", updatedAt: 50 }] });
  const a = r.orders.find(o => o.id === "a");
  assert.strictEqual(a.name, "A");
});

test("un pedido borrado en incoming se elimina", () => {
  const r = mergeData(base, { orders: [], deleted: [{ id: "b", at: 200 }] });
  assert.ok(!r.orders.some(o => o.id === "b"));
});

test("un pedido borrado en base no reaparece con el incoming", () => {
  const r = mergeData({ ...base, deleted: [{ id: "b", at: 200 }] }, { orders: [{ id: "b", name: "B", updatedAt: 300 }] });
  assert.ok(!r.orders.some(o => o.id === "b"));
});

test("las compras nuevas se agregan", () => {
  const r = mergeData(base, { purchases: [{ id: "p2", boxCount: 3, updatedAt: 200 }] });
  assert.strictEqual(r.purchases.length, 2);
});

test("una compra borrada no reaparece", () => {
  const r = mergeData(base, { purchases: [{ id: "p1", boxCount: 9, updatedAt: 300 }], deleted: [{ id: "p1", at: 200 }] });
  assert.ok(!r.purchases.some(p => p.id === "p1"));
});

test("las notas se actualizan si el timestamp es más reciente", () => {
  const r = mergeData(base, { notes: "nuevas", notesUpdatedAt: 200 });
  assert.strictEqual(r.notes, "nuevas");
});

test("las notas no se pisan con timestamp antiguo", () => {
  const r = mergeData(base, { notes: "viejas", notesUpdatedAt: 50 });
  assert.strictEqual(r.notes, "notas base");
});

test("las notas vacías (borrado) se propagan si el timestamp es más reciente", () => {
  const r = mergeData(base, { notes: "", notesUpdatedAt: 200 });
  assert.strictEqual(r.notes, "");
  assert.strictEqual(r.notesUpdatedAt, 200);
});

test("un POST vacío no borra nada del base", () => {
  const r = mergeData(base, { orders: [], purchases: [], notes: "", deleted: [] });
  assert.strictEqual(r.orders.length, 2);
  assert.strictEqual(r.purchases.length, 1);
});

test("los deleted conservan la fecha original más antigua", () => {
  const now = Date.now();
  const r = mergeData(
    { ...base, deleted: [{ id: "x", at: now - 1000 }] },
    { deleted: [{ id: "x", at: now - 500 }] }
  );
  const d = r.deleted.find(d => d.id === "x");
  assert.strictEqual(d.at, now - 1000);
});

test("los deleted de más de 90 días se compactan", () => {
  const r = mergeData(
    { ...base, deleted: [{ id: "x", at: Date.now() - 100 * 24 * 60 * 60 * 1000 }] },
    { deleted: [{ id: "y", at: Date.now() }] }
  );
  assert.ok(!r.deleted.some(d => d.id === "x"));
  assert.ok(r.deleted.some(d => d.id === "y"));
});

test("los settings del incoming ganan si son más recientes", () => {
  const r = mergeData(base, { settings: { businessName: "Mi Huevería" }, settingsUpdatedAt: 500 });
  assert.strictEqual(r.settings.businessName, "Mi Huevería");
  assert.strictEqual(r.settingsUpdatedAt, 500);
});

test("los settings del base se conservan si el incoming no trae", () => {
  const b = { ...base, settings: { businessName: "Base" }, settingsUpdatedAt: 900 };
  const r = mergeData(b, { orders: [] });
  assert.strictEqual(r.settings.businessName, "Base");
  assert.strictEqual(r.settingsUpdatedAt, 900);
});

test("los settings antiguos del incoming no pisan los nuevos del base", () => {
  const b = { ...base, settings: { businessName: "Nuevo" }, settingsUpdatedAt: 900 };
  const r = mergeData(b, { settings: { businessName: "Viejo" }, settingsUpdatedAt: 100 });
  assert.strictEqual(r.settings.businessName, "Nuevo");
});

test("sin settings en ninguna parte, el merge no explota", () => {
  const r = mergeData(base, {});
  assert.ok(r.orders.length >= 0);
});

// === Tests para bug de "resurrection" de pedidos borrados ===

test("un pedido borrado en base NO reaparece aunque incoming lo traiga con updatedAt mayor", () => {
  const b = {
    orders: [{ id: "z", name: "Z", updatedAt: 100 }],
    purchases: [],
    deleted: [{ id: "z", at: 200 }]
  };
  const r = mergeData(b, { orders: [{ id: "z", name: "Z-mod", updatedAt: 500 }] });
  assert.ok(!r.orders.some(o => o.id === "z"), "pedido borrado no debe reaparecer");
});

test("una compra borrada en base NO reaparece aunque incoming lo traiga con updatedAt mayor", () => {
  const b = {
    orders: [],
    purchases: [{ id: "px", boxCount: 5, updatedAt: 100 }],
    deleted: [{ id: "px", at: 200 }]
  };
  const r = mergeData(b, { purchases: [{ id: "px", boxCount: 10, updatedAt: 500 }] });
  assert.ok(!r.purchases.some(p => p.id === "px"), "compra borrada no debe reaparecer");
});

test("borrado en incoming se propaga al resultado deleted", () => {
  const now = Date.now();
  const b = { orders: [{ id: "a", name: "A", updatedAt: 100 }], purchases: [], notes: "", notesUpdatedAt: 0 };
  const r = mergeData(b, { deleted: [{ id: "a", at: now }] });
  assert.ok(r.deleted.some(d => d.id === "a"));
  assert.ok(!r.orders.some(o => o.id === "a"));
});

test("un pedido nuevo en incoming que está en deleted del base no se agrega", () => {
  const b = {
    orders: [],
    purchases: [],
    deleted: [{ id: "new", at: 100 }]
  };
  const r = mergeData(b, { orders: [{ id: "new", name: "New", updatedAt: 200 }] });
  assert.ok(!r.orders.some(o => o.id === "new"));
});

test("un pedido en base que NO está deleted se conserva aunque incoming no lo traiga", () => {
  const b = {
    orders: [{ id: "keep", name: "Keep", updatedAt: 100 }],
    purchases: [],
    deleted: []
  };
  const r = mergeData(b, { orders: [] });
  assert.ok(r.orders.some(o => o.id === "keep"));
});

console.log("\nResultado: " + passed + " pasados, " + failed + " fallados");
process.exit(failed ? 1 : 0);