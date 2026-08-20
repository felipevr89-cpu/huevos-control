// merge.js - Lógica de merge segura para el sync worker (v2)
// Extraída a módulo para poder testearla de forma unitaria.

export function mergeData(base, incoming) {
  const deletedIds = new Set((incoming.deleted || []).map(d => d.id));
  const baseDeletedIds = new Set((base.deleted || []).map(d => d.id));
  const allDeleted = new Set([...deletedIds, ...baseDeletedIds]);

  const orderMap = new Map();
  (base.orders || []).forEach(o => orderMap.set(o.id, o));
  (incoming.orders || []).forEach(o => {
    if (allDeleted.has(o.id)) return;
    const existing = orderMap.get(o.id);
    if (!existing || (o.updatedAt || 0) >= (existing.updatedAt || 0)) {
      orderMap.set(o.id, o);
    }
  });
  const orders = [...orderMap.values()].filter(o => !allDeleted.has(o.id));

  const purchaseMap = new Map();
  (base.purchases || []).forEach(p => purchaseMap.set(p.id, p));
  (incoming.purchases || []).forEach(p => {
    if (allDeleted.has(p.id)) return;
    const existing = purchaseMap.get(p.id);
    if (!existing || (p.updatedAt || 0) >= (existing.updatedAt || 0)) {
      purchaseMap.set(p.id, p);
    }
  });
  const purchases = [...purchaseMap.values()].filter(p => !allDeleted.has(p.id));

  let notes = base.notes || "";
  let notesUpdatedAt = base.notesUpdatedAt || 0;
  const incNotes = incoming.notes;
  const incNotesUpdated = incoming.notesUpdatedAt || 0;
  if (incNotes !== undefined && incNotes !== null && incNotesUpdated >= notesUpdatedAt) {
    notes = incNotes || "";
    notesUpdatedAt = incNotesUpdated;
  }

  // Unión de ids borrados, conservando la fecha original más antigua por id
  const deletedMap = new Map();
  (base.deleted || []).forEach(d => {
    const cur = deletedMap.get(d.id);
    if (!cur || (d.at || 0) < cur.at) deletedMap.set(d.id, { id: d.id, at: d.at || 0 });
  });
  (incoming.deleted || []).forEach(d => {
    const cur = deletedMap.get(d.id);
    if (!cur || (d.at || 0) < cur.at) deletedMap.set(d.id, { id: d.id, at: d.at || 0 });
  });

  // Compactación: purgar borrados de más de 90 días (los ids ya no existen
  // en base ni en incoming; un dispositivo con >90 días sin sync es improbable
  // y está cubierto por los backups diarios).
  const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const compactedDeleted = [];
  deletedMap.forEach(d => {
    if ((d.at || 0) >= cutoff) compactedDeleted.push(d);
  });

  return { orders, purchases, notes, notesUpdatedAt, deleted: compactedDeleted };
}