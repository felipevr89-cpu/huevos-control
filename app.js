;(() => {
  const STORAGE_KEY = 'huevos_data'
  const SYNC_KEY = 'huevos-felipe'
  const SYNC_API = 'https://huevos-sync.felipe-v-r-89.workers.dev/api/sync'

  let data = loadData()
  let lastSync = 0
  let syncing = false

  function loadData () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch (_) {}
    return { orders: [], purchases: [], notes: '', deleted: [] }
  }

  function saveData () {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    syncToWorker()
    renderAll()
  }

  function genId () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
  function today () { return new Date().toLocaleDateString('es-CL') }

  function daysSince (dateStr) {
    if (!dateStr) return 999
    const parts = dateStr.split('-')
    if (parts.length !== 3) return 999
    const d = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]))
    return Math.floor((new Date() - d) / (1000 * 60 * 60 * 24))
  }

  // ===== SYNC =====
  async function syncFromWorker () {
    if (syncing) return
    syncing = true
    updateSyncIcon('syncing')
    try {
      const res = await fetch(SYNC_API, { headers: { 'X-Sync-Key': SYNC_KEY } })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const json = await res.json()
      const remote = json.data || {}
      const deletedIds = new Set((remote.deleted || []).map(d => d.id))
      const remoteOrders = (remote.orders || []).filter(o => !deletedIds.has(o.id))
      const remotePurchases = remote.purchases || []
      const remoteNotes = remote.notes || ''
      const remoteNotesUpdated = remote.notesUpdatedAt || 0

      const localIds = new Set(data.orders.map(o => o.id))
      remoteOrders.forEach(ro => {
        if (!localIds.has(ro.id)) {
          data.orders.push(ro)
        } else {
          const local = data.orders.find(o => o.id === ro.id)
          if (local && (ro.updatedAt || 0) > (local.updatedAt || 0)) {
            Object.assign(local, ro)
          }
        }
      })
      const localPurIds = new Set(data.purchases.map(p => p.id))
      remotePurchases.forEach(rp => {
        if (!localPurIds.has(rp.id)) data.purchases.push(rp)
      })
      data.orders = data.orders.filter(o => !deletedIds.has(o.id))

      if (remoteNotes && (!data.notes || remoteNotesUpdated > (data.notesUpdatedAt || 0))) {
        data.notes = remoteNotes
        data.notesUpdatedAt = remoteNotesUpdated
      }

      if (!data.deleted) data.deleted = []
      normalizeOrders()
      lastSync = Date.now()
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      updateSyncIcon('ok')
    } catch (e) {
      updateSyncIcon('error')
    }
    syncing = false
  }

  async function syncToWorker () {
    if (syncing) return
    syncing = true
    updateSyncIcon('syncing')
    try {
      const payload = {
        data: {
          orders: data.orders,
          purchases: data.purchases,
          notes: data.notes || '',
          notesUpdatedAt: data.notesUpdatedAt || Date.now(),
          deleted: data.deleted || []
        }
      }
      const res = await fetch(SYNC_API, {
        method: 'POST',
        headers: { 'X-Sync-Key': SYNC_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      lastSync = Date.now()
      updateSyncIcon('ok')
    } catch (e) {
      updateSyncIcon('error')
    }
    syncing = false
  }

  function updateSyncIcon (state) {
    const el = $('#sync-status')
    if (!el) return
    el.className = 'sync-status sync-' + state
    if (state === 'syncing') el.textContent = '🔄'
    else if (state === 'ok') el.textContent = '✅'
    else el.textContent = '⚠️'
  }

  function normalizeOrders () {
    data.orders.forEach(o => {
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
  function addOrder (name, trayCount, pricePerTray, deliveryDate) {
    data.orders.push({
      id: genId(), name: name.trim(), trayCount, pricePerTray,
      total: trayCount * pricePerTray, date: today(),
      deliveryDate: deliveryDate || null,
      status: 'pending', payment: null, paid: false, paidDate: null,
      updatedAt: Date.now()
    })
    saveData()
  }

  function editOrder (id, name, trayCount, pricePerTray, deliveryDate) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.name = name.trim()
    order.trayCount = trayCount
    order.pricePerTray = pricePerTray
    order.total = trayCount * pricePerTray
    order.deliveryDate = deliveryDate || null
    order.updatedAt = Date.now()
    saveData()
  }

  function deliverOrder (id, paid) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.status = 'delivered'
    order.payment = paid ? 'cash' : 'debtor'
    order.paid = paid
    order.paidDate = paid ? today() : null
    order.updatedAt = Date.now()
    saveData()
  }

  function markPaid (id) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.paid = true
    order.paidDate = today()
    order.updatedAt = Date.now()
    saveData()
  }

  function deleteOrder (id) {
    if (!data.deleted) data.deleted = []
    data.deleted.push({ id, type: 'order', at: Date.now() })
    data.orders = data.orders.filter(o => o.id !== id)
    saveData()
  }

  function showEditModal (id) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    const modal = $('#modal')
    $('#modal-msg').innerHTML = 'Editar pedido de <strong>' + esc(order.name) + '</strong>'
    const actions = $('#modal-actions')
    actions.innerHTML = '<div class="modal-edit-row">' +
      '<label>Nombre</label><input type="text" id="edit-name" value="' + esc(order.name) + '">' +
      '<label>Bandejas</label><input type="number" id="edit-trays" value="' + order.trayCount + '" min="1">' +
      '<label>Precio por bandeja ($)</label><input type="number" id="edit-price" value="' + order.pricePerTray + '" min="1" step="100">' +
      '<label>Fecha de entrega</label><input type="date" id="edit-delivery" value="' + (order.deliveryDate || '') + '">' +
      '</div>' +
      '<button class="btn-primary" id="edit-save">Guardar</button>' +
      '<button class="btn-sm" id="edit-cancel">Cancelar</button>'
    modal.classList.remove('hidden')
    $('#edit-save').onclick = function () {
      var n = $('#edit-name').value.trim()
      var t = parseInt($('#edit-trays').value)
      var p = parseInt($('#edit-price').value)
      var dd = $('#edit-delivery').value
      if (n && t && p) { editOrder(id, n, t, p, dd); hideModal() }
    }
    $('#edit-cancel').onclick = hideModal
  }

  // ===== Purchases =====
  function addPurchase (boxCount, pricePerBox, markupPercent, sellingPrice) {
    var trayCost = pricePerBox / 6
    var suggestedTrayPrice = Math.round(trayCost * (1 + markupPercent / 100))
    data.purchases.push({
      id: genId(), boxCount, pricePerBox, markupPercent,
      suggestedTrayPrice, sellingPrice: sellingPrice || suggestedTrayPrice, date: today()
    })
    saveData()
    return sellingPrice || suggestedTrayPrice
  }

  function deletePurchase (id) {
    data.purchases = data.purchases.filter(p => p.id !== id)
    saveData()
  }

  // ===== Queries =====
  function getPending () { return data.orders.filter(o => o.status === 'pending') }
  function getDebtors () { return data.orders.filter(o => o.payment === 'debtor' && !o.paid) }
  function getDelivered () { return data.orders.filter(o => o.status === 'delivered') }
  function getPaidOrders () { return getDelivered().filter(o => o.paid) }
  function getLastSuggestedPrice () {
    if (!data.purchases.length) return null
    var last = data.purchases[data.purchases.length - 1]
    return last.sellingPrice || last.suggestedTrayPrice
  }

  // ===== Accounting =====
  function calcAccounting () {
    var delivered = getDelivered()
    var paidOrders = delivered.filter(o => o.paid)
    var totalCash = paidOrders.filter(o => o.payment === 'cash').reduce(function (s, o) { return s + o.total }, 0)
    var totalDebtorPaid = paidOrders.filter(o => o.payment === 'debtor').reduce(function (s, o) { return s + o.total }, 0)
    var totalPendingDebt = getDebtors().reduce(function (s, o) { return s + o.total }, 0)
    var totalEarned = totalCash + totalDebtorPaid
    var totalBoxesBought = data.purchases.reduce(function (s, p) { return s + p.boxCount }, 0)
    var totalTraysBought = totalBoxesBought * 6
    var totalSpent = data.purchases.reduce(function (s, p) { return s + p.boxCount * p.pricePerBox }, 0)
    var profit = totalEarned - totalSpent
    var deliveredTrays = delivered.reduce(function (s, o) { return s + o.trayCount }, 0)
    var remainingTrays = totalTraysBought - deliveredTrays
    return { totalCash: totalCash, totalDebtorPaid: totalDebtorPaid, totalPendingDebt: totalPendingDebt,
      totalEarned: totalEarned, totalBoxesBought: totalBoxesBought, totalTraysBought: totalTraysBought,
      totalSpent: totalSpent, profit: profit, deliveredTrays: deliveredTrays,
      remainingTrays: remainingTrays, totalOrders: data.orders.length }
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
  }

  function renderPending () {
    var container = $('#pedidos-pendientes')
    var list = getPending()
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">No hay pedidos pendientes</div>'
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
    var oldDebtors = list.filter(function (o) { return daysSince(o.date) > 7 })
    var html = ''
    if (oldDebtors.length > 0) {
      html += '<div class="alert-banner">' +
        '<div class="alert-banner-title">⚠️ Deudores con más de 7 días</div>' +
        '<ul class="alert-banner-list">' +
        oldDebtors.map(function (o) {
          return '<li>' + esc(o.name) + ' — $' + fmt(o.total) + ' (' + daysSince(o.date) + ' días)</li>'
        }).join('') +
        '</ul></div>'
    }
    if (!list.length) {
      html += '<div class="empty-msg">No hay deudores</div>'
      container.innerHTML = html
      return
    }
    html += list.map(function (o) {
      var days = daysSince(o.date)
      var cls = days > 7 ? ' card-overdue' : ''
      return '<div class="card' + cls + '" data-id="' + o.id + '">' +
        '<input type="checkbox" class="checkbox-lg chk-pay" data-id="' + o.id + '">' +
        '<div class="card-body">' +
        '<div class="card-name">' + esc(o.name) + '</div>' +
        '<div class="card-detail">' + o.trayCount + ' bandeja' + (o.trayCount !== 1 ? 's' : '') + ' · $' + fmt(o.total) + ' · ' + o.date + '</div>' +
        (days > 7 ? '<span class="badge-overdue">' + days + ' días sin pagar</span>' : '') +
        '</div>' +
        '<div class="card-amount">$' + fmt(o.total) + '</div></div>'
    }).join('')
    container.innerHTML = html
  }

  function renderPaid () {
    var container = $('#lista-pagados')
    var list = getPaidOrders().sort(function (a, b) {
      var da = a.paidDate || a.date || ''
      var db = b.paidDate || b.date || ''
      var pa = da.split('-').reverse().join('')
      var pb = db.split('-').reverse().join('')
      return pb.localeCompare(pa)
    })
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">No hay pagos registrados</div>'
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
        '<div class="card-amount">$' + fmt(o.total) + '</div></div>'
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

  function renderAccounting () {
    var a = calcAccounting()
    $('#resumen-contabilidad').innerHTML =
      '<div class="acct-card"><span class="label">Ventas en efectivo</span><span class="value">$' + fmt(a.totalCash) + '</span></div>' +
      '<div class="acct-card"><span class="label">Deudores pagados</span><span class="value">$' + fmt(a.totalDebtorPaid) + '</span></div>' +
      '<div class="acct-card' + (a.totalPendingDebt > 0 ? ' acct-loss' : '') + '"><span class="label">Por cobrar (deudores)</span><span class="value">$' + fmt(a.totalPendingDebt) + '</span></div>' +
      '<div class="acct-card"><span class="label">Total ganado (recibido)</span><span class="value">$' + fmt(a.totalEarned) + '</span></div>' +
      '<div class="acct-card"><span class="label">Inversión en cajas</span><span class="value">$' + fmt(a.totalSpent) + '</span></div>' +
      '<div class="acct-card' + (a.profit >= 0 ? ' acct-profit' : ' acct-loss') + '"><span class="label">Ganancia neta</span><span class="value">$' + fmt(a.profit) + '</span></div>' +
      '<div class="acct-card"><span class="label">Cajas compradas</span><span class="value">' + a.totalBoxesBought + '</span></div>' +
      '<div class="acct-card"><span class="label">Bandejas compradas</span><span class="value">' + a.totalTraysBought + '</span></div>' +
      '<div class="acct-card"><span class="label">Bandejas entregadas</span><span class="value">' + a.deliveredTrays + '</span></div>' +
      '<div class="acct-card' + (a.remainingTrays < 0 ? ' acct-loss' : '') + '"><span class="label">Bandejas restantes</span><span class="value">' + a.remainingTrays + '</span></div>' +
      '<div class="acct-card"><span class="label">Total pedidos</span><span class="value">' + a.totalOrders + '</span></div>'
  }

  function renderNotes () {
    var textarea = $('#notas-textarea')
    if (textarea && !textarea._listening) {
      textarea._listening = true
      textarea.value = data.notes || ''
      textarea.addEventListener('input', function () {
        data.notes = textarea.value
        data.notesUpdatedAt = Date.now()
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        syncToWorker()
      })
    }
  }

  // ===== Helpers =====
  function esc (s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML }
  function fmt (n) { return Number(n).toLocaleString('es-CL') }

  function switchTab (name) {
    $$('.tab').forEach(function (t) { t.classList.remove('active') })
    $$('.tab-content').forEach(function (c) { c.classList.remove('active') })
    document.querySelector('.tab[data-tab="' + name + '"]').classList.add('active')
    document.getElementById('tab-' + name).classList.add('active')
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
  function hideModal () { $('#modal').classList.add('hidden') }
  $('#modal').addEventListener('click', function (e) { if (e.target === e.currentTarget) hideModal() })

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
    var trays = parseInt($('#pedido-trays').value)
    var price = parseInt($('#pedido-price').value)
    var deliveryDate = $('#pedido-date').value || null
    if (!name || !trays || !price) return
    addOrder(name, trays, price, deliveryDate)
    $('#pedido-name').value = ''
    $('#pedido-trays').value = ''
    $('#pedido-date').value = ''
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
      if (confirm('¿Eliminar esta compra?')) deletePurchase(id2)
    }
  })

  function calcSuggestion () {
    var boxes = parseInt($('#compra-boxes').value) || 0
    var price = parseInt($('#compra-price').value) || 0
    var markup = parseInt(document.querySelector('input[name="markup"]:checked').value)
    var suggested = boxes && price ? Math.round(price / 6 * (1 + markup / 100)) : 0
    $('#precio-sugerido').textContent = suggested ? '$' + fmt(suggested) : '$0'
  }
  $('#compra-boxes').addEventListener('input', calcSuggestion)
  $('#compra-price').addEventListener('input', calcSuggestion)
  $$('input[name="markup"]').forEach(function (r) { r.addEventListener('change', calcSuggestion) })

  $('#form-compra').addEventListener('submit', function (e) {
    e.preventDefault()
    var boxes = parseInt($('#compra-boxes').value)
    var price = parseInt($('#compra-price').value)
    var markup = parseInt(document.querySelector('input[name="markup"]:checked').value)
    var selling = parseInt($('#compra-selling').value) || 0
    if (!boxes || !price) return
    addPurchase(boxes, price, markup, selling)
    $('#compra-boxes').value = ''
    $('#compra-price').value = ''
    $('#compra-selling').value = ''
    $('#precio-sugerido').textContent = '$0'
    updatePriceSuggestion()
  })

  $('#btn-export').addEventListener('click', function () {
    var json = JSON.stringify(data, null, 2)
    var blob = new Blob([json], { type: 'application/json' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    a.href = url
    a.download = 'huevos-backup-' + new Date().toISOString().slice(0, 10) + '.json'
    a.click()
    URL.revokeObjectURL(url)
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
        var seen = {}
        var merged = []
        orders.concat(data.orders).forEach(function (o) {
          if (!seen[o.id]) { seen[o.id] = true; merged.push(o) }
        })
        var seenP = {}
        var mergedP = []
        purchases.concat(data.purchases).forEach(function (p) {
          if (!seenP[p.id]) { seenP[p.id] = true; mergedP.push(p) }
        })
        data.orders = merged
        data.purchases = mergedP
        if (importedData.notes) data.notes = importedData.notes
        normalizeOrders()
        saveData()
        alert('Importados: ' + merged.length + ' pedidos, ' + mergedP.length + ' compras')
      } catch (err) { alert('Error al leer: ' + err.message) }
    }
    reader.readAsText(file)
    e.target.value = ''
  })

  // ===== Init =====
  normalizeOrders()
  updatePriceSuggestion()
  renderAll()
  syncFromWorker()
  setInterval(function () { syncFromWorker() }, 60000)
})()
