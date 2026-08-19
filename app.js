;(() => {
  const STORAGE_KEY = 'huevos_data'

  let data = loadData()

  function loadData () {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch (_) {}
    return { orders: [], purchases: [] }
  }

  function saveData () {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    renderAll()
  }

  function genId () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

  function today () { return new Date().toLocaleDateString('es-CL') }

  // ---- Orders ----
  function addOrder (name, trayCount, pricePerTray, deliveryDate) {
    data.orders.push({
      id: genId(),
      name: name.trim(),
      trayCount,
      pricePerTray,
      total: trayCount * pricePerTray,
      date: today(),
      deliveryDate: deliveryDate || null,
      status: 'pending',
      payment: null,
      paid: false,
      paidDate: null
    })
    saveData()
  }

  function deliverOrder (id, paymentMethod) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.status = 'delivered'
    order.payment = paymentMethod
    order.paid = paymentMethod === 'cash'
    order.paidDate = paymentMethod === 'cash' ? today() : null
    saveData()
  }

  function markPaid (id) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    order.paid = true
    order.paidDate = today()
    saveData()
  }

  function deleteOrder (id) {
    data.orders = data.orders.filter(o => o.id !== id)
    saveData()
  }

  function editOrder (id, newData) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    if (newData.name !== undefined) order.name = newData.name.trim()
    if (newData.trayCount !== undefined) { order.trayCount = newData.trayCount; order.total = order.trayCount * order.pricePerTray }
    if (newData.pricePerTray !== undefined) { order.pricePerTray = newData.pricePerTray; order.total = order.trayCount * order.pricePerTray }
    if (newData.deliveryDate !== undefined) order.deliveryDate = newData.deliveryDate
    saveData()
  }

  // ---- Purchases ----
  function addPurchase (boxCount, pricePerBox, markupPercent) {
    const trayCost = pricePerBox / 6
    const suggestedTrayPrice = Math.round(trayCost * (1 + markupPercent / 100))
    data.purchases.push({
      id: genId(),
      boxCount,
      pricePerBox,
      markupPercent,
      suggestedTrayPrice,
      date: today()
    })
    saveData()
    return suggestedTrayPrice
  }

  function deletePurchase (id) {
    data.purchases = data.purchases.filter(p => p.id !== id)
    saveData()
  }

  // ---- Queries ----
  function getPending () { return data.orders.filter(o => o.status === 'pending') }
  function getDebtors () { return data.orders.filter(o => o.payment === 'debtor' && !o.paid) }
  function getPaidOrders () { return data.orders.filter(o => o.paid) }
  function getLastSuggestedPrice () {
    if (!data.purchases.length) return null
    return data.purchases[data.purchases.length - 1].suggestedTrayPrice
  }

  // ---- Accounting ----
  function calcAccounting () {
    const paidOrders = data.orders.filter(o => o.paid)
    const totalCash = paidOrders.filter(o => o.payment === 'cash').reduce((s, o) => s + o.total, 0)
    const totalDebtorPaid = paidOrders.filter(o => o.payment === 'debtor').reduce((s, o) => s + o.total, 0)
    const totalPendingDebt = data.orders.filter(o => o.payment === 'debtor' && !o.paid).reduce((s, o) => s + o.total, 0)
    const totalEarned = totalCash + totalDebtorPaid
    const totalBoxesBought = data.purchases.reduce((s, p) => s + p.boxCount, 0)
    const totalTraysBought = totalBoxesBought * 6
    const totalSpent = data.purchases.reduce((s, p) => s + p.boxCount * p.pricePerBox, 0)
    const profit = totalEarned - totalSpent
    const deliveredTrays = data.orders.filter(o => o.status === 'delivered').reduce((s, o) => s + o.trayCount, 0)
    const remainingTrays = totalTraysBought - deliveredTrays

    return { totalCash, totalDebtorPaid, totalPendingDebt, totalEarned, totalBoxesBought, totalTraysBought, totalSpent, profit, deliveredTrays, remainingTrays, totalOrders: data.orders.length }
  }

  // ===== UI =====
  const $ = s => document.querySelector(s)
  const $$ = s => document.querySelectorAll(s)

  function renderAll () {
    renderPending()
    renderFuture()
    renderDebtors()
    renderPaid()
    renderPurchases()
    renderAccounting()
  }

  function renderPending () {
    const container = $('#pedidos-pendientes')
    const list = getPending().filter(o => {
      if (!o.deliveryDate) return true
      const todayStr = today()
      return o.deliveryDate <= todayStr
    })
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">No hay pedidos pendientes</div>'
      return
    }
    container.innerHTML = list.map(o => `
      <div class="card" data-id="${o.id}">
        <input type="checkbox" class="checkbox-lg chk-deliver" data-id="${o.id}">
        <div class="card-body">
          <div class="card-name">${esc(o.name)}</div>
          <div class="card-detail">${o.trayCount} bandeja${o.trayCount !== 1 ? 's' : ''} x $${fmt(o.pricePerTray)}</div>
        </div>
        <div class="card-amount">$${fmt(o.total)}</div>
        <button class="btn-edit btn-edit-order" data-id="${o.id}" title="Editar">✏️</button>
        <button class="btn-danger btn-del" data-id="${o.id}" title="Eliminar">✕</button>
      </div>
    `).join('')
  }

  function renderFuture () {
    const title = $('#proximos-title')
    const container = $('#pedidos-proximos')
    const todayStr = today()
    const list = getPending().filter(o => o.deliveryDate && o.deliveryDate > todayStr).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate))
    if (!list.length) {
      title.classList.add('hidden')
      container.innerHTML = ''
      return
    }
    title.classList.remove('hidden')
    container.innerHTML = list.map(o => `
      <div class="card" data-id="${o.id}">
        <input type="checkbox" class="checkbox-lg chk-deliver" data-id="${o.id}">
        <div class="card-body">
          <div class="card-name">${esc(o.name)}</div>
          <div class="card-detail">${o.trayCount} bandeja${o.trayCount !== 1 ? 's' : ''} x $${fmt(o.pricePerTray)}</div>
          <span class="badge-delivery">Entrega: ${esc(o.deliveryDate)}</span>
        </div>
        <div class="card-amount">$${fmt(o.total)}</div>
        <button class="btn-edit btn-edit-order" data-id="${o.id}" title="Editar">✏️</button>
        <button class="btn-danger btn-del" data-id="${o.id}" title="Eliminar">✕</button>
      </div>
    `).join('')
  }

  function renderDebtors () {
    const container = $('#lista-deudores')
    const list = getDebtors()
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">No hay deudores 🎉</div>'
      return
    }
    container.innerHTML = list.map(o => `
      <div class="card" data-id="${o.id}">
        <input type="checkbox" class="checkbox-lg chk-pay" data-id="${o.id}">
        <div class="card-body">
          <div class="card-name">${esc(o.name)}</div>
          <div class="card-detail">${o.trayCount} bandeja${o.trayCount !== 1 ? 's' : ''} · ${o.date}</div>
        </div>
        <div class="card-amount">$${fmt(o.total)}</div>
      </div>
    `).join('')
  }

  function renderPaid () {
    const container = $('#lista-pagados')
    const list = getPaidOrders()
    if (!list.length) {
      container.innerHTML = '<div class="empty-msg">No hay pagos registrados</div>'
      return
    }
    container.innerHTML = list.map(o => `
      <div class="card" data-id="${o.id}">
        <div class="card-body">
          <div class="card-name">${esc(o.name)}</div>
          <div class="card-detail">
            ${o.trayCount} bandeja${o.trayCount !== 1 ? 's' : ''} · $${fmt(o.total)}
            <span class="card-status ${o.payment}">${o.payment === 'cash' ? 'Efectivo' : 'Deudor'}</span>
            · ${o.paidDate}
          </div>
        </div>
        <div class="card-amount">$${fmt(o.total)}</div>
        <button class="btn-danger btn-del" data-id="${o.id}" title="Eliminar">✕</button>
      </div>
    `).join('')
  }

  function renderPurchases () {
    const container = $('#lista-compras')
    if (!data.purchases.length) {
      container.innerHTML = '<div class="empty-msg">No hay compras registradas</div>'
      return
    }
    container.innerHTML = data.purchases.slice().reverse().map(p => `
      <div class="card purchase-card" data-id="${p.id}">
        <div class="card-row">
          <div><strong>${p.boxCount} caja${p.boxCount !== 1 ? 's' : ''}</strong> · $${fmt(p.pricePerBox)} c/u</div>
          <button class="btn-danger btn-del-purchase" data-id="${p.id}" title="Eliminar">✕</button>
        </div>
        <div class="card-row">
          <span class="card-detail">Margen ${p.markupPercent}% · Bandeja sugerida: <strong>$${fmt(p.suggestedTrayPrice)}</strong></span>
          <span class="card-detail">${p.date}</span>
        </div>
      </div>
    `).join('')
  }

  function renderAccounting () {
    const a = calcAccounting()
    const container = $('#resumen-contabilidad')
    container.innerHTML = `
      <div class="acct-card">
        <span class="label">Ventas en efectivo</span>
        <span class="value">$${fmt(a.totalCash)}</span>
      </div>
      <div class="acct-card">
        <span class="label">Deudores pagados</span>
        <span class="value">$${fmt(a.totalDebtorPaid)}</span>
      </div>
      <div class="acct-card ${a.totalPendingDebt > 0 ? 'acct-loss' : ''}">
        <span class="label">Por cobrar (deudores)</span>
        <span class="value">$${fmt(a.totalPendingDebt)}</span>
      </div>
      <div class="acct-card">
        <span class="label">Total ganado (recibido)</span>
        <span class="value">$${fmt(a.totalEarned)}</span>
      </div>
      <div class="acct-card">
        <span class="label">Inversión en cajas</span>
        <span class="value">$${fmt(a.totalSpent)}</span>
      </div>
      <div class="acct-card ${a.profit >= 0 ? 'acct-profit' : 'acct-loss'}">
        <span class="label">Ganancia neta</span>
        <span class="value">$${fmt(a.profit)}</span>
      </div>
      <div class="acct-card">
        <span class="label">Cajas compradas</span>
        <span class="value">${a.totalBoxesBought}</span>
      </div>
      <div class="acct-card">
        <span class="label">Bandejas compradas</span>
        <span class="value">${a.totalTraysBought}</span>
      </div>
      <div class="acct-card">
        <span class="label">Bandejas entregadas</span>
        <span class="value">${a.deliveredTrays}</span>
      </div>
      <div class="acct-card ${a.remainingTrays < 0 ? 'acct-loss' : ''}">
        <span class="label">Bandejas restantes</span>
        <span class="value">${a.remainingTrays}</span>
      </div>
      <div class="acct-card">
        <span class="label">Total pedidos</span>
        <span class="value">${a.totalOrders}</span>
      </div>
    `
  }

  // ===== Helpers =====
  function esc (s) {
    const d = document.createElement('div')
    d.textContent = s
    return d.innerHTML
  }

  function fmt (n) {
    return Number(n).toLocaleString('es-CL')
  }

  // ===== Tab switching =====
  function switchTab (name) {
    $$('.tab').forEach(t => t.classList.remove('active'))
    $$('.tab-content').forEach(c => c.classList.remove('active'))
    document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active')
    document.getElementById('tab-' + name).classList.add('active')
  }

  // ===== Modal =====
  function showModal (msg, buttons) {
    const modal = $('#modal')
    $('#modal-msg').textContent = msg
    const actions = $('#modal-actions')
    actions.innerHTML = ''
    buttons.forEach(b => {
      const btn = document.createElement('button')
      btn.textContent = b.label
      btn.className = b.className || 'btn-primary'
      btn.onclick = () => { hideModal(); if (b.action) b.action() }
      actions.appendChild(btn)
    })
    modal.classList.remove('hidden')
  }

  function hideModal () {
    $('#modal').classList.add('hidden')
  }

  function showEditModal (id) {
    const order = data.orders.find(o => o.id === id)
    if (!order) return
    const modal = $('#modal')
    $('#modal-msg').textContent = 'Editar pedido'
    const actions = $('#modal-actions')
    actions.innerHTML = `
      <div class="modal-edit-row">
        <label>Nombre</label>
        <input type="text" id="edit-name" value="${esc(order.name)}">
        <label>Bandejas</label>
        <input type="number" id="edit-trays" value="${order.trayCount}" min="1">
        <label>Precio por bandeja ($)</label>
        <input type="number" id="edit-price" value="${order.pricePerTray}" min="1" step="100">
        <label>Entrega (vacío = hoy)</label>
        <input type="date" id="edit-delivery" value="${order.deliveryDate ? order.deliveryDate : ''}">
      </div>
      <div class="modal-actions">
        <button class="btn-primary" id="btn-save-edit">Guardar</button>
        <button class="btn-sm" id="btn-cancel-edit">Cancelar</button>
      </div>
    `
    modal.classList.remove('hidden')
    $('#btn-save-edit').onclick = () => {
      const name = $('#edit-name').value.trim()
      const trays = parseInt($('#edit-trays').value)
      const price = parseInt($('#edit-price').value)
      const delivery = $('#edit-delivery').value
      if (!name || !trays || !price) return
      editOrder(id, {
        name,
        trayCount: trays,
        pricePerTray: price,
        deliveryDate: delivery || null
      })
      hideModal()
    }
    $('#btn-cancel-edit').onclick = () => hideModal()
  }

  // ---- Notifications & Upcoming Alerts ----
  function requestNotificationPermission () {
    if (!('Notification' in window)) return
    if (Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }

  function getAlertedIds () {
    try {
      return JSON.parse(localStorage.getItem('huevos_alerted') || '[]')
    } catch (_) { return [] }
  }

  function markAlerted (id) {
    const alerted = getAlertedIds()
    if (!alerted.includes(id)) {
      alerted.push(id)
      localStorage.setItem('huevos_alerted', JSON.stringify(alerted))
    }
  }

  function checkUpcomingDeliveries () {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toLocaleDateString('es-CL')
    const todayStr = today()
    const upcoming = getPending().filter(o => {
      if (!o.deliveryDate) return false
      if (o.deliveryDate !== tomorrowStr) return false
      return !getAlertedIds().includes(o.id)
    })
    const banner = $('#alert-banner')
    if (!upcoming.length) {
      banner.classList.add('hidden')
      return
    }
    const listHtml = upcoming.map(o => `<li>${esc(o.name)} - ${o.trayCount} bandeja${o.trayCount !== 1 ? 's' : ''}</li>`).join('')
    banner.innerHTML = `
      <button class="alert-banner-close" id="alert-close">✕</button>
      <div class="alert-banner-title">🔔 Mañana debes entregar:</div>
      <ul class="alert-banner-list">${listHtml}</ul>
    `
    banner.classList.remove('hidden')
    $('#alert-close').onclick = () => banner.classList.add('hidden')
    if ('Notification' in window && Notification.permission === 'granted') {
      const names = upcoming.map(o => o.name).join(', ')
      new Notification('Control Huevos', {
        body: `Mañana debes entregar: ${names}`,
        icon: 'icons/icon-192.png'
      })
    }
    upcoming.forEach(o => markAlerted(o.id))
  }

  $('#modal').addEventListener('click', e => { if (e.target === e.currentTarget) hideModal() })

  // ===== Events =====
  // Tab switching
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'))
      $$('.tab-content').forEach(c => c.classList.remove('active'))
      tab.classList.add('active')
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active')
    })
  })

  // New order
  $('#form-pedido').addEventListener('submit', e => {
    e.preventDefault()
    const name = $('#pedido-name').value.trim()
    const trays = parseInt($('#pedido-trays').value)
    const price = parseInt($('#pedido-price').value)
    const delivery = $('#pedido-delivery').value
    if (!name || !trays || !price) return
    addOrder(name, trays, price, delivery || null)
    $('#pedido-name').value = ''
    $('#pedido-trays').value = ''
    $('#pedido-delivery').value = ''
    const suggested = getLastSuggestedPrice()
    $('#pedido-price').value = suggested || ''
    $('#pedido-name').focus()
  })

  // Pre-fill suggested price
  function updatePriceSuggestion () {
    const suggested = getLastSuggestedPrice()
    if (suggested && !$('#pedido-price').value) {
      $('#pedido-price').value = suggested
    }
  }

  // Deliver order
  $('#pedidos-pendientes').addEventListener('click', e => {
    if (!e.target.classList.contains('chk-deliver')) return
    e.preventDefault()
    const id = e.target.dataset.id
    showModal('¿Canceló en efectivo o es deudor?', [
      { label: '💵 Efectivo', className: 'btn-primary', action: () => { deliverOrder(id, 'cash'); switchTab('pagados') } },
      { label: '📝 Deudor', className: 'btn-sm', action: () => { deliverOrder(id, 'debtor'); switchTab('deudores') } },
      { label: 'Cancelar', className: 'btn-sm', action: () => {} }
    ])
  })

  // Pay debtor
  $('#lista-deudores').addEventListener('click', e => {
    if (!e.target.classList.contains('chk-pay')) return
    e.preventDefault()
    const id = e.target.dataset.id
    showModal('¿El deudor pagó?', [
      { label: '✅ Sí, pagó', className: 'btn-primary', action: () => { markPaid(id); switchTab('pagados') } },
      { label: 'Cancelar', className: 'btn-sm', action: () => {} }
    ])
  })

  // Delete order
  document.addEventListener('click', e => {
    if (e.target.classList.contains('btn-del')) {
      const id = e.target.dataset.id
      if (confirm('¿Eliminar este pedido?')) deleteOrder(id)
    }
    if (e.target.classList.contains('btn-del-purchase')) {
      const id = e.target.dataset.id
      if (confirm('¿Eliminar esta compra?')) deletePurchase(id)
    }
    if (e.target.classList.contains('btn-edit-order')) {
      const id = e.target.dataset.id
      showEditModal(id)
    }
  })

  // Purchase form - live price suggestion
  function calcSuggestion () {
    const boxes = parseInt($('#compra-boxes').value) || 0
    const price = parseInt($('#compra-price').value) || 0
    const markup = parseInt(document.querySelector('input[name="markup"]:checked').value)
    $('#precio-sugerido').textContent = boxes && price ? '$' + fmt(Math.round(price / 6 * (1 + markup / 100))) : '$0'
  }
  $('#compra-boxes').addEventListener('input', calcSuggestion)
  $('#compra-price').addEventListener('input', calcSuggestion)
  $$('input[name="markup"]').forEach(r => r.addEventListener('change', calcSuggestion))

  // New purchase
  $('#form-compra').addEventListener('submit', e => {
    e.preventDefault()
    const boxes = parseInt($('#compra-boxes').value)
    const price = parseInt($('#compra-price').value)
    const markup = parseInt(document.querySelector('input[name="markup"]:checked').value)
    if (!boxes || !price) return
    addPurchase(boxes, price, markup)
    $('#compra-boxes').value = ''
    $('#compra-price').value = ''
    $('#precio-sugerido').textContent = '$0'
    updatePriceSuggestion()
  })

  // Export / backup
  $('#btn-export').addEventListener('click', () => {
    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `huevos-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  })

  // ===== Init =====
  updatePriceSuggestion()
  renderAll()
  requestNotificationPermission()
  checkUpcomingDeliveries()
})()
