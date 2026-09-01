;(() => {
  const STORAGE_KEY = 'huevos_data'
  const SYNC_KEY = 'huevos-felipe'
  const SYNC_API = 'https://huevos-sync.felipe-v-r-89.workers.dev/api/sync'

  let data = loadData()
  let syncing = false
  let queuedWantPush = null
  let retryTimer = null
  let pushTimer = null
  let failStreak = 0
  let lastSyncOk = 0

  const SYNC_META_KEY = 'huevos_sync_meta'
  let syncMeta = loadSyncMeta()
  var lastUpload = syncMeta.lastUpload || 0
  var everUploaded = !!syncMeta.everUploaded
  var dirty = !!syncMeta.dirty
  var clockSkewDetected = !!syncMeta.clockSkewDetected

  function loadSyncMeta () {
    try { return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {} } catch (_) { return {} }
  }
  function saveSyncMeta () {
    try { localStorage.setItem(SYNC_META_KEY, JSON.stringify({ lastUpload: lastUpload, everUploaded: everUploaded, dirty: dirty, clockSkewDetected: clockSkewDetected, lastError: syncMeta.lastError, lastErrorAt: syncMeta.lastErrorAt })) } catch (_) {}
  }

  function loadData () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch (_) {}
    return { orders: [], purchases: [], notes: '', deleted: [] }
  }

  function saveData () {
    dirty = true
    saveSyncMeta()
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch (e) { showToast('Sin espacio — exporta y limpia datos'); return }
    renderAll()
    scheduleSync(true, 500)
  }

  function genId () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
  function today () { return new Date().toLocaleDateString('es-CL') }

  function parseAnyDate (s) {
    if (!s) return null
    var parts = String(s).split('-')
    if (parts.length !== 3) return null
    var a = parseInt(parts[0], 10); var b = parseInt(parts[1], 10); var c = parseInt(parts[2], 10)
    if (!a || !b || !c) return null
    if (parts[0].length === 4) return new Date(a, b - 1, c)
    return new Date(c, b - 1, a)
  }

  function daysSince (dateStr) {
    var d = parseAnyDate(dateStr)
    if (!d) return null
    var now = new Date()
    var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    var dateStart = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    return Math.floor((todayStart - dateStart) / (1000 * 60 * 60 * 24))
  }

  // ===== SYNC =====
  async function pullRemote () {
    const res = await fetch(SYNC_API, { headers: { 'X-Sync-Key': SYNC_KEY } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const json = await res.json()
    // Clock skew detection: compare local time with server time
    if (json.serverTime) {
      var skew = Math.abs(Date.now() - json.serverTime)
      if (skew > 300000) { // >5 minutes
        clockSkewDetected = true
        lastUpload = 0 // force full push on next pushLocal()
        saveSyncMeta()
      } else {
        clockSkewDetected = false
      }
    }
    const remote = json.data || {}
    const remoteDeleted = remote.deleted || []
    const deletedIds = new Set(remoteDeleted.map(d => d.id))
    const remoteOrders = (remote.orders || []).filter(o => !deletedIds.has(o.id))
    const remotePurchases = (remote.purchases || []).filter(p => !deletedIds.has(p.id))
    const remoteNotes = remote.notes || ''
    const remoteNotesUpdated = remote.notesUpdatedAt || 0

    var changed = false

    var byId = new Map()
    data.orders.forEach(o => byId.set(o.id, o))
    remoteOrders.forEach(ro => {
      const loc = byId.get(ro.id)
      if (!loc) { byId.set(ro.id, ro); changed = true }
      else if ((ro.updatedAt || 0) > (loc.updatedAt || 0)) {
        var locPayments = loc.payments
        Object.assign(loc, ro)
        if (locPayments && locPayments.length && (!ro.payments || !ro.payments.length)) loc.payments = locPayments
        changed = true
      }
    })
    var prevOrderCount = data.orders.length
    data.orders = Array.from(byId.values()).filter(o => !deletedIds.has(o.id))
    if (data.orders.length !== prevOrderCount) changed = true

    const purById = new Map()
    data.purchases.forEach(p => purById.set(p.id, p))
    remotePurchases.forEach(rp => {
      const loc = purById.get(rp.id)
      if (!loc) { purById.set(rp.id, rp); changed = true }
      else if ((rp.updatedAt || 0) > (loc.updatedAt || 0)) { Object.assign(loc, rp); changed = true }
    })
    var prevPurCount = data.purchases.length
    data.purchases = Array.from(purById.values()).filter(p => !deletedIds.has(p.id))
    if (data.purchases.length !== prevPurCount) changed = true

    if (remoteNotesUpdated > (data.notesUpdatedAt || 0)) {
      data.notes = remoteNotes
      data.notesUpdatedAt = remoteNotesUpdated
      changed = true
    }

    if (remote.settings && (remote.settingsUpdatedAt || 0) > ((data.settings && data.settingsUpdatedAt) || 0)) {
      data.settings = remote.settings
      data.settingsUpdatedAt = remote.settingsUpdatedAt
      changed = true
    }

    if (!data.deleted) data.deleted = []
    var delMap = new Map()
    data.deleted.forEach(function (d) { delMap.set(d.id, d) })
    remoteDeleted.forEach(function (d) {
      var cur = delMap.get(d.id)
      if (!cur || (d.at || 0) < cur.at) delMap.set(d.id, { id: d.id, at: d.at || 0 })
    })
    var mergedDeleted = Array.from(delMap.values())
    if (mergedDeleted.length !== data.deleted.length) { data.deleted = mergedDeleted; changed = true }

    normalizeOrders()
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch (e) { showToast('Sin espacio — exporta y limpia datos') }
    if (changed) renderAll()
    return true
  }

  async function pushLocal () {
    var deletedIds = new Set((data.deleted || []).map(function (d) { return d.id }))
    var allOrders = data.orders.filter(function (o) { return !deletedIds.has(o.id) })
    var allPurchases = data.purchases.filter(function (p) { return !deletedIds.has(p.id) })
    var allDeleted = data.deleted || []
    const payload = {
      data: {
        orders: allOrders,
        purchases: allPurchases,
        notes: data.notes !== undefined ? data.notes : '',
        notesUpdatedAt: data.notesUpdatedAt || 0,
        deleted: allDeleted,
        settings: data.settings || null,
        settingsUpdatedAt: data.settingsUpdatedAt || 0
      }
    }
    const res = await fetch(SYNC_API, {
      method: 'POST',
      headers: { 'X-Sync-Key': SYNC_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    lastUpload = Date.now()
    everUploaded = true
    saveSyncMeta()
    return true
  }

  async function doSync (wantPush) {
    if (syncing) {
      queuedWantPush = (queuedWantPush === true || wantPush === true)
      return
    }
    syncing = true
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null }
    updateSyncIcon('syncing')
    var okPull = true
    var okPush = true
    var lastErr = null
    try { await pullRemote() } catch (e) { okPull = false; lastErr = 'pull: ' + (e.message || e) }
    if (okPull && (wantPush === true || dirty)) {
      try {
        await pushLocal()
        dirty = false
        saveSyncMeta()
      } catch (e) { okPush = false; lastErr = 'push: ' + (e.message || e) }
    }
    syncing = false
    if (okPull && okPush) {
      failStreak = 0
      lastSyncOk = Date.now()
      syncMeta.lastError = null
      saveSyncMeta()
      updateSyncIcon('ok')
    } else {
      failStreak++
      syncMeta.lastError = lastErr
      syncMeta.lastErrorAt = Date.now()
      saveSyncMeta()
      updateSyncIcon('error')
      var delay = Math.min(30000 * Math.pow(2, failStreak - 1), 300000)
      retryTimer = setTimeout(function () { retryTimer = null; doSync(true) }, delay)
    }
    if (queuedWantPush !== null) {
      var q = queuedWantPush
      queuedWantPush = null
      doSync(q)
    }
  }

  function scheduleSync (wantPush, delay) {
    if (pushTimer) clearTimeout(pushTimer)
    pushTimer = setTimeout(function () { pushTimer = null; doSync(wantPush) }, delay || 400)
  }

  function updateSyncIcon (state) {
    const el = $('#sync-status')
    if (!el) return
    el.className = 'sync-status sync-' + state
    var t = ''
    if (lastSyncOk) {
      var d = new Date(lastSyncOk)
      t = d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0')
    }
    if (state === 'syncing') { el.textContent = '🔄'; }
    else if (state === 'ok') { el.textContent = '✅'; }
    else { el.textContent = '⚠️'; }
    el.title = state === 'syncing' ? 'Sincronizando...'
      : state === 'ok' ? 'Sincronizado — toca para sincronizar ahora'
      : 'Error: ' + (syncMeta.lastError || 'desconocido') + ' — se reintentará automáticamente'
    var dsync = $('#drawer-sync')
    if (dsync) {
      var txt = state === 'syncing' ? 'Sincronizando… 🔄'
        : state === 'ok' ? ('Sincronizado ✅ · ' + (dirty ? 'Pendiente' : (t || 'ahora')))
        : 'Sin señal ⚠️ · se reintentará automáticamente'
      dsync.textContent = txt
    }
  }

  function normalizeOrders () {
    data.orders.forEach(o => {
      if (o.paid) {
        if (o.status !== 'delivered') o.status = 'delivered'
        if (!o.paidDate) o.paidDate = o.date || today()
      }
      if (!o.status) {
        if (o.paid || o.payment === 'paid') {
          o.status = 'delivered'
          if (o.payment === 'paid') o.payment = 'cash'
        } else if (o.payment === 'debtor') {
          o.status = 'delivered'
        } else {
          o.status = 'pending'
        }
      }
      if (o.payment === 'paid') o.payment = 'cash'
      if (!o.total && o.trayCount && o.pricePerTray) {
        o.total = o.trayCount * o.pricePerTray
      }
    })
  }

  // ===== Orders =====
  function addOrder (name, trayCount, pricePerTray, deliveryDate, phone) {
    data.orders.push({
      id: genId(), name: name.trim(), trayCount, pricePerTray,
      total: trayCount * pricePerTray, date: today(),
      deliveryDate: deliveryDate || null,
      phone: (phone || '').trim() || null,
      status: 'pending', payment: null, paid: false, paidDate: null,
      updatedAt: Date.now()
    })
    saveData()
    showToast('Pedido de ' + name.trim() + ' guardado')
  }

  function editOrder (id, name, trayCount, pricePerTray, deliveryDate, phone) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.name = name.trim()
    order.trayCount = trayCount
    order.pricePerTray = pricePerTray
    order.total = trayCount * pricePerTray
    order.deliveryDate = deliveryDate || null
    if (phone !== undefined) order.phone = (phone || '').trim() || null
    order.updatedAt = Date.now()
    saveData()
    showToast('Pedido actualizado')
  }

  function deliverOrder (id, paid) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.status = 'delivered'
    order.payment = paid ? 'cash' : 'debtor'
    order.paid = paid
    order.paidDate = paid ? today() : null
    order.deliveredAt = order.deliveredAt || today()
    order.updatedAt = Date.now()
    saveData()
    showToast(paid ? 'Entregado y pagado ✅' : 'Entregado, queda como deudor 💰')
  }

  function markPaid (id) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.paid = true
    order.paidDate = today()
    order.updatedAt = Date.now()
    saveData()
    showToast('Pago registrado ✅')
  }

  function deleteOrder (id) {
    var order = data.orders.find(o => o.id === id)
    if (!order) return
    if (!data.deleted) data.deleted = []
    data.deleted.push({ id, type: 'order', at: Date.now() })
    data.orders = data.orders.filter(o => o.id !== id)
    saveData()
    showToast('Pedido de ' + order.name + ' eliminado', function () {
      data.deleted = data.deleted.filter(d => d.id !== id)
      data.orders.push(order)
      saveData()
    })
  }

  function showEditModal (id) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    const modal = $('#modal')
    modal.classList.add('modal-sheet')
    $('#modal-msg').innerHTML = ''
    const actions = $('#modal-actions')
    actions.innerHTML = '<div class="sheet-head">' +
      '<h3>Editar pedido</h3>' +
      '<button class="sheet-close" id="edit-close" aria-label="Cerrar">✕</button>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<label for="edit-name">Cliente</label>' +
      '<input type="text" id="edit-name" value="' + esc(order.name) + '" placeholder="Nombre del cliente">' +
      '<label for="edit-phone">Teléfono (opcional)</label>' +
      '<input type="tel" id="edit-phone" value="' + esc(order.phone || '') + '" placeholder="+56 9 ..." inputmode="tel">' +
      '<div class="sheet-row">' +
      '<div class="sheet-field"><label for="edit-trays">Bandejas</label>' +
      '<input type="number" id="edit-trays" value="' + order.trayCount + '" min="1" inputmode="numeric"></div>' +
      '<div class="sheet-field"><label for="edit-price">Precio ($)</label>' +
      '<input type="number" id="edit-price" value="' + order.pricePerTray + '" min="1" inputmode="numeric"></div>' +
      '</div>' +
      '<label for="edit-delivery">Fecha de entrega (opcional)</label>' +
      '<input type="date" id="edit-delivery" value="' + (order.deliveryDate || '') + '">' +
      '</div>' +
      '<div class="sheet-actions">' +
      '<button class="btn-primary" id="edit-save">Guardar</button>' +
      '<button class="btn-sm" id="edit-cancel">Cancelar</button>' +
      '</div>'
    modal.classList.remove('hidden')
    $('#edit-close').onclick = hideModal
    $('#edit-cancel').onclick = hideModal
    $('#edit-save').onclick = function () {
      var n = $('#edit-name').value.trim()
      var t = parseInt($('#edit-trays').value, 10)
      var p = parseInt($('#edit-price').value, 10)
      var dd = $('#edit-delivery').value
      var ph = $('#edit-phone') ? $('#edit-phone').value : undefined
      if (n && t >= 1 && p >= 1) { editOrder(id, n, t, p, dd, ph); hideModal() }
    }
  }

  // ===== Purchases =====
  function addPurchase (boxCount, pricePerBox, markupPercent, sellingPrice) {
    var trayCost = pricePerBox / 6
    var suggestedTrayPrice = Math.round(trayCost * (1 + markupPercent / 100))
    data.purchases.push({
      id: genId(), boxCount, pricePerBox, markupPercent,
      suggestedTrayPrice, sellingPrice: sellingPrice || suggestedTrayPrice, date: today(), updatedAt: Date.now()
    })
    saveData()
    showToast('Compra registrada 📦')
    return sellingPrice || suggestedTrayPrice
  }

  function deletePurchase (id) {
    var purchase = data.purchases.find(p => p.id === id)
    if (!purchase) return
    if (!data.deleted) data.deleted = []
    data.deleted.push({ id, type: 'purchase', at: Date.now() })
    data.purchases = data.purchases.filter(p => p.id !== id)
    saveData()
    showToast('Compra eliminada', function () {
      data.deleted = data.deleted.filter(d => d.id !== id)
      data.purchases.push(purchase)
      saveData()
    })
  }

  function paidAmountOf (o) {
    return (o.payments || []).reduce(function (s, p) { return s + (Number(p.amount) || 0) }, 0)
  }
  function saldoOf (o) {
    if (o.paid) return 0
    return Math.max(0, (Number(o.total) || 0) - paidAmountOf(o))
  }
  function addPayment (id, amount) {
    var o = data.orders.find(function (x) { return x.id === id })
    if (!o || !(amount > 0)) return
    if (!o.payments) o.payments = []
    o.payments.push({ amount: amount, date: today(), at: Date.now() })
    o.updatedAt = Date.now()
    if (saldoOf(o) <= 0) {
      o.paid = true
      o.paidDate = o.paidDate || today()
      showToast('Pago completado ✅')
    } else {
      showToast('Abono de $' + fmt(amount) + ' registrado · Saldo: $' + fmt(saldoOf(o)))
    }
    saveData()
  }
  function showPaymentModal (id) {
    var o = data.orders.find(function (x) { return x.id === id })
    if (!o) return
    var saldo = saldoOf(o)
    var modal = $('#modal')
    modal.classList.add('modal-sheet')
    $('#modal-msg').innerHTML = ''
    var actions = $('#modal-actions')
    actions.innerHTML = '<div class="sheet-head">' +
      '<h3>Abono de ' + esc(o.name) + '</h3>' +
      '<button class="sheet-close" id="pay-close" aria-label="Cerrar">✕</button>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<p class="pay-info">Total: <strong>$' + fmt(o.total) + '</strong>' +
      (paidAmountOf(o) > 0 ? ' · Ya abonado: <strong>$' + fmt(paidAmountOf(o)) + '</strong>' : '') +
      ' · Saldo: <strong>$' + fmt(saldo) + '</strong></p>' +
      '<label for="pay-amount">Monto recibido ($)</label>' +
      '<input type="number" id="pay-amount" value="' + saldo + '" min="1" inputmode="numeric">' +
      '</div>' +
      '<div class="sheet-actions">' +
      '<button class="btn-primary" id="pay-save">Registrar abono</button>' +
      '<button class="btn-sm" id="pay-cancel">Cancelar</button>' +
      '</div>'
    modal.classList.remove('hidden')
    $('#pay-close').onclick = hideModal
    $('#pay-cancel').onclick = hideModal
    $('#pay-save').onclick = function () {
      var amt = parseInt($('#pay-amount').value, 10)
      if (amt > 0) { addPayment(id, amt); hideModal() }
    }
  }

  function normPhone (p) {
    var d = String(p || '').replace(/\D/g, '')
    if (d.length === 9 && d.charAt(0) === '9') d = '56' + d
    return d.length >= 11 ? d : null
  }
  function phoneFor (name) {
    var n = String(name || '').trim().toLowerCase()
    var best = null
    var bt = -1
    data.orders.forEach(function (o) {
      if (String(o.name || '').trim().toLowerCase() === n && normPhone(o.phone)) {
        var t = o.updatedAt || 0
        if (t >= bt) { bt = t; best = normPhone(o.phone) }
      }
    })
    return best
  }
  function waHref (o) {
    var tel = phoneFor(o.name)
    if (!tel) return null
    var msg = 'Hola ' + o.name + ', te recuerdo el pago pendiente de $' + fmt(saldoOf(o)) + ' (' + o.trayCount + ' bandeja' + (o.trayCount !== 1 ? 's' : '') + ' de huevos). ¡Gracias!'
    return 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg)
  }
  function buildClientsDatalist () {
    var dl = $('#clientes-list')
    if (!dl) return
    var names = {}
    data.orders.forEach(function (o) {
      var n = String(o.name || '').trim()
      if (n) names[n] = true
    })
    dl.innerHTML = Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '">' }).join('')
  }

  function getSettings () {
    if (!data.settings) {
      data.settings = { businessName: '', stockAlertTrays: 10 }
    }
    return data.settings
  }
  function saveSettings (patch) {
    var s = getSettings()
    Object.keys(patch).forEach(function (k) { s[k] = patch[k] })
    data.settingsUpdatedAt = Date.now()
    saveData()
  }

  function showSettingsModal () {
    var s = getSettings()
    var modal = $('#modal')
    modal.classList.add('modal-sheet')
    $('#modal-msg').innerHTML = ''
    var actions = $('#modal-actions')
    actions.innerHTML = '<div class="sheet-head">' +
      '<h3>⚙️ Ajustes</h3>' +
      '<button class="sheet-close" id="set-close" aria-label="Cerrar">✕</button>' +
      '</div>' +
      '<div class="sheet-body">' +
      '<label for="set-name">Nombre del negocio (aparece en comprobantes)</label>' +
      '<input type="text" id="set-name" value="' + esc(s.businessName || '') + '" placeholder="Ej: Huevos Felipe" maxlength="40">' +
      '<label for="set-stock">Alertar cuando queden menos de (bandejas)</label>' +
      '<input type="number" id="set-stock" value="' + (s.stockAlertTrays || 10) + '" min="1" inputmode="numeric">' +
      '<div class="set-info">v15 · Los datos se sincronizan y tienen respaldo diario automático en la nube.</div>' +
      '</div>' +
      '<div class="sheet-actions">' +
      '<button class="btn-primary" id="set-save">Guardar</button>' +
      '<button class="btn-sm" id="set-backup">Respaldar ahora</button>' +
      '<button class="btn-sm" id="set-cancel">Cerrar</button>' +
      '</div>'
    modal.classList.remove('hidden')
    $('#set-close').onclick = hideModal
    $('#set-cancel').onclick = hideModal
    $('#set-save').onclick = function () {
      var name = $('#set-name').value.trim()
      var stock = parseInt($('#set-stock').value, 10) || 10
      saveSettings({ businessName: name, stockAlertTrays: stock })
      hideModal()
      showToast('Ajustes guardados ✅')
    }
    $('#set-backup').onclick = function () {
      var btn = $('#set-backup')
      btn.disabled = true
      btn.textContent = 'Respaldando…'
      fetch(SYNC_API.replace('/api/sync', '/api/backup'), {
        method: 'POST',
        headers: { 'X-Sync-Key': SYNC_KEY }
      }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status)
        showToast('Respaldo creado en la nube ☁️')
        btn.textContent = 'Respaldado ✓'
      }).catch(function () {
        showToast('No se pudo respaldar ⚠️')
        btn.disabled = false
        btn.textContent = 'Respaldar ahora'
      })
    }
  }

  function receiptText (o) {
    var s = getSettings()
    var lines = []
    if (s.businessName) lines.push('🧾 ' + s.businessName)
    lines.push('Cliente: ' + o.name)
    lines.push(o.trayCount + ' bandeja' + (o.trayCount !== 1 ? 's' : '') + ' x $' + fmt(o.pricePerTray))
    lines.push('Total: $' + fmt(o.total))
    lines.push('✅ Pagado: ' + (o.paidDate || o.date))
    lines.push('¡Gracias por su compra!')
    return lines.join('\n')
  }
  function openReceipt (o) {
    var url = 'https://wa.me/?text=' + encodeURIComponent(receiptText(o))
    window.open(url, '_blank')
  }

  function getClientStats () {
    var map = new Map()
    data.orders.forEach(function (o) {
      var key = String(o.name || '').trim().toLowerCase()
      if (!key) return
      var c = map.get(key)
      if (!c) {
        c = { name: String(o.name).trim(), phone: null, lastTs: 0, orders: 0, trays: 0, totalPaid: 0, debt: 0, lastDate: '' }
        map.set(key, c)
      }
      c.orders++
      c.trays += o.trayCount || 0
      var pd = parseAnyDate(o.date)
      var ts = pd ? pd.getTime() : 0
      if (ts >= c.lastTs) {
        c.lastTs = ts
        c.lastDate = o.date
        c.name = String(o.name).trim()
        if (normPhone(o.phone)) c.phone = normPhone(o.phone)
      }
      c.debt += saldoOf(o)
      if (o.paid) c.totalPaid += Number(o.total) || 0
    })
    return Array.from(map.values()).sort(function (a, b) { return b.lastTs - a.lastTs })
  }

  var searchTermClients = ''
  function renderClients () {
    var container = $('#lista-clientes')
    if (!container) return
    var list = getClientStats()
    if (searchTermClients) {
      list = list.filter(function (c) { return c.name.toLowerCase().indexOf(searchTermClients.toLowerCase()) !== -1 })
    }
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">' + (searchTermClients ? 'Sin resultados para "' + esc(searchTermClients) + '"' : 'Aún no hay clientes. Crea un pedido primero.') + '</div>'
      return
    }
    container.innerHTML = list.map(function (c) {
      var wa = c.phone ? 'https://wa.me/' + c.phone : null
      return '<div class="card client-card" data-name="' + esc(c.name) + '">' +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(c.name) + '</div>' +
        '<div class="card-detail">' + c.orders + ' pedido' + (c.orders !== 1 ? 's' : '') + ' · ' + c.trays + ' bandejas · Último: ' + c.lastDate + '</div>' +
        (c.debt > 0 ? '<span class="badge-overdue">Debe: $' + fmt(c.debt) + '</span>' : '') +
        '</div>' +
        '<div class="card-amount">$' + fmt(c.totalPaid) + '</div>' +
        '<div class="card-actions">' +
        (wa ? '<a class="btn-wa" href="' + wa + '" target="_blank" rel="noopener" title="WhatsApp">📱</a>' : '') +
        '</div></div>'
    }).join('')
  }

  function showClientDetail (name) {
    var key = String(name || '').trim().toLowerCase()
    var orders = data.orders.filter(function (o) {
      return String(o.name || '').trim().toLowerCase() === key
    }).sort(function (a, b) {
      var da = parseAnyDate(a.date) || 0
      var db = parseAnyDate(b.date) || 0
      return db - da
    })
    if (!orders.length) return
    var modal = $('#modal')
    modal.classList.add('modal-sheet')
    $('#modal-msg').innerHTML = ''
    var rows = orders.map(function (o) {
      var estado = o.status === 'delivered' ? (o.paid ? '✅' : '💰') : '⏳'
      return '<div class="hist-row"><span>' + estado + ' ' + esc(o.date) + '</span><span>' + o.trayCount + ' bj</span><strong>$' + fmt(o.total) + '</strong></div>'
    }).join('')
    $('#modal-actions').innerHTML = '<div class="sheet-head">' +
      '<h3>' + esc(orders[0].name) + '</h3>' +
      '<button class="sheet-close" id="cd-close" aria-label="Cerrar">✕</button>' +
      '</div>' +
      '<div class="sheet-body hist-list">' + rows + '</div>' +
      '<div class="sheet-actions"><button class="btn-primary" id="cd-ok">Cerrar</button></div>'
    modal.classList.remove('hidden')
    $('#cd-close').onclick = hideModal
    $('#cd-ok').onclick = hideModal
  }

  // ===== Queries =====
  var searchTerm = ''
  function getPending () {
    return data.orders.filter(o => o.status === 'pending' && (!searchTerm || o.name.toLowerCase().indexOf(searchTerm.toLowerCase()) !== -1))
  }
  function getAllPending () { return data.orders.filter(o => o.status === 'pending') }
  function getDebtors () { return data.orders.filter(o => o.payment === 'debtor' && !o.paid) }
  function getDelivered () { return data.orders.filter(o => o.status === 'delivered') }
  function getPaidOrders () { return getDelivered().filter(o => o.paid) }
  function getLastSuggestedPrice () {
    if (!data.purchases.length) return null
    var last = data.purchases[data.purchases.length - 1]
    return last.sellingPrice || last.suggestedTrayPrice
  }
  function dateInPeriod (dateStr, period) {
    if (period === 'all' || !dateStr) return true
    var d = parseAnyDate(dateStr)
    if (!d) return true
    var now = new Date()
    if (period === 'today') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
    }
    if (period === 'week') {
      var start = new Date(now)
      start.setHours(0, 0, 0, 0)
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
      var end = new Date(start)
      end.setDate(end.getDate() + 6)
      return d >= start && d <= end
    }
    if (period === 'month') {
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    }
    return true
  }

  // ===== Accounting =====
  function avgCostPerTray () {
    var trays = 0
    var spent = 0
    data.purchases.forEach(function (p) { trays += p.boxCount * 6; spent += p.boxCount * p.pricePerBox })
    return trays > 0 ? spent / trays : 0
  }
  function calcAccounting (period) {
    period = period || 'all'
    var paidOrders = getDelivered().filter(o => o.paid)
    var totalCash = paidOrders.filter(o => o.payment === 'cash')
      .filter(o => dateInPeriod(o.paidDate || o.date, period))
      .reduce(function (s, o) { return s + o.total }, 0)
    var abonos = 0
    data.orders.forEach(function (o) {
      ;(o.payments || []).forEach(function (p) {
        if (dateInPeriod(p.date, period)) abonos += Number(p.amount) || 0
      })
    })
    var legacyDebtorPaid = paidOrders.filter(o => o.payment === 'debtor' && !(o.payments && o.payments.length))
      .filter(o => dateInPeriod(o.paidDate || o.date, period))
      .reduce(function (s, o) { return s + o.total }, 0)
    var collections = abonos + legacyDebtorPaid
    var totalPendingDebt = data.orders.filter(o => o.payment === 'debtor' && !o.paid)
      .reduce(function (s, o) { return s + saldoOf(o) }, 0)
    var totalEarned = totalCash + collections

    var invPeriod = data.purchases.filter(function (p) { return dateInPeriod(p.date, period) })
      .reduce(function (s, p) { return s + p.boxCount * p.pricePerBox }, 0)
    var totalSpent = data.purchases.reduce(function (s, p) { return s + p.boxCount * p.pricePerBox }, 0)

    var deliveredInPeriod = getDelivered().filter(function (o) {
      return dateInPeriod(o.deliveredAt || o.paidDate || o.date, period)
    })
    var deliveredTraysPeriod = deliveredInPeriod.reduce(function (s, o) { return s + o.trayCount }, 0)
    var cogs = Math.round(deliveredTraysPeriod * avgCostPerTray())

    var profit = totalEarned - cogs
    var potentialProfit = profit + totalPendingDebt
    var totalBoxesBought = data.purchases.reduce(function (s, p) { return s + p.boxCount }, 0)
    var totalTraysBought = totalBoxesBought * 6
    var deliveredTrays = getDelivered().reduce(function (s, o) { return s + o.trayCount }, 0)
    var remainingTrays = Math.max(0, totalTraysBought - deliveredTrays)
    var overDelivered = deliveredTrays - totalTraysBought
    return { totalCash: totalCash, collections: collections, totalPendingDebt: totalPendingDebt,
      totalEarned: totalEarned, invPeriod: invPeriod, totalSpent: totalSpent, cogs: cogs,
      totalBoxesBought: totalBoxesBought, totalTraysBought: totalTraysBought,
      profit: profit, potentialProfit: potentialProfit, deliveredTrays: deliveredTrays,
      remainingTrays: remainingTrays, overDelivered: overDelivered, totalOrders: data.orders.length }
  }

  // ===== UI =====
  var $ = function (s) { return document.querySelector(s) }
  var $$ = function (s) { return document.querySelectorAll(s) }

  function renderAll () {
    renderPending()
    renderDebtors()
    renderPaid()
    renderPurchases()
    renderAccounting()
    renderNotes()
    renderBadges()
    renderClients()
    buildClientsDatalist()
  }

  function renderBadges () {
    var pend = $('#badge-pedidos')
    var debt = $('#badge-deudores')
    var pendingCount = getAllPending().length
    var debtorCount = getDebtors().length
    if (pend) { pend.textContent = pendingCount ? pendingCount : ''; pend.classList.toggle('badge-show', pendingCount > 0) }
    if (debt) { debt.textContent = debtorCount ? debtorCount : ''; debt.classList.toggle('badge-show', debtorCount > 0) }
  }

  function renderPending () {
    var container = $('#pedidos-pendientes')
    var list = getPending()
    if (!list.length) {
      container.innerHTML = searchTerm
        ? '<div class="empty-msg">No hay pedidos para "<strong>' + esc(searchTerm) + '</strong>"</div>'
        : '<div class="empty-msg">No hay pedidos pendientes</div>'
      return
    }
    container.innerHTML = list.map(function (o) {
      var deliveryLabel = ''
      if (o.deliveryDate) {
        var d = o.deliveryDate.split('-')
        deliveryLabel = d[2] + '/' + d[1] + '/' + d[0]
      }
      return '<div class="card" data-id="' + o.id + '">' +
        '<input type="checkbox" class="checkbox-lg chk-deliver" data-id="' + o.id + '">' +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(o.name) + '</div>' +
        '<div class="card-detail">' + o.trayCount + ' bandeja' + (o.trayCount !== 1 ? 's' : '') + ' x $' + fmt(o.pricePerTray) + ' · ' + o.date + '</div>' +
        (deliveryLabel ? '<span class="badge-delivery">Entrega: ' + deliveryLabel + '</span>' : '') +
        '</div>' +
        '<div class="card-amount">$' + fmt(o.total) + '</div>' +
        '<div class="card-actions">' +
        '<button class="btn-edit btn-edit-order" data-id="' + o.id + '" title="Editar">✏️</button>' +
        '<button class="btn-danger btn-del" data-id="' + o.id + '" title="Eliminar">✕</button>' +
        '</div></div>'
    }).join('')
  }

  function renderDebtors () {
    var container = $('#lista-deudores')
    var list = getDebtors()
    var oldDebtors = list.filter(function (o) {
      var d = daysSince(o.deliveredAt || o.date)
      return d !== null && d > 7
    })
    var html = ''
    if (oldDebtors.length > 0) {
      html += '<div class="alert-banner">' +
        '<div class="alert-banner-title">⚠️ Deudores con más de 7 días</div>' +
        '<ul class="alert-banner-list">' +
        oldDebtors.map(function (o) {
          return '<li>' + esc(o.name) + ' — $' + fmt(saldoOf(o)) + ' (' + daysSince(o.deliveredAt || o.date) + ' días)</li>'
        }).join('') +
        '</ul></div>'
    }
    if (!list.length) {
      html += '<div class="empty-msg">No hay deudores</div>'
      container.innerHTML = html
      return
    }
    html += list.map(function (o) {
      var days = daysSince(o.deliveredAt || o.date)
      var overdue = days !== null && days > 7
      var cls = overdue ? ' card-overdue' : ''
      var pagado = paidAmountOf(o)
      var wa = waHref(o)
      return '<div class="card dcard' + cls + '" data-id="' + o.id + '">' +
        '<div class="dc-row1">' +
        '<input type="checkbox" class="checkbox-lg chk-pay" data-id="' + o.id + '">' +
        '<div class="dc-main">' +
        '<div class="dc-name">' + esc(o.name) + '</div>' +
        '<div class="dc-detail">' + o.trayCount + ' bandeja' + (o.trayCount !== 1 ? 's' : '') + ' · ' + o.date + '</div>' +
        '</div>' +
        '<div class="dc-amt">$' + fmt(saldoOf(o)) + '</div>' +
        '</div>' +
        '<div class="dc-row2">' +
        (overdue ? '<span class="badge-overdue">' + days + ' días sin pagar</span>' : '') +
        (pagado > 0 ? '<span class="dc-paid">Abonado: $' + fmt(pagado) + '</span>' : '') +
        '<div class="card-actions">' +
        (wa ? '<a class="btn-wa" href="' + wa + '" target="_blank" rel="noopener" title="Recordar pago por WhatsApp">📱</a>' : '') +
        '<button class="btn-abono" data-id="' + o.id + '" title="Registrar abono">💵</button>' +
        '<button class="btn-edit btn-edit-order" data-id="' + o.id + '" title="Editar">✏️</button>' +
        '</div>' +
        '</div></div>'
    }).join('')
    container.innerHTML = html
  }

  function renderPaid () {
    var container = $('#lista-pagados')
    var period = $('#period-pagados') ? $('#period-pagados').value : 'all'
    var list = getPaidOrders().filter(function (o) {
      return dateInPeriod(o.paidDate || o.date, period)
    }).sort(function (a, b) {
      var da = parseAnyDate(a.paidDate || a.date)
      var db = parseAnyDate(b.paidDate || b.date)
      if (!da && !db) return 0
      if (!da) return 1
      if (!db) return -1
      return db - da
    })
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">No hay pagos registrados' + (period !== 'all' ? ' en este período' : '') + '</div>'
      return
    }
    container.innerHTML = list.map(function (o) {
      return '<div class="card" data-id="' + o.id + '">' +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(o.name) + '</div>' +
        '<div class="card-detail">' +
        o.trayCount + ' bandeja' + (o.trayCount !== 1 ? 's' : '') + ' · $' + fmt(o.total) +
        ' · ' + (o.paidDate || o.date) +
        '</div></div>' +
        '<div class="card-amount">$' + fmt(o.total) + '</div>' +
        '<div class="card-actions">' +
        '<button class="btn-receipt" data-id="' + o.id + '" title="Enviar comprobante por WhatsApp">🧾</button>' +
        '<button class="btn-edit btn-edit-order" data-id="' + o.id + '" title="Editar">✏️</button>' +
        '</div></div>'
    }).join('')
  }

  function renderPurchases () {
    var container = $('#lista-compras')
    if (!data.purchases.length) {
      container.innerHTML = '<div class="empty-msg">No hay compras registradas</div>'
      return
    }
    container.innerHTML = data.purchases.slice().reverse().map(function (p) {
      return '<div class="card purchase-card" data-id="' + p.id + '">' +
        '<div class="card-row">' +
        '<div><strong>' + p.boxCount + ' caja' + (p.boxCount !== 1 ? 's' : '') + '</strong> · $' + fmt(p.pricePerBox) + ' c/u</div>' +
        '<button class="btn-danger btn-del-purchase" data-id="' + p.id + '" title="Eliminar">✕</button>' +
        '</div>' +
        '<div class="card-row">' +
        '<span class="card-detail">Margen ' + p.markupPercent + '% · Sugerida: $' + fmt(p.suggestedTrayPrice) + ' · <strong>Mi precio: $' + fmt(p.sellingPrice) + '</strong></span>' +
        '<span class="card-detail">' + p.date + '</span>' +
        '</div></div>'
    }).join('')
  }

  function stockBannerHtml (a) {
    var threshold = getSettings().stockAlertTrays || 10
    if (a.remainingTrays > threshold) return ''
    var msg = a.remainingTrays <= 0
      ? '📦 Sin stock: entrega ' + a.deliveredTrays + ' de ' + a.totalTraysBought + ' bandejas compradas'
      : '📦 Stock bajo: quedan ' + a.remainingTrays + ' bandejas (alerta < ' + threshold + ')'
    return '<div class="alert-banner"><div class="alert-banner-title">' + msg + '</div></div>'
  }

  function renderAccounting () {
    var period = $('#period-contabilidad') ? $('#period-contabilidad').value : 'all'
    var a = calcAccounting(period)
    var periodLabel = period === 'today' ? ' hoy' : period === 'week' ? ' esta semana' : period === 'month' ? ' este mes' : ''
    $('#resumen-contabilidad').innerHTML =
      stockBannerHtml(a) +
      '<div class="acct-hero">' +
      '<div class="acct-hero-label">Ganancia neta' + periodLabel + '</div>' +
      '<div class="acct-hero-value">$' + fmt(a.profit) + '</div>' +
      '<div class="acct-hero-sub">Ganancia potencial (si cobras deudores): $' + fmt(a.potentialProfit) + '</div>' +
      '</div>' +
      '<div class="acct-group"><div class="acct-group-title">Ingresos</div>' +
      '<div class="acct-card"><span class="label">Ventas en efectivo</span><span class="value">$' + fmt(a.totalCash) + '</span></div>' +
      '<div class="acct-card"><span class="label">Abonos y cobranza</span><span class="value">$' + fmt(a.collections) + '</span></div>' +
      '<div class="acct-card' + (a.totalPendingDebt > 0 ? ' acct-loss' : '') + '"><span class="label">Por cobrar (saldos)</span><span class="value">$' + fmt(a.totalPendingDebt) + '</span></div>' +
      '<div class="acct-card"><span class="label">Total ganado (recibido)</span><span class="value">$' + fmt(a.totalEarned) + '</span></div>' +
      '</div>' +
      '<div class="acct-group"><div class="acct-group-title">Inversión y costos</div>' +
      '<div class="acct-card"><span class="label">Inversión del período</span><span class="value">$' + fmt(a.invPeriod) + '</span></div>' +
      '<div class="acct-card"><span class="label">Costo mercadería vendida</span><span class="value">$' + fmt(a.cogs) + '</span></div>' +
      '<div class="acct-card"><span class="label">Inversión histórica</span><span class="value">$' + fmt(a.totalSpent) + '</span></div>' +
      '</div>' +
      '<div class="acct-group"><div class="acct-group-title">Inventario</div>' +
      '<div class="acct-card"><span class="label">Cajas compradas</span><span class="value">' + a.totalBoxesBought + '</span></div>' +
      '<div class="acct-card"><span class="label">Bandejas compradas</span><span class="value">' + a.totalTraysBought + '</span></div>' +
      '<div class="acct-card"><span class="label">Bandejas entregadas</span><span class="value">' + a.deliveredTrays + '</span></div>' +
      '<div class="acct-card' + (a.overDelivered > 0 ? ' acct-loss' : '') + '"><span class="label">Bandejas restantes</span><span class="value">' + a.remainingTrays + (a.overDelivered > 0 ? ' (faltan ' + a.overDelivered + ')' : '') + '</span></div>' +
      '<div class="acct-card"><span class="label">Total pedidos</span><span class="value">' + a.totalOrders + '</span></div>' +
      '</div>'
  }

  function renderNotes () {
    var textarea = $('#notas-textarea')
    if (textarea && !textarea._listening) {
      textarea._listening = true
      textarea._lastLocalEdit = 0
      textarea.value = data.notes || ''
      var timer = null
      textarea.addEventListener('input', function () {
        data.notes = textarea.value
        data.notesUpdatedAt = Date.now()
        textarea._lastLocalEdit = Date.now()
        dirty = true
        saveSyncMeta()
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)) } catch (_) {}
        if (timer) clearTimeout(timer)
        timer = setTimeout(function () { doSync(true) }, 400)
      })
    } else if (textarea && document.activeElement !== textarea) {
      var notesUpdated = data.notesUpdatedAt || 0
      if (textarea._lastLocalEdit && textarea._lastLocalEdit > notesUpdated) return
      if (textarea.value !== (data.notes || '')) textarea.value = data.notes || ''
      textarea._lastNotesUpdated = notesUpdated
    }
  }

  // ===== Helpers =====
  function esc (s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML }
  function fmt (n) { return Number(n).toLocaleString('es-CL') }

  function switchTab (name) {
    var tab = document.querySelector('.tab[data-tab="' + name + '"]')
    var content = document.getElementById('tab-' + name)
    if (!tab || !content) return
    $$('.tab').forEach(function (t) { t.classList.remove('active') })
    $$('.tab-content').forEach(function (c) { c.classList.remove('active') })
    tab.classList.add('active')
    content.classList.add('active')
  }

  function showModal (msg, buttons) {
    var modal = $('#modal')
    $('#modal-msg').innerHTML = msg
    var actions = $('#modal-actions')
    actions.innerHTML = ''
    buttons.forEach(function (b) {
      var btn = document.createElement('button')
      btn.textContent = b.label
      btn.className = b.className || 'btn-primary'
      btn.onclick = function () { hideModal(); if (b.action) b.action() }
      actions.appendChild(btn)
    })
    modal.classList.remove('hidden')
  }
  function hideModal () { $('#modal').classList.add('hidden'); $('#modal').classList.remove('modal-sheet') }
  $('#modal').addEventListener('click', function (e) { if (e.target === e.currentTarget) hideModal() })

  var toastTimer = null
  var toastUndoStack = []
  function showToast (msg, undoFn) {
    var el = $('#toast')
    $('#toast-msg').textContent = msg
    if (undoFn) toastUndoStack.push(undoFn)
    $('#toast-undo').style.display = toastUndoStack.length ? '' : 'none'
    el.classList.remove('hidden')
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(hideToast, 5000)
  }
  function hideToast () {
    $('#toast').classList.add('hidden')
    toastUndoStack = []
  }
  $('#toast-undo').addEventListener('click', function () {
    if (toastUndoStack.length) {
      var fn = toastUndoStack.pop()
      hideToast()
      fn()
    } else {
      hideToast()
    }
  })

  // ===== Events =====
  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      $$('.tab').forEach(function (t) { t.classList.remove('active') })
      $$('.tab-content').forEach(function (c) { c.classList.remove('active') })
      tab.classList.add('active')
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active')
    })
  })

  $('#form-pedido').addEventListener('submit', function (e) {
    e.preventDefault()
    var name = $('#pedido-name').value.trim()
    var trays = parseInt($('#pedido-trays').value, 10)
    var price = parseInt($('#pedido-price').value, 10)
    var deliveryDate = $('#pedido-date').value || null
    var phone = ($('#pedido-phone') && $('#pedido-phone').value.trim()) || ''
    if (!name || !trays || !price || trays < 1 || price < 1) {
      showToast('Revisa los campos: nombre, bandejas y precio deben ser válidos ⚠️')
      return
    }
    addOrder(name, trays, price, deliveryDate, phone)
    $('#pedido-name').value = ''
    $('#pedido-trays').value = ''
    $('#pedido-date').value = ''
    if ($('#pedido-phone')) $('#pedido-phone').value = ''
    var suggested = getLastSuggestedPrice()
    $('#pedido-price').value = suggested || ''
    $('#pedido-name').focus()
  })

  function updatePriceSuggestion () {
    var suggested = getLastSuggestedPrice()
    if (suggested && !$('#pedido-price').value) {
      $('#pedido-price').value = suggested
    }
  }

  $('#buscar-pedido').addEventListener('input', function () {
    searchTerm = this.value.trim()
    renderPending()
  })

  $('#pedidos-pendientes').addEventListener('click', function (e) {
    if (e.target.classList.contains('chk-deliver')) {
      e.preventDefault()
      var id = e.target.dataset.id
      showModal('¿El cliente pagó?', [
        { label: '✅ Sí, pagó', className: 'btn-primary', action: function () { deliverOrder(id, true); switchTab('pagados') } },
        { label: '❌ No pagó', className: 'btn-sm', action: function () { deliverOrder(id, false); switchTab('deudores') } },
        { label: 'Cancelar', className: 'btn-sm', action: function () {} }
      ])
    }
    if (e.target.classList.contains('btn-edit-order')) {
      e.preventDefault()
      showEditModal(e.target.dataset.id)
    }
  })

  $('#lista-deudores').addEventListener('click', function (e) {
    if (e.target.classList.contains('chk-pay')) {
      e.preventDefault()
      var id = e.target.dataset.id
      showModal('¿El deudor pagó?', [
        { label: '✅ Sí, pagó', className: 'btn-primary', action: function () { markPaid(id); switchTab('pagados') } },
        { label: 'Cancelar', className: 'btn-sm', action: function () {} }
      ])
    }
    if (e.target.classList.contains('btn-abono')) {
      e.preventDefault()
      showPaymentModal(e.target.dataset.id)
    }
    if (e.target.classList.contains('btn-edit-order')) {
      e.preventDefault()
      showEditModal(e.target.dataset.id)
    }
  })

  $('#lista-pagados').addEventListener('click', function (e) {
    if (e.target.classList.contains('btn-receipt')) {
      e.preventDefault()
      var o = data.orders.find(function (x) { return x.id === e.target.dataset.id })
      if (o) openReceipt(o)
    }
    if (e.target.classList.contains('btn-edit-order')) {
      e.preventDefault()
      showEditModal(e.target.dataset.id)
    }
  })

  $('#lista-clientes').addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('a')) return
    var card = e.target.closest ? e.target.closest('.client-card') : null
    if (card && card.dataset.name) showClientDetail(card.dataset.name)
  })
  $('#buscar-cliente').addEventListener('input', function () {
    searchTermClients = this.value.trim()
    renderClients()
  })
  $('#btn-settings').addEventListener('click', showSettingsModal)

  var periodSelects = ['#period-pagados', '#period-contabilidad']
  periodSelects.forEach(function (sel) {
    var el = $(sel)
    if (el) el.addEventListener('change', function () { renderPaid(); renderAccounting() })
  })

  document.addEventListener('click', function (e) {
    if (e.target.classList.contains('btn-del')) {
      var id = e.target.dataset.id
      showModal('¿Eliminar este pedido?', [
        { label: 'Eliminar', className: 'btn-danger', action: function () { deleteOrder(id) } },
        { label: 'Cancelar', className: 'btn-sm', action: function () {} }
      ])
    }
    if (e.target.classList.contains('btn-del-purchase')) {
      var id2 = e.target.dataset.id
      showModal('¿Eliminar esta compra?', [
        { label: 'Eliminar', className: 'btn-danger', action: function () { deletePurchase(id2) } },
        { label: 'Cancelar', className: 'btn-sm', action: function () {} }
      ])
    }
  })

  function calcSuggestion () {
    var boxes = parseInt($('#compra-boxes').value, 10) || 0
    var price = parseInt($('#compra-price').value, 10) || 0
    var checked = document.querySelector('input[name="markup"]:checked')
    var markup = checked ? parseInt(checked.value, 10) : 30
    var suggested = boxes && price ? Math.round(price / 6 * (1 + markup / 100)) : 0
    $('#precio-sugerido').textContent = suggested ? '$' + fmt(suggested) : '$0'
  }
  $('#compra-boxes').addEventListener('input', calcSuggestion)
  $('#compra-price').addEventListener('input', calcSuggestion)
  $$('input[name="markup"]').forEach(function (r) { r.addEventListener('change', calcSuggestion) })

  $('#form-compra').addEventListener('submit', function (e) {
    e.preventDefault()
    var boxes = parseInt($('#compra-boxes').value, 10)
    var price = parseInt($('#compra-price').value, 10)
    var checkedEl = document.querySelector('input[name="markup"]:checked')
    var markup = checkedEl ? parseInt(checkedEl.value, 10) : 30
    var selling = parseInt($('#compra-selling').value, 10) || 0
    if (!boxes || !price || boxes < 1 || price < 1) {
      showToast('Revisa los campos: cajas y valor deben ser válidos ⚠️')
      return
    }
    addPurchase(boxes, price, markup, selling)
    $('#compra-boxes').value = ''
    $('#compra-price').value = ''
    $('#compra-selling').value = ''
    $('#precio-sugerido').textContent = '$0'
    updatePriceSuggestion()
  })

  function mergeByIdPreferNewer (localArr, incomingArr) {
    var m = new Map()
    ;(localArr || []).forEach(function (x) { m.set(x.id, x) })
    ;(incomingArr || []).forEach(function (x) {
      var cur = m.get(x.id)
      if (!cur || (x.updatedAt || 0) > (cur.updatedAt || 0)) m.set(x.id, x)
    })
    return Array.from(m.values())
  }

  $('#btn-export').addEventListener('click', function () {
    var exportData = { orders: data.orders, purchases: data.purchases, notes: data.notes || '', notesUpdatedAt: data.notesUpdatedAt || Date.now(), deleted: data.deleted || [], settings: data.settings || null, settingsUpdatedAt: data.settingsUpdatedAt || 0 }
    var json = JSON.stringify({ data: exportData }, null, 2)
    var blob = new Blob([json], { type: 'application/json' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = 'huevos-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.appendChild(a)
    a.click()
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url) }, 1000)
  })

  $('#btn-csv').addEventListener('click', function () {
    var rows = [['Fecha', 'Entrega', 'Cliente', 'Telefono', 'Bandejas', 'Precio', 'Total', 'Estado', 'Fecha pago', 'Abonado', 'Saldo']]
    data.orders.slice().sort(function (a, b) {
      var da = parseAnyDate(a.date) || 0
      var db = parseAnyDate(b.date) || 0
      return db - da
    }).forEach(function (o) {
      rows.push([o.date, o.deliveryDate || '', o.name, o.phone || '', o.trayCount,
        o.pricePerTray, o.total,
        o.status === 'delivered' ? (o.paid ? 'pagado' : 'entregado (deuda)') : 'pendiente',
        o.paidDate || '', paidAmountOf(o), saldoOf(o)])
    })
    var csv = '\ufeff' + rows.map(function (r) {
      return r.map(function (c) {
        c = String(c == null ? '' : c)
        return /[;"\r\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c
      }).join(';')
    }).join('\r\n')
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = 'huevos-ventas-' + new Date().toISOString().slice(0, 10) + '.csv'
    document.body.appendChild(a)
    a.click()
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url) }, 1000)
  })

  $('#btn-import').addEventListener('click', function () { $('#import-file').click() })
  $('#import-file').addEventListener('change', function (e) {
    var file = e.target.files[0]
    if (!file) return
    var reader = new FileReader()
    reader.onload = function (ev) {
      try {
        var imported = JSON.parse(ev.target.result)
        var importedData = imported.data || imported
        var orders = importedData.orders || []
        var purchases = importedData.purchases || []
        if (!orders.length && !purchases.length) { alert('El archivo no contiene datos válidos'); return }
        data.orders = mergeByIdPreferNewer(data.orders, orders)
        data.purchases = mergeByIdPreferNewer(data.purchases, purchases)
        var delMap = new Map()
        ;(data.deleted || []).forEach(function (d) { delMap.set(d.id, d) })
        ;(importedData.deleted || []).forEach(function (d) {
          var cur = delMap.get(d.id)
          if (!cur || (d.at || 0) < (cur.at || 0)) delMap.set(d.id, { id: d.id, at: d.at || 0 })
        })
        data.deleted = Array.from(delMap.values())
        var deletedIds = new Set(data.deleted.map(function (d) { return d.id }))
        data.orders = data.orders.filter(function (o) { return !deletedIds.has(o.id) })
        data.purchases = data.purchases.filter(function (p) { return !deletedIds.has(p.id) })
        if ((importedData.notesUpdatedAt || 0) > (data.notesUpdatedAt || 0)) {
          data.notes = importedData.notes || ''
          data.notesUpdatedAt = importedData.notesUpdatedAt
        }
        if (importedData.settings && (importedData.settingsUpdatedAt || 0) > ((data.settings && data.settingsUpdatedAt) || 0)) {
          data.settings = importedData.settings
          data.settingsUpdatedAt = importedData.settingsUpdatedAt
        }
        normalizeOrders()
        saveData()
        alert('Importados: ' + data.orders.length + ' pedidos, ' + data.purchases.length + ' compras')
      } catch (err) { alert('Error al leer: ' + err.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
  })

  // ===== Init =====
  normalizeOrders()
  updatePriceSuggestion()
  renderAll()
  var hdrDate = $('#header-date')
  if (hdrDate) hdrDate.textContent = new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })
  doSync(true)
  setInterval(function () { doSync(true) }, 60000)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) doSync(true)
  })
  window.addEventListener('online', function () { doSync(true) })
  var syncBtn = $('#sync-status')
  if (syncBtn) {
    syncBtn.addEventListener('click', function () {
      if (syncing) return
      doSync(true)
    })
  }

  // ===== Menú lateral (drawer) y FAB =====
  var drawer = $('#drawer')
  var overlay = $('#menu-overlay')
  var menuBtn = $('#btn-menu')

  function closeMenu () {
    if (!drawer) return
    drawer.setAttribute('aria-hidden', 'true')
    if (overlay) overlay.classList.add('hidden')
    if (menuBtn) { menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.textContent = '☰' }
  }
  function openMenu () {
    if (!drawer) return
    drawer.setAttribute('aria-hidden', 'false')
    if (overlay) overlay.classList.remove('hidden')
    if (menuBtn) { menuBtn.setAttribute('aria-expanded', 'true'); menuBtn.textContent = '✕' }
  }
  function toggleMenu () {
    if (drawer && drawer.getAttribute('aria-hidden') === 'false') closeMenu()
    else openMenu()
  }

  if (menuBtn) menuBtn.addEventListener('click', toggleMenu)
  if (overlay) overlay.addEventListener('click', closeMenu)

  var menuSync = $('#menu-sync')
  if (menuSync) menuSync.addEventListener('click', function () {
    if (!syncing) doSync(true)
    closeMenu()
    showToast('Sincronizando datos… 🔄')
  })

  // Cerrar el menú al usar cualquiera de sus acciones
  ;['#btn-csv', '#btn-export', '#btn-import', '#btn-settings'].forEach(function (sel) {
    var el = $(sel)
    if (el) el.addEventListener('click', closeMenu)
  })

  // FAB → nuevo pedido
  var fab = $('#fab')
  if (fab) {
    fab.addEventListener('click', function () {
      switchTab('pedidos')
      var form = $('#form-pedido')
      if (form) {
        setTimeout(function () {
          form.scrollIntoView({ behavior: 'smooth', block: 'center' })
          var nameInput = $('#pedido-name')
          if (nameInput) nameInput.focus()
        }, 80)
      }
    })
  }

  // Cerrar el menú si se abre hace clic en un tab
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('.tab')) closeMenu()
  })

  // ===== Service Worker auto-update =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(function (reg) {
      function checkUpdate () {
        if (reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' })
          return
        }
        reg.update()
      }
      reg.addEventListener('updatefound', function () {
        var newSw = reg.installing
        if (newSw) {
          newSw.addEventListener('statechange', function () {
            if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
              checkUpdate()
            }
          })
        }
      })
      checkUpdate()
      setInterval(checkUpdate, 30000)
    })
    var refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!refreshing) { refreshing = true; window.location.reload() }
    })
  }
})()
