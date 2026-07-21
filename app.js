;(() => {
  const STORAGE_KEY = 'huevos_data'
  const SYNC_API = 'https://huevos-sync.felipe-v-r-89.workers.dev/api/sync'
  const SYNC_KEY_LOCAL = 'huevos_sync_key'

  let data = loadData()
  let syncTimeout = null

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
    scheduleSync()
  }

  function getSyncKey () { return localStorage.getItem(SYNC_KEY_LOCAL) }
  function setSyncKey (key) { localStorage.setItem(SYNC_KEY_LOCAL, key) }

  function scheduleSync () {
    if (!getSyncKey()) return
    clearTimeout(syncTimeout)
    syncTimeout = setTimeout(syncPush, 2000)
  }

  async function syncPush () {
    const key = getSyncKey()
    if (!key) return
    try {
      const res = await fetch(SYNC_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Sync-Key': key },
        body: JSON.stringify({ data })
      })
      if (res.ok) {
        updateSyncStatus('synced')
      } else {
        updateSyncStatus('error')
      }
    } catch (_) {
      updateSyncStatus('error')
    }
  }

  async function syncPull () {
    const key = getSyncKey()
    if (!key) return false
    try {
      const res = await fetch(SYNC_API, {
        headers: { 'X-Sync-Key': key }
      })
      if (!res.ok) return false
      const json = await res.json()
      if (json.data && (json.data.orders || json.data.purchases)) {
        data = json.data
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
        renderAll()
        updateSyncStatus('synced')
        return true
      }
    } catch (_) {}
    updateSyncStatus('error')
    return false
  }

  function updateSyncStatus (status) {
    const el = $('#sync-status')
    if (!el) return
    if (status === 'synced') {
      el.textContent = '✅ Sincronizado'
      el.className = 'sync-ok'
    } else if (status === 'error') {
      el.textContent = '❌ Error sync'
      el.className = 'sync-error'
    } else if (status === 'syncing') {
      el.textContent = '🔄 Sincronizando...'
      el.className = 'syncing'
    } else {
      el.textContent = ''
      el.className = ''
    }
  }

  function genId () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

  function today () { return new Date().toLocaleDateString('es-CL') }

  // ---- Orders ----
  function addOrder (name, trayCount, pricePerTray) {
    data.orders.push({
      id: genId(),
      name: name.trim(),
      trayCount,
      pricePerTray,
      total: trayCount * pricePerTray,
      date: today(),
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

  // ---- Purchases ----
  function addPurchase (boxCount, pricePerBox, markupPercent, sellingPrice) {
    const trayCost = pricePerBox / 6
    const suggestedTrayPrice = Math.round(trayCost * (1 + markupPercent / 100))
    data.purchases.push({
      id: genId(),
      boxCount,
      pricePerBox,
      markupPercent,
      suggestedTrayPrice,
      sellingPrice,
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
  function getSellingPrice () {
    if (!data.purchases.length) return null
    const last = data.purchases[data.purchases.length - 1]
    return last.sellingPrice || last.suggestedTrayPrice
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
    renderDebtors()
    renderPaid()
    renderPurchases()
    renderAccounting()
  }

  function renderPending () {
    const container = $('#pedidos-pendientes')
    const list = getPending()
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
          <span class="card-detail">Margen ${p.markupPercent}% · Costo: $${fmt(p.suggestedTrayPrice)}</span>
          <span class="card-detail">${p.date}</span>
        </div>
        <div class="card-row">
          <span class="card-detail">Venta: <strong>$${fmt(p.sellingPrice)}</strong> por bandeja</span>
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
    if (!name || !trays || !price) return
    addOrder(name, trays, price)
    $('#pedido-name').value = ''
    $('#pedido-trays').value = ''
    const selling = getSellingPrice()
    $('#pedido-price').value = selling || ''
    $('#pedido-name').focus()
  })

  // Pre-fill price
  function updatePriceSuggestion () {
    const selling = getSellingPrice()
    if (selling && !$('#pedido-price').value) {
      $('#pedido-price').value = selling
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
  })

  // Purchase form - live price suggestion
  function calcSuggestion () {
    const boxes = parseInt($('#compra-boxes').value) || 0
    const price = parseInt($('#compra-price').value) || 0
    const markup = parseInt(document.querySelector('input[name="markup"]:checked').value)
    const suggested = boxes && price ? Math.round(price / 6 * (1 + markup / 100)) : 0
    $('#precio-sugerido').textContent = suggested ? '$' + fmt(suggested) : '$0'
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
    const venta = parseInt($('#compra-venta').value)
    if (!boxes || !price || !venta) return
    addPurchase(boxes, price, markup, venta)
    $('#compra-boxes').value = ''
    $('#compra-price').value = ''
    $('#compra-venta').value = ''
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
  const existingKey = getSyncKey()
  if (existingKey) {
    updateSyncStatus('syncing')
    syncPull().then(() => syncPush())
  }
  updatePriceSuggestion()
  renderAll()

  // ===== Sync Settings =====
  $('#btn-sync').addEventListener('click', () => {
    const current = getSyncKey()
    showModal(current ? 'Código actual: ' + current : 'Ingresa un código para sincronizar entre dispositivos', [
      { label: '🔄 Sincronizar ahora', className: 'btn-primary', action: () => {
        if (getSyncKey()) {
          updateSyncStatus('syncing')
          syncPull().then(() => syncPush())
        }
      }},
      { label: current ? 'Cambiar código' : 'Ingresar código', className: 'btn-sm', action: () => {
        const code = prompt('Código de sincronización:', current || '')
        if (code && code.trim()) {
          setSyncKey(code.trim())
          updateSyncStatus('syncing')
          syncPull().then(() => syncPush())
        }
      }},
      current ? { label: 'Desconectar', className: 'btn-sm', action: () => {
        if (confirm('¿Desactivar sincronización? Los datos locales se mantienen.')) {
          localStorage.removeItem(SYNC_KEY_LOCAL)
          updateSyncStatus('')
        }
      }} : null,
      { label: 'Cerrar', className: 'btn-sm', action: () => {} }
    ].filter(Boolean))
  })

  // ===== PWA Install =====
  let deferredPrompt
  const btnInstall = $('#btn-install')

  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredPrompt = e
    btnInstall.classList.remove('hidden')
    btnInstall.classList.add('visible')
  })

  btnInstall.addEventListener('click', async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === 'accepted') {
      btnInstall.classList.remove('visible')
      btnInstall.classList.add('hidden')
    }
    deferredPrompt = null
  })

  window.addEventListener('appinstalled', () => {
    btnInstall.classList.remove('visible')
    btnInstall.classList.add('hidden')
    deferredPrompt = null
  })
})()
