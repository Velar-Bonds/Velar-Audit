import { areaChart, donutChart } from './charts.js'

/* ══ Estado ════════════════════════════════════════════════════════════════ */

const state = {
  me: null,
  rows: [],
  summary: null,
  parties: {},
  wallets: null,
  filters: { q: '', status: 'all', asset: 'all', page: 1 },
  drawer: null,
  poll: null,
}

const PER_PAGE = 20
const root = document.getElementById('root')

/* ══ Utilidades ════════════════════════════════════════════════════════════ */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const money = (n) => Number(n).toLocaleString('es-CR', { maximumFractionDigits: 0 })
const money2 = (n) => Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 })
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10)

const shortHash = (h) => (!h ? 'ninguno' : h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h)

/**
 * Fechas en el formato que pide la guía de estilo: día, mes escrito y año,
 * sin abreviaturas que obliguen a descifrar.
 */
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']

function longDate(ms) {
  const d = new Date(ms)
  return `${d.getDate()} de ${MONTHS[d.getMonth()]} de ${d.getFullYear()}`
}
function dateTime(ms) {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${longDate(ms)}, ${hh}:${mm}`
}

/** Referencia estable, derivada del identificador y no de la posición. */
const refOf = (id) => `VA-${String(id).replace(/^don_/, '').slice(0, 6).toUpperCase()}`

function statusOf(row) {
  if (row.returnAction?.status === 'returned') return 'returned'
  return row.verdict?.status ?? 'unscored'
}

const STATUS_LABEL = {
  verified: 'Verificada', pending: 'Pendiente', non_compliant: 'No conforme',
  returned: 'Devuelta', unscored: 'Sin evaluar',
}

function riskOf(row) {
  const findings = row.verdict?.findings ?? []
  if (findings.some((f) => f.severity === 'violation')) return 'high'
  if (findings.some((f) => f.severity === 'warning')) return 'medium'
  return null
}

function toast(message) {
  document.querySelector('.toast')?.remove()
  const el = document.createElement('div')
  el.className = 'toast'
  el.setAttribute('role', 'status')
  el.textContent = message
  document.body.append(el)
  setTimeout(() => el.remove(), 3200)
}

/* ══ API ═══════════════════════════════════════════════════════════════════ */

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options,
  })
  if (res.status === 401) { renderLogin(); throw new Error('La sesión ha caducado.') }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `Error ${res.status}`)
  }
  return res.json()
}

async function refresh() {
  if (!state.me) return
  const [audit, wallets] = await Promise.all([api('/api/audit'), api('/api/wallet')])
  state.rows = audit.rows
  state.summary = audit.summary
  state.parties = audit.parties ?? {}
  state.wallets = wallets
}

/* ══ Inicio de sesión ══════════════════════════════════════════════════════ */

const DEMO_ACCOUNTS = [
  ['tse@velar.cr', 'Tribunal Supremo de Elecciones'],
  ['alfa@velar.cr', 'Partido Alfa'],
  ['beta@velar.cr', 'Partido Beta'],
]

function renderLogin(error = '') {
  clearInterval(state.poll)
  state.poll = null
  state.me = null

  root.innerHTML = `
  <div class="auth-screen">
    <form class="auth-card" id="loginForm" novalidate>
      <div class="auth-brand">
        <span class="brand-mark">V</span>
        <div>
          <div class="brand-name">Velar Audit</div>
          <div class="body-s secondary">Auditoría de donaciones</div>
        </div>
      </div>

      <div class="block">
        ${error ? `
        <div class="error-summary" role="alert" tabindex="-1" id="errorSummary">
          <h2>Hay un problema</h2>
          <p>${esc(error)}</p>
        </div>` : ''}

        <h1 class="heading-l">Inicie sesión</h1>
        <p class="secondary body-s" style="margin:4px 0 24px">
          Use la cuenta institucional que le asignó su organización.</p>

        <div class="field${error ? ' has-error' : ''}">
          <label for="email">Correo electrónico</label>
          <input class="input" type="email" id="email" autocomplete="username" required>
        </div>

        <div class="field${error ? ' has-error' : ''}">
          <label for="password">Contraseña</label>
          <input class="input" type="password" id="password" autocomplete="current-password" required>
        </div>

        <button class="btn block" type="submit" id="loginBtn">Iniciar sesión</button>

        <hr class="rule" style="margin:24px 0 20px">

        <h2 class="heading-s">Cuentas de demostración</h2>
        <p class="body-s secondary" style="margin:2px 0 12px">
          Todas usan la contraseña <span class="mono">velar-demo-2026</span>.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${DEMO_ACCOUNTS.map(([email, label]) =>
            `<button type="button" class="btn secondary sm"
              data-email="${esc(email)}">${esc(label)}</button>`).join('')}
        </div>
      </div>
    </form>
  </div>`

  root.querySelector('#errorSummary')?.focus()

  root.querySelectorAll('[data-email]').forEach((btn) => {
    btn.addEventListener('click', () => {
      root.querySelector('#email').value = btn.dataset.email
      root.querySelector('#password').value = 'velar-demo-2026'
      root.querySelector('#loginBtn').focus()
    })
  })

  root.querySelector('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault()
    const btn = root.querySelector('#loginBtn')
    btn.disabled = true
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: root.querySelector('#email').value,
          password: root.querySelector('#password').value,
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'No ha sido posible iniciar sesión.')
      state.me = body.user
      await start()
    } catch (err) {
      renderLogin(err.message)
    }
  })
}

/* ══ Estructura de la página ═══════════════════════════════════════════════ */

const NAV = [
  { route: 'dashboard', label: 'Resumen' },
  { route: 'donations', label: 'Donaciones', count: () => state.summary?.count },
  { route: 'compliance', label: 'Cumplimiento', count: () => attentionRows().length },
  { route: 'wallets', label: 'Billeteras', count: () => state.wallets?.wallets.length },
]

const CRUMBS = {
  dashboard: [['Resumen', null]],
  donations: [['Donaciones', null]],
  detail: [['Donaciones', 'donations'], ['Detalle de la donación', null]],
  compliance: [['Cumplimiento', null]],
  wallets: [['Billeteras', null]],
}

function renderShell(view, body) {
  const me = state.me
  const org = me.role === 'tse' ? 'Tribunal Supremo de Elecciones' : (me.partyName ?? 'Partido')
  const crumbs = CRUMBS[view] ?? CRUMBS.dashboard
  const initials = me.email.slice(0, 2).toUpperCase()

  root.innerHTML = `
  <a href="#main" class="skip-link">Saltar al contenido principal</a>

  <div class="navbar">
    <div class="navbar-inner">
      <button class="brand-link" data-route="dashboard" aria-label="Velar Audit, ir al resumen">
        <span class="brand-mark">V</span>
        <span>
          <span class="brand-name">Velar Audit</span><br>
          <span class="brand-sub">Tribunal Supremo de Elecciones</span>
        </span>
      </button>

      <div class="navbar-right">
        <span class="navbar-env">
          <span class="dot ${state.wallets?.demoMode ? '' : 'live'}"
            ${state.wallets?.demoMode ? 'style="background:var(--blue-300)"' : ''}></span>
          ${state.wallets?.demoMode ? 'Modo demostración' : 'WDK y análisis local'}
        </span>
        <span class="navbar-user">
          <span class="who">
            ${esc(me.email)}<br>
            <span class="org">${esc(org)}</span>
          </span>
          <span class="avatar" aria-hidden="true">${esc(initials)}</span>
        </span>
        <button class="btn secondary sm" id="logout">Cerrar sesión</button>
      </div>
    </div>
  </div>

  <div class="shell">
    <aside class="sidebar">
      <nav class="nav" aria-label="Menú principal">
        <div class="nav-label">Supervisión</div>
        ${NAV.map((item) => {
          const active = view === item.route || (view === 'detail' && item.route === 'donations')
          const count = item.count?.()
          return `<button class="nav-item" data-route="${item.route}"
            ${active ? 'aria-current="page"' : ''}>
            <span>${item.label}</span>
            ${count != null ? `<span class="nav-count">${count}</span>` : ''}
          </button>`
        }).join('')}
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <nav class="breadcrumbs" aria-label="Ruta de navegación">
          <ol>
            <li><button data-route="dashboard">Inicio</button></li>
            ${crumbs.map(([label, route]) =>
              `<li>${route
                ? `<button data-route="${route}">${esc(label)}</button>`
                : `<span aria-current="page">${esc(label)}</span>`}</li>`).join('')}
          </ol>
        </nav>
      </header>

      <div class="phase-banner">
        <strong class="tag returned">Beta</strong>
        <span>Servicio en construcción para el Tribunal Supremo de Elecciones.
          ${state.wallets?.demoMode
            ? 'Ahora mismo funciona con una cadena simulada.'
            : 'Conectado a la red de pruebas, con análisis local.'}</span>
      </div>

      <main id="main" class="content">${body}</main>
    </div>
  </div>

  ${state.drawer ? renderDrawer(state.drawer) : ''}`

  root.querySelector('#logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    renderLogin()
  })

  wireView(view)
}

/* ══ Resumen ═══════════════════════════════════════════════════════════════ */

function activitySeries(days = 7) {
  const DAY = 86_400_000
  const today = new Date().setHours(0, 0, 0, 0)
  const buckets = new Map()

  for (let i = days - 1; i >= 0; i--) buckets.set(today - i * DAY, 0)
  for (const row of state.rows) {
    const day = new Date(row.donation.receivedAt).setHours(0, 0, 0, 0)
    if (buckets.has(day)) buckets.set(day, buckets.get(day) + row.donation.amountDecimal)
  }

  return [...buckets].map(([day, value]) => ({
    label: new Date(day).toLocaleDateString('es-CR', { weekday: 'short' }).replace('.', ''),
    value,
  }))
}

function periodChange(days = 7) {
  const DAY = 86_400_000
  const now = Date.now()
  const sum = (from, to) => state.rows
    .filter((r) => r.donation.receivedAt >= from && r.donation.receivedAt < to)
    .reduce((acc, r) => acc + r.donation.amountDecimal, 0)

  const current = sum(now - days * DAY, now)
  const previous = sum(now - 2 * days * DAY, now - days * DAY)
  if (previous === 0) return null
  return Math.round(((current - previous) / previous) * 1000) / 10
}

const FLOW_STEPS = [
  ['La persona donante envía el dinero', 'A la billetera del partido, sin intermediarios.'],
  ['La billetera del partido lo recibe', 'Construida con WDK, bajo custodia del propio partido.'],
  ['El indexador lo registra', 'Lee la cadena directamente. El partido no se autorreporta.'],
  ['Se vincula la atestación', 'Solo el hash. Los datos personales no entran al sistema.'],
  ['Se evalúa el cumplimiento', 'Reglas deterministas, explicadas por un modelo local.'],
  ['Se ancla la evidencia', 'Hash, fecha y referencia de transacción, en la cadena.'],
]

function viewDashboard() {
  const s = state.summary
  const change = periodChange()
  const scored = s.verified + s.pending + s.non_compliant

  const donutSlices = [
    { label: 'Verificadas', value: s.verified, color: '#0f7a52' },
    { label: 'Pendientes', value: s.pending, color: '#d97b00' },
    { label: 'No conformes', value: s.non_compliant, color: '#ca3535' },
  ]

  return `
  <div class="view-head">
    <span class="caption">${esc(state.me.role === 'tse'
      ? 'Todos los partidos' : (state.me.partyName ?? ''))}</span>
    <h1 class="heading-xl">Auditoría de donaciones</h1>
    <p class="lede">Cada donación queda registrada desde que llega hasta que se verifica,
      se marca o se devuelve. La evidencia es pública y verificable; la identidad de quien
      dona, no.</p>
    <div class="actions">
      <button class="btn secondary" data-route="donations">Ver todas las donaciones</button>
      <button class="btn secondary" data-route="compliance">Revisar cumplimiento</button>
      ${state.me.role === 'tse'
        ? '<button class="btn" id="runDemo">Recargar datos de demostración</button>' : ''}
    </div>
  </div>

  <div class="stack">
    <section aria-label="Cifras principales">
      <ul class="stats">
        <li class="stat">
          <div class="k">Total recibido</div>
          <div class="v">${money(s.totalDecimal)}</div>
          <div class="n">${change === null
            ? `${s.count} donaciones en total`
            : `${change >= 0 ? 'Sube' : 'Baja'} ${Math.abs(change)}% respecto de la semana anterior`}</div>
        </li>
        <li class="stat ok">
          <div class="k">Verificadas</div>
          <div class="v">${pct(s.verified, scored)}%</div>
          <div class="n">${s.verified} de ${scored} donaciones evaluadas</div>
        </li>
        <li class="stat warn">
          <div class="k">Pendientes de revisión</div>
          <div class="v">${s.pending}</div>
          <div class="n">Esperan la atestación del proveedor</div>
        </li>
        <li class="stat err">
          <div class="k">No conformes</div>
          <div class="v">${s.non_compliant}</div>
          <div class="n">Deben devolverse dentro del plazo</div>
        </li>
      </ul>
    </section>

    <section class="cols two-thirds">
      <div class="block">
        <h2 class="heading-m">Actividad de los últimos 7 días</h2>
        <p class="caption">Monto recibido por día, en USDC.</p>
        ${areaChart(activitySeries())}
      </div>

      <div class="block">
        <h2 class="heading-m">Estado de cumplimiento</h2>
        <p class="caption">Proporción de donaciones evaluadas.</p>
        ${donutChart(donutSlices)}
        <ul class="legend">
          ${donutSlices.map((slice) => `
            <li>
              <span class="swatch" style="background:${slice.color}"></span>
              <span>${slice.label}</span>
              <span class="pct">${pct(slice.value, scored)}%</span>
            </li>`).join('')}
        </ul>
      </div>
    </section>

    <section>
      <h2 class="heading-l">Cómo se verifica una donación</h2>
      <p class="secondary" style="margin:10px 0 25px">Cada paso deja un hash anclado en la
        cadena de bloques, de manera que la secuencia completa puede reconstruirse después.</p>
      <ol class="flow">
        ${FLOW_STEPS.map(([title, desc], i) => `
          <li class="flow-step">
            <div class="n">${i + 1}</div>
            <div class="t">${title}</div>
            <div class="d">${desc}</div>
          </li>`).join('')}
      </ol>
    </section>

    <section>
      <h2 class="heading-l" style="margin-bottom:16px">Donaciones recientes</h2>
      <div class="table-card">
        ${donationTable(state.rows.slice(0, 8), { compact: true })}
        <div class="pager">
          <span>Se muestran las 8 más recientes</span>
          <button class="btn-link" data-route="donations">Ver las ${s.count} donaciones</button>
        </div>
      </div>
    </section>
  </div>`
}

/* ══ Tabla de donaciones ═══════════════════════════════════════════════════ */

function donationTable(rows, { compact = false } = {}) {
  const showParty = state.me.role === 'tse'

  if (rows.length === 0) {
    return `<p class="empty">No hay donaciones que coincidan con los filtros aplicados.</p>`
  }

  return `
  <div class="table-wrap">
    <table>
      <caption class="sr">Listado de donaciones</caption>
      <thead>
        <tr>
          <th scope="col">Referencia</th>
          ${showParty ? '<th scope="col">Partido</th>' : ''}
          <th scope="col" class="num">Monto</th>
          <th scope="col">Activo</th>
          ${compact ? '' : '<th scope="col">País</th>'}
          <th scope="col">Atestación</th>
          <th scope="col">Estado</th>
          <th scope="col">Recibida</th>
          <th scope="col"><span class="sr">Acciones</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const d = row.donation
          const status = statusOf(row)
          return `
          <tr>
            <th scope="row" style="font-weight:700">${esc(refOf(d.id))}</th>
            ${showParty ? `<td>${esc(state.parties[d.partyId] ?? d.partyId)}</td>` : ''}
            <td class="num">${money2(d.amountDecimal)}</td>
            <td>${esc(d.asset)}</td>
            ${compact ? '' : `<td>${row.attestation ? esc(row.attestation.donorCountry) : 'Sin dato'}</td>`}
            <td class="mono">${row.attestation ? esc(shortHash(row.attestation.hash)) : 'Pendiente'}</td>
            <td><strong class="tag ${status}">${STATUS_LABEL[status]}</strong></td>
            <td class="nowrap">${esc(longDate(d.receivedAt))}</td>
            <td><button class="btn-link" data-donation="${esc(d.id)}">Ver detalle<span class="sr">
              de la donación ${esc(refOf(d.id))}</span></button></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div>`
}

/* ══ Donaciones ════════════════════════════════════════════════════════════ */

function filteredRows() {
  const { q, status, asset } = state.filters
  const needle = q.trim().toLowerCase()

  return state.rows.filter((row) => {
    if (status !== 'all' && statusOf(row) !== status) return false
    if (asset !== 'all' && row.donation.asset !== asset) return false
    if (!needle) return true

    return [
      refOf(row.donation.id), row.donation.txHash, row.donation.fromAddress,
      row.attestation?.donorCountry, state.parties[row.donation.partyId],
    ].filter(Boolean).join(' ').toLowerCase().includes(needle)
  })
}

function viewDonations() {
  const counts = { all: state.rows.length }
  for (const key of ['verified', 'pending', 'non_compliant', 'returned']) {
    counts[key] = state.rows.filter((r) => statusOf(r) === key).length
  }

  const assets = [...new Set(state.rows.map((r) => r.donation.asset))]
  const rows = filteredRows()
  const pages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  const page = Math.min(state.filters.page, pages)
  const slice = rows.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  const TABS = [
    ['all', 'Todas'], ['verified', 'Verificadas'], ['pending', 'Pendientes'],
    ['non_compliant', 'No conformes'], ['returned', 'Devueltas'],
  ]

  return `
  <div class="view-head">
    <span class="caption">${esc(state.me.role === 'tse'
      ? 'Todos los partidos' : (state.me.partyName ?? ''))}</span>
    <h1 class="heading-xl">Donaciones</h1>
    <p class="lede">Se muestran ${rows.length} de ${state.rows.length} donaciones.</p>
  </div>

  <div class="table-card">
    <div class="tabs" role="tablist">
      ${TABS.map(([key, label]) => `
        <button class="tab" role="tab" data-tab="${key}"
          aria-selected="${state.filters.status === key}">${label} (${counts[key] ?? 0})</button>`).join('')}
    </div>

    <div class="filter-bar">
      <div class="field">
        <label for="q">Buscar</label>
        <p class="hint">Por referencia, hash de transacción o dirección de origen.</p>
        <input class="input narrow" id="q" type="search" value="${esc(state.filters.q)}">
      </div>
      <div class="field">
        <label for="assetFilter">Activo</label>
        <select class="select" id="assetFilter" style="width:auto">
          <option value="all">Todos</option>
          ${assets.map((a) => `<option value="${esc(a)}"
            ${state.filters.asset === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
    </div>

    ${donationTable(slice)}

    <div class="pager">
      <span>Página ${page} de ${pages}</span>
      <span style="display:flex;gap:8px">
        <button class="btn secondary sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Anterior</button>
        <button class="btn secondary sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Siguiente</button>
      </span>
    </div>
  </div>`
}

/* ══ Detalle de una donación ═══════════════════════════════════════════════ */

function summaryList(entries) {
  const rows = entries.filter(Boolean)
  if (rows.length === 0) return ''
  return `<dl class="summary-list">
    ${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}
  </dl>`
}

function viewDetail(id) {
  const row = state.rows.find((r) => r.donation.id === id)
  if (!row) {
    return `
    <div class="view-head">
      <h1 class="heading-xl">No se ha encontrado la donación</h1>
      <p class="lede">Esta donación no existe, o pertenece a un partido cuyos datos usted no
        puede consultar.</p>
      <div class="actions">
        <button class="btn secondary" data-route="donations">Volver a las donaciones</button>
      </div>
    </div>`
  }

  const { donation: d, attestation: a, verdict: v, returnAction: r, anchors } = row
  const status = statusOf(row)
  const attAnchor = anchors.find((x) => x.kind === 'attestation')
  const verdictAnchor = anchors.filter((x) => x.kind === 'verdict').at(-1)
  const returnAnchor = anchors.find((x) => x.kind === 'return')

  const step = (cls, title, when, content) => `
    <li class="tl-step ${cls}">
      <h3>${title}</h3>
      <p class="when">${when}</p>
      ${content}
    </li>`

  const checks = (v?.findings ?? []).map((f) => {
    const tone = f.severity === 'violation' ? 'bad' : f.severity === 'warning' ? 'warn' : 'ok'
    const mark = f.severity === 'violation' ? '✕' : f.severity === 'warning' ? '!' : '✓'
    return `<li class="${tone}"><span class="mark" aria-hidden="true">${mark}</span>
      <span>${esc(f.message)}</span></li>`
  }).join('')

  return `
  <div class="view-head">
    <span class="caption">${esc(state.parties[d.partyId] ?? d.partyId)}</span>
    <h1 class="heading-xl">${esc(refOf(d.id))}</h1>
    <p class="lede">${money2(d.amountDecimal)} ${esc(d.asset)} ·
      <strong class="tag ${status}">${STATUS_LABEL[status]}</strong></p>
    <div class="actions">
      <button class="btn secondary" data-route="donations">Volver</button>
      ${status === 'non_compliant'
        ? `<button class="btn warning" data-return="${esc(d.id)}">Iniciar la devolución</button>` : ''}
    </div>
  </div>

  <h2 class="heading-l" style="margin-bottom:25px">Trazabilidad</h2>

  <ol class="timeline">
    ${step('done', 'Donación recibida', dateTime(d.receivedAt), summaryList([
      ['Monto', `${money2(d.amountDecimal)} ${esc(d.asset)}`],
      ['Dirección de origen', `<span class="mono">${esc(d.fromAddress)}</span>`],
      ['Partido receptor', esc(state.parties[d.partyId] ?? d.partyId)],
    ]))}

    ${step('done', 'Confirmada en la cadena', `Red ${esc(d.chain)}`, summaryList([
      ['Transacción', `<span class="mono">${esc(d.txHash)}</span>`],
      ['Bloque', d.blockNumber ? String(d.blockNumber) : 'Simulado en modo demostración'],
    ]))}

    ${a
      ? step('done', 'Atestación vinculada', dateTime(a.issuedAt),
          summaryList([
            ['Hash de la atestación', `<span class="mono">${esc(a.hash)}</span>`],
            ['País de la persona donante', esc(a.donorCountry)],
            ['Origen de los fondos', esc(a.sourceOfFunds)],
            ['Identidad verificada', a.kycVerified ? 'Sí' : 'No'],
            ['Persona expuesta políticamente', a.isPep ? 'Sí' : 'No'],
          ]) +
          `<div class="inset">
            <p>En la cadena de bloques no se almacena ningún dato personal de la persona
            donante. Solo se registra el hash de la atestación, que el proveedor puede
            reproducir para demostrar que el documento no ha cambiado.</p>
          </div>`)
      : step('todo', 'Atestación pendiente',
          'El proveedor todavía no ha emitido la atestación',
          `<div class="inset warn">
            <p>Si la atestación no llega dentro del plazo, la donación pasa a considerarse
            no conforme y debe devolverse.</p>
          </div>`)}

    ${v ? step(v.status === 'non_compliant' ? 'todo' : 'done', 'Análisis de cumplimiento',
        dateTime(v.evaluatedAt),
        summaryList([
          ['Resultado', `<strong class="tag ${v.status}">${STATUS_LABEL[v.status]}</strong>`],
          ['Motor que decidió', v.engine === 'qvac'
            ? 'Reglas deterministas, explicadas por el modelo local'
            : 'Reglas deterministas'],
          ['Reglas aplicadas', String(v.findings.length)],
        ]) +
        (v.rationale ? `<div class="inset"><p>${esc(v.rationale)}</p></div>` : '') +
        `<ul class="checks">${checks}</ul>`)
      : ''}

    ${step(anchors.length ? 'done' : 'todo', 'Evidencia de auditoría',
      `${anchors.length} ${anchors.length === 1 ? 'anclaje' : 'anclajes'} en la cadena`,
      summaryList([
        attAnchor && ['Hash de la atestación', `<span class="mono">${esc(attAnchor.subjectHash)}</span>`],
        verdictAnchor && ['Hash del veredicto', `<span class="mono">${esc(verdictAnchor.subjectHash)}</span>`],
        returnAnchor && ['Hash de la devolución', `<span class="mono">${esc(returnAnchor.subjectHash)}</span>`],
        anchors[0] && ['Transacción de anclaje',
          `<span class="mono">${esc(anchors[0].txRef)}</span>${
            anchors[0].simulated ? ' (simulada en modo demostración)' : ''}`],
      ]))}

    ${r?.status === 'returned'
      ? step('done', 'Devolución ejecutada', dateTime(r.executedAt), summaryList([
          ['Motivo', esc(r.reason)],
          ['Transacción del reembolso', `<span class="mono">${esc(r.refundTxRef)}</span>`],
        ]))
      : ''}
  </ol>`
}

/* ══ Cumplimiento ══════════════════════════════════════════════════════════ */

function attentionRows() {
  return state.rows
    .filter((r) => {
      if (r.returnAction?.status === 'returned') return false
      const status = statusOf(r)
      return status === 'non_compliant' || status === 'pending'
    })
    .sort((a, b) => {
      const rank = (r) => (riskOf(r) === 'high' ? 0 : 1)
      return rank(a) - rank(b) || b.donation.amountDecimal - a.donation.amountDecimal
    })
}

function viewCompliance() {
  const attention = attentionRows()
  const lastVerdict = state.rows
    .map((r) => r.verdict?.evaluatedAt ?? 0)
    .reduce((max, t) => Math.max(max, t), 0)

  const usedAgent = state.rows.some((r) => r.verdict?.engine === 'qvac')
  const sinceLast = lastVerdict
    ? `hace ${Math.max(1, Math.round((Date.now() - lastVerdict) / 1000))} segundos`
    : 'todavía no se ha ejecutado'

  return `
  <div class="view-head">
    <h1 class="heading-xl">Cumplimiento</h1>
    <p class="lede">El análisis se ejecuta en este equipo. Ningún dato de identificación
      de personas donantes se envía a servicios externos.</p>
  </div>

  <div class="stack">
    <section class="block">
      <h2 class="heading-m">Agente de análisis</h2>
      <p class="caption">${usedAgent
        ? 'El modelo local está en funcionamiento.'
        : 'El modelo local no está disponible. El análisis continúa con las reglas.'}</p>

      ${summaryList([
        ['Estado', usedAgent
          ? '<strong class="tag verified">En funcionamiento</strong>'
          : '<strong class="tag unscored">Solo reglas</strong>'],
        ['Donaciones procesadas', String(state.rows.length)],
        ['Último análisis', sinceLast],
        ['Datos enviados a servicios externos', 'Ninguno'],
      ])}

      <div class="warning-text">
        <span class="mark" aria-hidden="true">!</span>
        <p><span class="sr">Advertencia: </span>El modelo redacta la explicación que lee
          la persona auditora, pero <strong>no decide si algo es legal</strong>. Esa decisión
          la toman reglas deterministas, porque un dictamen con consecuencia legal debe poder
          reproducirlo un regulador.</p>
      </div>

      <div class="progress" id="analysisBar"><i></i></div>
      <button class="btn" id="runAnalysis">Volver a analizar las donaciones pendientes</button>
    </section>

    <section>
      <h2 class="heading-l">Requieren atención</h2>
      <p class="secondary" style="margin:10px 0 25px">
        ${attention.length === 0
          ? 'No hay donaciones pendientes de resolver.'
          : `${attention.length} ${attention.length === 1 ? 'donación' : 'donaciones'} sin resolver,
             ordenadas por nivel de riesgo.`}</p>

      ${attention.length === 0 ? '' : `
      <ul class="task-list table-card">
        ${attention.slice(0, 15).map((row) => {
          const risk = riskOf(row)
          const worst = (row.verdict?.findings ?? [])
            .find((f) => f.severity === 'violation') ?? row.verdict?.findings?.[0]
          return `
          <li>
            <span class="title">
              ${esc(refOf(row.donation.id))}<br>
              <span class="body-s secondary">${money2(row.donation.amountDecimal)}
                ${esc(row.donation.asset)}</span>
            </span>
            <span class="detail">${esc(worst?.message ?? 'Sin hallazgos registrados.')}</span>
            <strong class="tag ${risk === 'high' ? 'high' : 'medium'}">
              ${risk === 'high' ? 'Riesgo alto' : 'Riesgo medio'}</strong>
            <button class="btn-link" data-review="${esc(row.donation.id)}">Revisar<span class="sr">
              la donación ${esc(refOf(row.donation.id))}</span></button>
          </li>`
        }).join('')}
      </ul>`}
    </section>
  </div>`
}

function renderDrawer(id) {
  const row = state.rows.find((r) => r.donation.id === id)
  if (!row) return ''

  const { donation: d, attestation: a, verdict: v } = row
  const status = statusOf(row)
  const risk = riskOf(row)

  const checks = (v?.findings ?? []).map((f) => {
    const tone = f.severity === 'violation' ? 'bad' : f.severity === 'warning' ? 'warn' : 'ok'
    const mark = f.severity === 'violation' ? '✕' : f.severity === 'warning' ? '!' : '✓'
    return `<li class="${tone}"><span class="mark" aria-hidden="true">${mark}</span>
      <span>${esc(f.message)}</span></li>`
  }).join('')

  return `
  <div class="scrim" data-close-drawer></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-labelledby="drawerTitle">
    <div class="drawer-head">
      <div>
        <h2 class="heading-m" id="drawerTitle">${esc(refOf(d.id))}</h2>
        <p class="body-s secondary">${esc(state.parties[d.partyId] ?? d.partyId)}</p>
      </div>
      <button class="btn-link" data-close-drawer>Cerrar</button>
    </div>

    <div class="drawer-body">
      <p style="margin-bottom:20px">
        <strong class="tag ${status}">${STATUS_LABEL[status]}</strong>
        ${risk ? ` <strong class="tag ${risk}">${risk === 'high' ? 'Riesgo alto' : 'Riesgo medio'}</strong>` : ''}
      </p>

      <h3 class="heading-s">Donación</h3>
      ${summaryList([
        ['Monto', `${money2(d.amountDecimal)} ${esc(d.asset)}`],
        ['Red', esc(d.chain)],
        ['Origen', `<span class="mono">${esc(shortHash(d.fromAddress))}</span>`],
        ['Recibida', esc(dateTime(d.receivedAt))],
      ])}

      <h3 class="heading-s" style="margin-top:30px">Atestación</h3>
      ${a
        ? summaryList([
            ['País', esc(a.donorCountry)],
            ['Identidad verificada', a.kycVerified ? 'Sí' : 'No'],
            ['Origen de los fondos', esc(a.sourceOfFunds)],
            ['Persona expuesta políticamente', a.isPep ? 'Sí' : 'No'],
          ])
        : '<p style="margin-top:10px">El proveedor todavía no ha emitido la atestación.</p>'}

      <h3 class="heading-s" style="margin-top:30px">Hallazgos</h3>
      ${v?.rationale ? `<div class="inset"><p>${esc(v.rationale)}</p></div>` : ''}
      <ul class="checks">${checks}</ul>
    </div>

    <div class="drawer-foot">
      <button class="btn secondary" data-detail="${esc(d.id)}">Ver detalle completo</button>
      <button class="btn secondary" data-rescore="${esc(d.id)}">Volver a evaluar</button>
      ${status === 'non_compliant'
        ? `<button class="btn warning" data-return="${esc(d.id)}">Devolver</button>` : ''}
    </div>
  </aside>`
}

/* ══ Billeteras ════════════════════════════════════════════════════════════ */

const PRIVATE_ITEMS = [
  'Identidad de la persona donante',
  'Documentos de verificación de identidad',
  'Justificación del origen de los fondos',
  'Cualquier otro dato personal',
]
const PUBLIC_ITEMS = [
  'Hash de la transacción',
  'Hash de la atestación',
  'Resultado del análisis de cumplimiento',
  'Fecha y hora',
  'Evidencia de la devolución, si la hubo',
]

function viewWallets() {
  const w = state.wallets
  const fromBase = (raw, dec) => Number(BigInt(raw ?? '0')) / 10 ** dec

  return `
  <div class="view-head">
    <h1 class="heading-xl">Billeteras</h1>
    <p class="lede">Cada partido custodia su propia billetera. Ninguna casa de cambio ni
      custodio se interpone entre quien dona y el partido, de modo que nadie puede mover
      ni ocultar una donación sin que quede registrada.</p>
  </div>

  <div class="stack">
    <section>
      <h2 class="heading-l" style="margin-bottom:25px">Billeteras de los partidos</h2>
      <div class="cols ${w.wallets.length > 1 ? 'halves' : ''}">
        ${w.wallets.map((wallet) => {
          const native = fromBase(wallet.balances?.native, 18)
          const token = fromBase(wallet.balances?.token, w.token.decimals)
          return `
          <div class="wallet">
            <div class="sub">${esc(wallet.partyName)}</div>
            <div class="amount">${money2(token)} ${esc(w.token.symbol)}</div>
            <div class="sub">${native.toFixed(4)} ETH para comisiones de red</div>
            <div class="addr">
              <code>${esc(wallet.address)}</code>
              <button class="btn secondary sm" data-copy="${esc(wallet.address)}">Copiar</button>
            </div>
            ${summaryList([
              ['Estado', '<strong class="tag verified">Activa</strong>'],
              ['Red', `${esc(w.chain)}, ${esc(w.network)}`],
              ['Infraestructura', 'Wallet Development Kit (WDK)'],
              ['Cuenta derivada', `Número ${wallet.walletIndex}`],
            ])}
          </div>`
        }).join('')}
      </div>
      <div class="inset">
        <p>Todas las billeteras se derivan de una misma frase semilla, cada una con su propio
        número de cuenta. Un despliegue con varios partidos necesita una sola frase y no una
        por partido, y aun así las donaciones quedan separadas en la cadena.</p>
      </div>
    </section>

    <section>
      <h2 class="heading-l">Evidencia sin exposición</h2>
      <p class="secondary" style="margin:10px 0 25px">Qué se queda fuera de la cadena de
        bloques y qué se publica en ella.</p>

      <div class="privacy">
        <div class="privacy-col">
          <h3>Privado, fuera de la cadena</h3>
          <p class="cap">Lo custodia el proveedor de verificación de identidad.
            Nunca entra a este sistema.</p>
          <ul class="privacy-list">
            ${PRIVATE_ITEMS.map((label) => `<li>${label}</li>`).join('')}
          </ul>
        </div>

        <div class="transform" aria-hidden="true">
          <span class="step">Dato sensible</span>
          <span class="arrow">↓</span>
          <span class="step mid">SHA-256</span>
          <span class="arrow">↓</span>
          <span class="step">Evidencia verificable</span>
        </div>

        <div class="privacy-col on">
          <h3>Público y verificable, en la cadena</h3>
          <p class="cap">Cualquier persona puede comprobarlo, incluido el Tribunal
            Supremo de Elecciones.</p>
          <ul class="privacy-list">
            ${PUBLIC_ITEMS.map((label) => `<li>${label}</li>`).join('')}
          </ul>
        </div>
      </div>
    </section>
  </div>`
}

/* ══ Enrutado ══════════════════════════════════════════════════════════════ */

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '')
  const [head, tail] = hash.split('/')
  if (head === 'donations' && tail) return { view: 'detail', id: tail }
  if (['dashboard', 'donations', 'compliance', 'wallets'].includes(head)) return { view: head }
  return { view: 'dashboard' }
}

function go(route, id) {
  location.hash = id ? `#/${route}/${id}` : `#/${route}`
}

function render() {
  if (!state.me) return renderLogin()
  const { view, id } = currentRoute()

  const body =
    view === 'donations' ? viewDonations()
    : view === 'detail' ? viewDetail(id)
    : view === 'compliance' ? viewCompliance()
    : view === 'wallets' ? viewWallets()
    : viewDashboard()

  renderShell(view, body)
}

/* ══ Eventos ═══════════════════════════════════════════════════════════════ */

function wireView(view) {
  root.querySelectorAll('[data-route]').forEach((el) =>
    el.addEventListener('click', () => go(el.dataset.route)))

  root.querySelectorAll('[data-donation]').forEach((el) =>
    el.addEventListener('click', () => go('donations', el.dataset.donation)))

  root.querySelectorAll('[data-detail]').forEach((el) =>
    el.addEventListener('click', () => { state.drawer = null; go('donations', el.dataset.detail) }))

  root.querySelectorAll('[data-copy]').forEach((el) =>
    el.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el.dataset.copy)
        toast('Se ha copiado la dirección de la billetera.')
      } catch {
        toast('No ha sido posible copiar la dirección.')
      }
    }))

  root.querySelectorAll('[data-return]').forEach((el) =>
    el.addEventListener('click', async () => {
      el.disabled = true
      try {
        await api(`/api/donations/${el.dataset.return}/return`, { method: 'POST' })
        toast('La devolución se ha ejecutado y su evidencia ha quedado anclada en la cadena.')
        state.drawer = null
        await refresh(); render()
      } catch (err) { toast(err.message) }
    }))

  root.querySelectorAll('[data-rescore]').forEach((el) =>
    el.addEventListener('click', async () => {
      el.disabled = true
      try {
        await api(`/api/donations/${el.dataset.rescore}/score`, { method: 'POST' })
        toast('La donación se ha vuelto a evaluar.')
        await refresh(); render()
      } catch (err) { toast(err.message) }
    }))

  root.querySelectorAll('[data-review]').forEach((el) =>
    el.addEventListener('click', () => { state.drawer = el.dataset.review; render() }))

  root.querySelectorAll('[data-close-drawer]').forEach((el) =>
    el.addEventListener('click', () => { state.drawer = null; render() }))

  if (view === 'donations') wireDonationFilters()
  if (view === 'compliance') wireCompliance()

  const demo = root.querySelector('#runDemo')
  demo?.addEventListener('click', async () => {
    demo.disabled = true
    demo.textContent = 'Recargando…'
    try {
      await api('/api/demo/seed', { method: 'POST' })
      await refresh(); render()
      toast('Se han recargado los datos de demostración.')
    } catch (err) { toast(err.message); demo.disabled = false }
  })

  // Move focus into the drawer so a keyboard user is not left behind it.
  root.querySelector('.drawer')?.querySelector('button')?.focus()
}

function wireDonationFilters() {
  root.querySelectorAll('[data-tab]').forEach((tab) =>
    tab.addEventListener('click', () => {
      state.filters.status = tab.dataset.tab
      state.filters.page = 1
      render()
    }))

  const search = root.querySelector('#q')
  search?.addEventListener('input', () => {
    state.filters.q = search.value
    state.filters.page = 1
    render()
    // Re-rendering replaces the input, so focus and caret have to be restored.
    const next = root.querySelector('#q')
    next.focus()
    next.setSelectionRange(next.value.length, next.value.length)
  })

  const asset = root.querySelector('#assetFilter')
  asset?.addEventListener('change', () => {
    state.filters.asset = asset.value
    state.filters.page = 1
    render()
  })

  root.querySelectorAll('[data-page]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.filters.page = Number(btn.dataset.page)
      render()
    }))
}

function wireCompliance() {
  const button = root.querySelector('#runAnalysis')
  const bar = root.querySelector('#analysisBar > i')
  if (!button) return

  button.addEventListener('click', async () => {
    button.disabled = true
    const pending = attentionRows().slice(0, 8)
    if (pending.length === 0) {
      toast('No hay donaciones pendientes de analizar.')
      button.disabled = false
      return
    }

    let done = 0
    for (const row of pending) {
      try { await api(`/api/donations/${row.donation.id}/score`, { method: 'POST' }) } catch { /* continúa */ }
      done++
      bar.style.width = `${Math.round((done / pending.length) * 100)}%`
    }

    await refresh()
    toast(`Se ${done === 1 ? 'ha' : 'han'} vuelto a analizar ${done} ${done === 1 ? 'donación' : 'donaciones'}.`)
    render()
  })
}

/* ══ Arranque ══════════════════════════════════════════════════════════════ */

async function start() {
  await refresh()
  render()

  clearInterval(state.poll)
  state.poll = setInterval(async () => {
    // A donation arriving mid-demo should appear on its own. Never re-render
    // while a drawer is open or someone is typing into a filter.
    if (state.drawer || document.activeElement?.id === 'q') return
    try { await refresh(); render() } catch { /* la sesión se maneja en api() */ }
  }, 8000)
}

window.addEventListener('hashchange', () => {
  // A drawer belongs to the view that opened it.
  state.drawer = null
  if (state.me) render()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.drawer) { state.drawer = null; render() }
})

try {
  const res = await fetch('/api/auth/me', { credentials: 'same-origin' })
  if (res.ok) {
    state.me = (await res.json()).user
    await start()
  } else {
    renderLogin()
  }
} catch {
  renderLogin()
}
