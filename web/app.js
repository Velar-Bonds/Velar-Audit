import { icon } from './icons.js'
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

const PER_PAGE = 10
const root = document.getElementById('root')

/* ══ Utilidades ════════════════════════════════════════════════════════════ */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const money = (n) => `$${Number(n).toLocaleString('es-CR', { maximumFractionDigits: 0 })}`
const money2 = (n) => Number(n).toLocaleString('es-CR', { maximumFractionDigits: 2 })
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10)

const shortHash = (h) => (!h ? '—' : h.length > 14 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h)

const dateTime = (ms) =>
  new Date(ms).toLocaleString('es-CR', { dateStyle: 'medium', timeStyle: 'short' })
const timeOnly = (ms) => new Date(ms).toLocaleTimeString('es-CR', { hour12: true })

/** Human status for a row, folding "returned" over the compliance verdict. */
function statusOf(row) {
  if (row.returnAction?.status === 'returned') return 'returned'
  return row.verdict?.status ?? 'unscored'
}

const STATUS_LABEL = {
  verified: 'Verificada', pending: 'Pendiente', non_compliant: 'No conforme',
  returned: 'Devuelta', unscored: 'Sin evaluar',
}

/**
 * Display reference, derived from the donation id itself.
 *
 * It must not depend on position in the list: a party sees a subset of what the
 * tribunal sees, so numbering by row index gave the same donation two different
 * codes depending on who was looking. Two people cannot audit a donation they
 * cannot name the same way.
 */
const refOf = (id) => `VA-${String(id).replace(/^don_/, '').slice(0, 6).toUpperCase()}`

/** Highest severity present, used to rank what needs attention first. */
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
  setTimeout(() => el.remove(), 2600)
}

/* ══ API ═══════════════════════════════════════════════════════════════════ */

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'content-type': 'application/json' } : {},
    ...options,
  })
  if (res.status === 401) { renderLogin(); throw new Error('sesión expirada') }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error ?? `HTTP ${res.status}`)
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

/* ══ Login ═════════════════════════════════════════════════════════════════ */

const DEMO_ACCOUNTS = [
  ['tse@velar.cr', 'TSE'],
  ['alfa@velar.cr', 'Partido Alfa'],
  ['beta@velar.cr', 'Partido Beta'],
]

function renderLogin(error = '') {
  clearInterval(state.poll)
  state.poll = null
  state.me = null

  root.innerHTML = `
  <div class="auth-screen">
    <form class="card auth-card" id="loginForm">
      <div class="card-body">
        <div class="auth-brand">
          <span class="brand-mark">V</span>
          <div>
            <div class="brand-name">Velar Audit</div>
            <div style="font-size:12.5px;color:var(--text-muted)">Auditoría de donaciones</div>
          </div>
        </div>

        ${error ? `<div class="auth-error" role="alert">${esc(error)}</div>` : ''}

        <div class="field">
          <label for="email">Correo institucional</label>
          <input class="input" type="email" id="email" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">Contraseña</label>
          <input class="input" type="password" id="password" autocomplete="current-password" required>
        </div>

        <button class="btn primary block" type="submit" id="loginBtn">Entrar</button>

        <div class="demo-accounts">
          <div class="section-label">Cuentas de demo · velar-demo-2026</div>
          <div class="row">
            ${DEMO_ACCOUNTS.map(([email, label]) =>
              `<button type="button" class="btn sm" data-email="${esc(email)}">${esc(label)}</button>`).join('')}
          </div>
        </div>
      </div>
    </form>
  </div>`

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
      if (!res.ok) throw new Error(body.error ?? 'No se pudo iniciar sesión.')
      state.me = body.user
      await start()
    } catch (err) {
      renderLogin(err.message)
    }
  })
}

/* ══ Shell ═════════════════════════════════════════════════════════════════ */

const NAV = [
  { route: 'dashboard', label: 'Resumen', icon: 'layout' },
  { route: 'donations', label: 'Donaciones', icon: 'receipt', count: () => state.summary?.count },
  { route: 'compliance', label: 'Cumplimiento', icon: 'shield', count: () => attentionRows().length },
  { route: 'wallets', label: 'Billeteras', icon: 'wallet', count: () => state.wallets?.wallets.length },
]

const CRUMB = {
  dashboard: ['Resumen'], donations: ['Donaciones'], detail: ['Donaciones', 'Detalle'],
  compliance: ['Cumplimiento'], wallets: ['Billeteras'],
}

function renderShell(view, body) {
  const me = state.me
  const initials = me.email.slice(0, 2).toUpperCase()
  const roleLabel = me.role === 'tse' ? 'Tribunal Supremo de Elecciones' : (me.partyName ?? 'Partido')
  const crumbs = CRUMB[view] ?? ['Resumen']

  root.innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="brand-mark">V</span>
        <span class="brand-name">Velar Audit</span>
      </div>
      <nav class="nav" aria-label="Principal">
        <div class="nav-label">Supervisión</div>
        ${NAV.map((item) => {
          const active = view === item.route || (view === 'detail' && item.route === 'donations')
          const count = item.count?.()
          return `<button class="nav-item" data-route="${item.route}" ${active ? 'aria-current="page"' : ''}>
            ${icon(item.icon)}<span>${item.label}</span>
            ${count != null ? `<span class="nav-count">${count}</span>` : ''}
          </button>`
        }).join('')}
      </nav>
      <div class="sidebar-foot">
        <span class="env-pill">
          <span class="dot ${state.wallets?.demoMode ? '' : 'live'}"></span>
          ${state.wallets?.demoMode ? 'Modo demo' : 'WDK + QVAC en vivo'}
        </span>
      </div>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="crumbs">
          ${crumbs.map((c, i) =>
            `${i ? '<span class="sep">/</span>' : ''}<span class="${i === crumbs.length - 1 ? 'here' : ''}">${esc(c)}</span>`,
          ).join('')}
        </div>
        <div class="profile">
          <div class="profile-meta">
            <div class="name">${esc(me.email)}</div>
            <div class="role">${esc(roleLabel)}</div>
          </div>
          <span class="avatar">${esc(initials)}</span>
          <button class="icon-btn" id="logout" title="Salir" aria-label="Salir">${icon('logout')}</button>
        </div>
      </header>
      <main class="content">${body}</main>
    </div>
  </div>
  ${state.drawer ? renderDrawer(state.drawer) : ''}`

  root.querySelectorAll('[data-route]').forEach((btn) =>
    btn.addEventListener('click', () => go(btn.dataset.route)))

  root.querySelector('#logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    renderLogin()
  })

  wireView(view)
}

/* ══ Vista 1 · Resumen ═════════════════════════════════════════════════════ */

/** Daily totals for the activity chart, oldest first. */
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

/** Change against the previous window of the same length. */
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

const FLOW_NODES = [
  ['user', 'Donante', 'Envía la donación'],
  ['wallet', 'Billetera', 'WDK, autocustodia'],
  ['blocks', 'Cadena', 'Indexador on-chain'],
  ['fingerprint', 'Atestación', 'Hash, sin datos personales'],
  ['brain', 'QVAC', 'Modelo local'],
  ['badgeCheck', 'Evidencia', 'Anclada en cadena'],
]

function viewDashboard() {
  const s = state.summary
  const change = periodChange()
  const scored = s.verified + s.pending + s.non_compliant

  const kpis = [
    { label: 'Total recibido', value: money(s.totalDecimal),
      foot: change === null ? `${s.count} donaciones` : `${change >= 0 ? '+' : ''}${change}% vs. período anterior`,
      tone: change === null ? '' : change >= 0 ? 'up' : 'err', icon: change === null ? null : 'trendUp' },
    { label: 'Verificadas', value: `${pct(s.verified, scored)}%`,
      foot: `${s.verified} donaciones verificadas`, tone: '' },
    { label: 'En revisión', value: String(s.pending),
      foot: 'Requieren atestación', tone: 'warn', icon: 'clock' },
    { label: 'No conformes', value: String(s.non_compliant),
      foot: 'Alerta de cumplimiento activa', tone: 'err', icon: 'alert' },
  ]

  const donutSlices = [
    { label: 'Verificadas', value: s.verified, color: '#12B76A' },
    { label: 'Pendientes', value: s.pending, color: '#F79009' },
    { label: 'No conformes', value: s.non_compliant, color: '#F04438' },
  ]

  const recent = state.rows.slice(0, 6)

  return `
  <div class="view-head">
    <div>
      <h1>Auditoría de donaciones</h1>
      <p class="sub">Financiamiento político transparente con evidencia verificable.</p>
    </div>
    <div class="actions">
      <button class="btn" data-route="compliance">${icon('shield')} Ver cumplimiento</button>
      <button class="btn" data-route="wallets">${icon('wallet')} Billeteras</button>
      ${state.me.role === 'tse'
        ? `<button class="btn ghost-accent" id="runDemo">${icon('play')} Recargar demo</button>` : ''}
    </div>
  </div>

  <div class="stack">
    <section class="grid kpis">
      ${kpis.map((k) => `
        <div class="card kpi">
          <div class="label">${k.label}</div>
          <div class="value">${k.value}</div>
          <div class="foot ${k.tone}">${k.icon ? icon(k.icon) : ''}${esc(k.foot)}</div>
        </div>`).join('')}
    </section>

    <section class="grid split">
      <div class="card">
        <div class="card-head">
          <div><h2>Actividad de donaciones</h2><div class="sub">Últimos 7 días</div></div>
        </div>
        <div class="card-body">${areaChart(activitySeries())}</div>
      </div>

      <div class="card">
        <div class="card-head"><h2>Estado de cumplimiento</h2></div>
        <div class="card-body">
          ${donutChart(donutSlices)}
          <ul class="legend">
            ${donutSlices.map((slice) => `
              <li>
                <span class="swatch" style="background:${slice.color}"></span>
                ${slice.label}
                <span class="pct">${pct(slice.value, scored)}%</span>
              </li>`).join('')}
          </ul>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div><h2>Flujo de verificación</h2>
        <div class="sub">Cada paso deja un hash anclado en cadena</div></div>
      </div>
      <div class="card-body">
        <div class="flow">
          <div class="flow-track">
            <div class="flow-line"><span class="flow-pip"></span></div>
            ${FLOW_NODES.map(([ic, title, desc]) => `
              <div class="flow-node">
                <div class="flow-icon">${icon(ic)}</div>
                <div class="t">${title}</div>
                <div class="d">${desc}</div>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div><h2>Donaciones recientes</h2></div>
        <button class="btn sm" data-route="donations">Ver todas ${icon('arrowRight')}</button>
      </div>
      ${donationTable(recent, { compact: true })}
    </section>
  </div>`
}

/* ══ Tabla reutilizable ════════════════════════════════════════════════════ */

function donationTable(rows, { compact = false } = {}) {
  const showParty = state.me.role === 'tse'

  if (rows.length === 0) {
    return `<div class="empty">${icon('inbox')}<div>No hay donaciones que coincidan.</div></div>`
  }

  return `
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Referencia</th>
          <th>Transacción</th>
          ${showParty ? '<th>Partido</th>' : ''}
          <th class="num">Monto</th>
          <th>Activo</th>
          ${compact ? '' : '<th>Origen</th>'}
          <th>Atestación</th>
          <th>Estado</th>
          <th>Recibida</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const d = row.donation
          const status = statusOf(row)
          return `
          <tr class="clickable" data-donation="${esc(d.id)}">
            <td class="strong">${esc(refOf(d.id))}</td>
            <td class="mono">${esc(shortHash(d.txHash))}</td>
            ${showParty ? `<td>${esc(state.parties[d.partyId] ?? d.partyId)}</td>` : ''}
            <td class="num strong">${money2(d.amountDecimal)}</td>
            <td>${esc(d.asset)}</td>
            ${compact ? '' : `<td>${row.attestation ? esc(row.attestation.donorCountry) : '<span style="color:var(--text-faint)">—</span>'}</td>`}
            <td class="mono">${row.attestation ? esc(shortHash(row.attestation.hash)) : '<span style="color:var(--text-faint)">pendiente</span>'}</td>
            <td><span class="badge ${status}">${STATUS_LABEL[status]}</span></td>
            <td style="color:var(--text-muted);white-space:nowrap">${esc(dateTime(d.receivedAt))}</td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div>`
}

/* ══ Vista 2 · Donaciones ══════════════════════════════════════════════════ */

function filteredRows() {
  const { q, status, asset } = state.filters
  const needle = q.trim().toLowerCase()

  return state.rows.filter((row) => {
    if (status !== 'all' && statusOf(row) !== status) return false
    if (asset !== 'all' && row.donation.asset !== asset) return false
    if (!needle) return true

    const haystack = [
      refOf(row.donation.id), row.donation.txHash, row.donation.fromAddress,
      row.attestation?.donorCountry, state.parties[row.donation.partyId],
    ].filter(Boolean).join(' ').toLowerCase()
    return haystack.includes(needle)
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
    <div>
      <h1>Donaciones</h1>
      <p class="sub">${rows.length} de ${state.rows.length} donaciones${
        state.me.role === 'tse' ? ' en todos los partidos' : ` de ${esc(state.me.partyName ?? '')}`}.</p>
    </div>
  </div>

  <div class="card">
    <div class="card-head" style="flex-direction:column;align-items:stretch;gap:16px">
      <div class="tabs" role="tablist">
        ${TABS.map(([key, label]) => `
          <button class="tab" role="tab" data-tab="${key}"
            aria-selected="${state.filters.status === key}">${label} (${counts[key] ?? 0})</button>`).join('')}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <label class="search">
          ${icon('search')}
          <input class="input" id="q" type="search" placeholder="Buscar referencia, hash o dirección"
                 value="${esc(state.filters.q)}" aria-label="Buscar donaciones">
        </label>
        <select class="select" id="assetFilter" aria-label="Filtrar por activo">
          <option value="all">Todos los activos</option>
          ${assets.map((a) => `<option value="${esc(a)}" ${state.filters.asset === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
    </div>

    ${donationTable(slice)}

    <div class="pager">
      <span>Página ${page} de ${pages}</span>
      <div style="display:flex;gap:8px">
        <button class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>
          ${icon('chevronLeft')} Anterior</button>
        <button class="btn sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>
          Siguiente ${icon('chevronRight')}</button>
      </div>
    </div>
  </div>`
}

/* ══ Vista 2b · Detalle ════════════════════════════════════════════════════ */

function viewDetail(id) {
  const row = state.rows.find((r) => r.donation.id === id)
  if (!row) {
    return `<div class="card"><div class="empty">${icon('inbox')}
      <div>Esa donación no existe o no pertenece a tu partido.</div>
      <button class="btn sm" data-route="donations" style="margin-top:14px">Volver</button></div></div>`
  }

  const { donation: d, attestation: a, verdict: v, returnAction: r, anchors } = row
  const status = statusOf(row)
  const attAnchor = anchors.find((x) => x.kind === 'attestation')
  const verdictAnchor = anchors.filter((x) => x.kind === 'verdict').at(-1)
  const returnAnchor = anchors.find((x) => x.kind === 'return')

  const step = (ic, done, title, when, facts, extra = '') => `
    <div class="tl-step">
      <div class="tl-dot ${done ? 'done' : ''}">${icon(ic)}</div>
      <h3>${title}</h3>
      <div class="when">${when}</div>
      ${facts ? `<dl class="tl-facts">${facts}</dl>` : ''}
      ${extra}
    </div>`

  const fact = (k, val) => `<div><dt>${k}</dt><dd>${val}</dd></div>`

  const checks = (v?.findings ?? []).map((f) => {
    const tone = f.severity === 'violation' ? 'bad' : f.severity === 'warning' ? 'warn' : 'ok'
    const ic = f.severity === 'violation' ? 'xCircle' : f.severity === 'warning' ? 'alert' : 'check'
    return `<li><span class="${tone}">${icon(ic)}</span><span>${esc(f.message)}</span></li>`
  }).join('')

  return `
  <div class="view-head">
    <div>
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h1>${esc(refOf(d.id))}</h1>
        <span class="badge ${status}">${STATUS_LABEL[status]}</span>
      </div>
      <p class="sub">${money2(d.amountDecimal)} ${esc(d.asset)} ·
        ${esc(state.parties[d.partyId] ?? d.partyId)}</p>
    </div>
    <div class="actions">
      <button class="btn" data-route="donations">${icon('chevronLeft')} Volver</button>
      ${status === 'non_compliant'
        ? `<button class="btn danger" data-return="${esc(d.id)}">${icon('undo')} Iniciar devolución</button>` : ''}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>Trazabilidad</h2></div>
    <div class="card-body">
      <div class="timeline">
        ${step('inbox', true, 'Donación recibida', dateTime(d.receivedAt),
          fact('Monto', `${money2(d.amountDecimal)} ${esc(d.asset)}`) +
          fact('Dirección de origen', `<span class="mono">${esc(d.fromAddress)}</span>`) +
          fact('Hora', esc(timeOnly(d.receivedAt))))}

        ${step('blocks', true, 'Confirmada en cadena', esc(d.chain),
          fact('Red', esc(d.chain)) +
          fact('Transacción', `<span class="mono">${esc(shortHash(d.txHash))}</span>`) +
          fact('Bloque', d.blockNumber ? `#${d.blockNumber}` : '<span style="color:var(--text-faint)">simulado</span>'))}

        ${a
          ? step('fingerprint', true, 'Atestación vinculada', dateTime(a.issuedAt),
              fact('Hash de atestación', `<span class="mono">${esc(shortHash(a.hash))}</span>`) +
              fact('País del donante', esc(a.donorCountry)) +
              fact('Origen de fondos', esc(a.sourceOfFunds)) +
              fact('KYC', a.kycVerified ? 'Verificado' : 'No verificado'),
              `<p class="note">${icon('lock')}
                <span>No se almacena ninguna información personal del donante en la cadena.
                Solo el hash de la atestación, que el proveedor puede reproducir.</span></p>`)
          : step('fingerprint', false, 'Atestación pendiente',
              'El proveedor de KYC aún no ha emitido la atestación', '')}

        ${v
          ? step('brain', v.status !== 'non_compliant', 'Análisis de cumplimiento',
              `${dateTime(v.evaluatedAt)} · motor ${v.engine === 'qvac' ? 'QVAC local' : 'de reglas'}`,
              fact('Resultado', `<span class="badge ${v.status}">${STATUS_LABEL[v.status]}</span>`) +
              fact('Motor', v.engine === 'qvac' ? 'Modelo local (QVAC)' : 'Reglas deterministas') +
              fact('Reglas evaluadas', String(v.findings.length)),
              (v.rationale ? `<p class="note">${icon('brain')}<span>${esc(v.rationale)}</span></p>` : '') +
              `<ul class="checks">${checks}</ul>`)
          : ''}

        ${step('shield', anchors.length > 0, 'Evidencia de auditoría',
          `${anchors.length} anclaje${anchors.length === 1 ? '' : 's'} en cadena`,
          (attAnchor ? fact('Hash de atestación', `<span class="mono">${esc(shortHash(attAnchor.subjectHash))}</span>`) : '') +
          (verdictAnchor ? fact('Hash del veredicto', `<span class="mono">${esc(shortHash(verdictAnchor.subjectHash))}</span>`) : '') +
          (returnAnchor ? fact('Hash de devolución', `<span class="mono">${esc(shortHash(returnAnchor.subjectHash))}</span>`) : '') +
          (anchors[0] ? fact('Transacción de anclaje', `<span class="mono">${esc(shortHash(anchors[0].txRef))}</span>${anchors[0].simulated ? ' <span style="color:var(--text-faint)">(simulada)</span>' : ''}`) : ''))}

        ${r?.status === 'returned'
          ? step('undo', true, 'Devolución ejecutada', dateTime(r.executedAt),
              fact('Motivo', esc(r.reason)) +
              fact('Transacción del reembolso', `<span class="mono">${esc(shortHash(r.refundTxRef))}</span>`))
          : ''}
      </div>
    </div>
  </div>`
}

/* ══ Vista 3 · Cumplimiento ════════════════════════════════════════════════ */

/** Rows that a human still has to decide something about, worst first. */
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
  const agentLabel = usedAgent ? 'Corriendo localmente' : 'Motor de reglas (modelo no disponible)'
  const sinceLast = lastVerdict
    ? `${Math.max(1, Math.round((Date.now() - lastVerdict) / 1000))} s`
    : '—'

  return `
  <div class="view-head">
    <div>
      <h1>Centro de cumplimiento</h1>
      <p class="sub">Análisis local, sin enviar datos de KYC a ninguna nube.</p>
    </div>
  </div>

  <div class="stack">
    <section class="card">
      <div class="card-head">
        <div>
          <h2 style="display:flex;align-items:center;gap:10px">
            ${icon('brain')} Agente de cumplimiento QVAC
          </h2>
          <div class="sub">Qwen3 4B · el veredicto lo decide el motor de reglas</div>
        </div>
        <span class="env-pill">
          <span class="dot ${usedAgent ? 'live' : ''}" ${usedAgent ? '' : 'style="background:var(--text-faint)"'}></span>
          ${agentLabel}
        </span>
      </div>
      <div class="card-body">
        <div class="agent-metrics">
          <div class="m"><div class="k">${state.rows.length}</div><div class="v">donaciones procesadas</div></div>
          <div class="m"><div class="k">${sinceLast}</div><div class="v">desde el último análisis</div></div>
          <div class="m"><div class="k">0</div><div class="v">datos enviados a la nube</div></div>
        </div>
        <div class="progress" id="analysisBar"><i></i></div>
        <button class="btn primary block" id="runAnalysis">${icon('refresh')} Re-analizar todas las donaciones</button>
        <p class="note" style="margin-top:14px">${icon('info')}
          <span>El modelo redacta el razonamiento que lee el auditor; nunca decide la legalidad.
          Un veredicto con consecuencia legal debe ser reproducible por un regulador.</span></p>
      </div>
    </section>

    <section class="card">
      <div class="card-head">
        <div><h2>Requiere atención</h2>
        <div class="sub">${attention.length} donacion${attention.length === 1 ? '' : 'es'} sin resolver</div></div>
      </div>
      ${attention.length === 0
        ? `<div class="empty">${icon('badgeCheck')}<div>Nada pendiente. Todas las donaciones están conformes.</div></div>`
        : attention.slice(0, 12).map((row) => {
            const risk = riskOf(row)
            const worst = (row.verdict?.findings ?? [])
              .find((f) => f.severity === 'violation') ?? row.verdict?.findings?.[0]
            return `
            <div class="alert-row">
              <div class="who">
                <div class="id">${esc(refOf(row.donation.id))}</div>
                <div class="amt">${money2(row.donation.amountDecimal)} ${esc(row.donation.asset)}</div>
              </div>
              <span class="risk ${risk === 'high' ? 'high' : 'medium'}">
                ${risk === 'high' ? 'Riesgo alto' : 'Riesgo medio'}</span>
              <div class="why">${esc(worst?.message ?? 'Sin hallazgos registrados.')}</div>
              <button class="btn sm" data-review="${esc(row.donation.id)}">Revisar</button>
            </div>`
          }).join('')}
    </section>
  </div>`
}

function renderDrawer(id) {
  const row = state.rows.find((r) => r.donation.id === id)
  if (!row) return ''

  const { donation: d, attestation: a, verdict: v } = row
  const status = statusOf(row)
  const risk = riskOf(row)

  const fact = (k, val) => `<div><dt>${k}</dt><dd>${val}</dd></div>`

  return `
  <div class="scrim" data-close-drawer></div>
  <aside class="drawer" role="dialog" aria-modal="true" aria-label="Revisión de cumplimiento">
    <div class="drawer-head">
      <div>
        <h2 style="font-size:16px;font-weight:600">Revisión · ${esc(refOf(d.id))}</h2>
        <div style="font-size:12.5px;color:var(--text-muted);margin-top:2px">
          ${esc(state.parties[d.partyId] ?? d.partyId)}</div>
      </div>
      <button class="icon-btn" data-close-drawer aria-label="Cerrar">${icon('x')}</button>
    </div>

    <div class="drawer-body">
      <div>
        <div class="section-label">Donación</div>
        <dl class="facts">
          ${fact('Monto', `${money2(d.amountDecimal)} ${esc(d.asset)}`)}
          ${fact('Red', esc(d.chain))}
          ${fact('Origen', `<span class="mono">${esc(shortHash(d.fromAddress))}</span>`)}
          ${fact('Recibida', esc(dateTime(d.receivedAt)))}
        </dl>
      </div>

      ${a ? `
      <div>
        <div class="section-label">Atestación</div>
        <dl class="facts">
          ${fact('País', esc(a.donorCountry))}
          ${fact('KYC', a.kycVerified ? 'Verificado' : 'No verificado')}
          ${fact('Origen de fondos', esc(a.sourceOfFunds))}
          ${fact('PEP', a.isPep ? 'Sí' : 'No')}
        </dl>
      </div>` : `
      <div>
        <div class="section-label">Atestación</div>
        <p style="font-size:13px;color:var(--text-muted)">
          El proveedor de KYC aún no ha emitido la atestación de esta donación.</p>
      </div>`}

      <div>
        <div class="section-label">Análisis</div>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span class="badge ${status}">${STATUS_LABEL[status]}</span>
          ${risk ? `<span class="risk ${risk}">${risk === 'high' ? 'Riesgo alto' : 'Riesgo medio'}</span>` : ''}
        </div>
        ${v?.rationale ? `<p style="font-size:13px;color:var(--text-2);margin-bottom:12px">${esc(v.rationale)}</p>` : ''}
        <ul class="checks">
          ${(v?.findings ?? []).map((f) => {
            const tone = f.severity === 'violation' ? 'bad' : f.severity === 'warning' ? 'warn' : 'ok'
            const ic = f.severity === 'violation' ? 'xCircle' : f.severity === 'warning' ? 'alert' : 'check'
            return `<li><span class="${tone}">${icon(ic)}</span><span>${esc(f.message)}</span></li>`
          }).join('')}
        </ul>
      </div>
    </div>

    <div class="drawer-foot">
      <button class="btn" data-detail="${esc(d.id)}">Ver detalle</button>
      <button class="btn primary" data-rescore="${esc(d.id)}">Re-evaluar</button>
      ${status === 'non_compliant'
        ? `<button class="btn danger" data-return="${esc(d.id)}">Devolver</button>` : ''}
    </div>
  </aside>`
}

/* ══ Vista 4 · Billeteras ══════════════════════════════════════════════════ */

const PRIVATE_ITEMS = [
  ['user', 'Identidad del donante'],
  ['receipt', 'Documentos de KYC'],
  ['wallet', 'Origen de fondos'],
  ['lock', 'Información personal'],
]
const PUBLIC_ITEMS = [
  ['blocks', 'Hash de la transacción'],
  ['fingerprint', 'Hash de la atestación'],
  ['shield', 'Resultado de cumplimiento'],
  ['clock', 'Marca de tiempo'],
  ['undo', 'Evidencia de devolución'],
]

function viewWallets() {
  const w = state.wallets
  const decimals = w.token.decimals
  const fromBase = (raw, dec) => Number(BigInt(raw ?? '0')) / 10 ** dec

  return `
  <div class="view-head">
    <div>
      <h1>Billeteras</h1>
      <p class="sub">Autocustodia sobre WDK. Ningún custodio se interpone entre el donante y el partido.</p>
    </div>
  </div>

  <div class="stack">
    <section class="grid thirds">
      ${w.wallets.map((wallet) => {
        const native = fromBase(wallet.balances?.native, 18)
        const token = fromBase(wallet.balances?.token, decimals)
        return `
        <div class="card wallet-card">
          <div class="card-body">
            <div class="top">
              <div class="chain-icon">${icon('ethereum')}</div>
              <span class="badge verified plain" style="gap:6px">
                <span class="dot"></span>Activa</span>
            </div>
            <div class="amount">${money2(token)} ${esc(w.token.symbol)}</div>
            <div class="fiat">${native.toFixed(4)} ETH · ${esc(wallet.partyName)}</div>
            <div class="addr">
              <code title="${esc(wallet.address)}">${esc(wallet.address)}</code>
              <button class="icon-btn" data-copy="${esc(wallet.address)}"
                      aria-label="Copiar dirección">${icon('copy')}</button>
            </div>
            <div class="wallet-foot">
              <span>Infraestructura: WDK</span>
              <span>Cuenta #${wallet.walletIndex}</span>
            </div>
          </div>
        </div>`
      }).join('')}
    </section>

    <section class="card">
      <div class="card-head">
        <div><h2>Evidencia sin exposición</h2>
        <div class="sub">Qué queda fuera de la cadena y qué queda dentro</div></div>
      </div>
      <div class="card-body">
        <div class="privacy">
          <div class="privacy-col off">
            <div class="head">${icon('lock')}<h3>Privado · fuera de cadena</h3></div>
            <p class="cap">Custodiado por el proveedor de KYC. Nunca entra a este sistema.</p>
            <ul class="privacy-list">
              ${PRIVATE_ITEMS.map(([ic, label]) => `<li>${icon(ic)}<span>${label}</span></li>`).join('')}
            </ul>
          </div>

          <div class="transform">
            <div class="step">Dato sensible</div>
            ${icon('arrowDown')}
            <div class="step mid">SHA-256</div>
            ${icon('arrowDown')}
            <div class="step">Evidencia verificable</div>
          </div>

          <div class="privacy-col on">
            <div class="head">${icon('shield')}<h3>Verificable · en cadena</h3></div>
            <p class="cap">Público y reproducible por cualquiera, incluido el TSE.</p>
            <ul class="privacy-list">
              ${PUBLIC_ITEMS.map(([ic, label]) => `<li>${icon(ic)}<span>${label}</span></li>`).join('')}
            </ul>
          </div>
        </div>
      </div>
    </section>
  </div>`
}

/* ══ Router ════════════════════════════════════════════════════════════════ */

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
  // Navigation buttons appear in several views, so they are wired centrally.
  root.querySelectorAll('[data-route]').forEach((el) =>
    el.addEventListener('click', () => go(el.dataset.route)))

  root.querySelectorAll('[data-donation]').forEach((el) =>
    el.addEventListener('click', () => go('donations', el.dataset.donation)))

  root.querySelectorAll('[data-detail]').forEach((el) =>
    el.addEventListener('click', () => { state.drawer = null; go('donations', el.dataset.detail) }))

  root.querySelectorAll('[data-copy]').forEach((el) =>
    el.addEventListener('click', async (e) => {
      e.stopPropagation()
      try {
        await navigator.clipboard.writeText(el.dataset.copy)
        toast('Dirección copiada')
      } catch {
        toast('No se pudo copiar')
      }
    }))

  root.querySelectorAll('[data-return]').forEach((el) =>
    el.addEventListener('click', async (e) => {
      e.stopPropagation()
      el.disabled = true
      try {
        await api(`/api/donations/${el.dataset.return}/return`, { method: 'POST' })
        toast('Devolución ejecutada y anclada en cadena')
        state.drawer = null
        await refresh(); render()
      } catch (err) { toast(err.message) }
    }))

  root.querySelectorAll('[data-rescore]').forEach((el) =>
    el.addEventListener('click', async () => {
      el.disabled = true
      try {
        await api(`/api/donations/${el.dataset.rescore}/score`, { method: 'POST' })
        toast('Donación re-evaluada')
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
      toast('Escenario recargado')
    } catch (err) { toast(err.message); demo.disabled = false }
  })
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
    // Re-rendering replaces the input, so restore focus and caret.
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
    if (pending.length === 0) { toast('No hay nada por re-analizar'); button.disabled = false; return }

    let done = 0
    for (const row of pending) {
      try { await api(`/api/donations/${row.donation.id}/score`, { method: 'POST' }) } catch { /* sigue */ }
      done++
      bar.style.width = `${Math.round((done / pending.length) * 100)}%`
    }

    await refresh()
    toast(`${done} donacion${done === 1 ? '' : 'es'} re-analizada${done === 1 ? '' : 's'}`)
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
    // while a drawer is open or a filter is being typed into.
    if (state.drawer || document.activeElement?.id === 'q') return
    try { await refresh(); render() } catch { /* la sesión se maneja en api() */ }
  }, 8000)
}

window.addEventListener('hashchange', () => {
  // A drawer belongs to the view that opened it. Leaving it up across a route
  // change strands a panel about a donation over a page that is not about it.
  state.drawer = null
  if (state.me) render()
})

// Escape closes the drawer, which is what every dialog on the web does.
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
