import { areaChart, donutChart } from './charts.js'

/* ══ State ═════════════════════════════════════════════════════════════════ */

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

/* ══ Helpers ═══════════════════════════════════════════════════════════════ */

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

const money = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
const money2 = (n) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })
const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10)

const shortHash = (h) => (!h ? 'none' : h.length > 16 ? `${h.slice(0, 8)}…${h.slice(-4)}` : h)

const longDate = (ms) =>
  new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

const dateTime = (ms) => {
  const d = new Date(ms)
  return `${longDate(ms)}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Stable reference, derived from the id rather than from list position. */
const refOf = (id) => `VA-${String(id).replace(/^don_/, '').slice(0, 6).toUpperCase()}`

function statusOf(row) {
  if (row.returnAction?.status === 'returned') return 'returned'
  return row.verdict?.status ?? 'unscored'
}

const STATUS_LABEL = {
  verified: 'Verified', pending: 'Pending', non_compliant: 'Non-compliant',
  returned: 'Returned', unscored: 'Not assessed',
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
  if (res.status === 401) { renderLogin(); throw new Error('Your session has expired.') }
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

/* ══ Sign in ═══════════════════════════════════════════════════════════════ */

const DEMO_ACCOUNTS = [
  ['tse@velar.cr', 'Electoral tribunal'],
  ['alfa@velar.cr', 'Alfa Party'],
  ['beta@velar.cr', 'Beta Party'],
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
          <div class="body-s secondary">Donation auditability</div>
        </div>
      </div>

      <div class="block">
        ${error ? `
        <div class="error-summary" role="alert" tabindex="-1" id="errorSummary">
          <h2>There is a problem</h2>
          <p>${esc(error)}</p>
        </div>` : ''}

        <h1 class="heading-l">Sign in</h1>
        <p class="secondary body-s" style="margin:4px 0 24px">
          Use the institutional account your organisation issued you.</p>

        <div class="field${error ? ' has-error' : ''}">
          <label for="email">Email address</label>
          <input class="input" type="email" id="email" autocomplete="username" required>
        </div>

        <div class="field${error ? ' has-error' : ''}">
          <label for="password">Password</label>
          <input class="input" type="password" id="password" autocomplete="current-password" required>
        </div>

        <button class="btn btn-full" type="submit" id="loginBtn">Sign in</button>

        <hr class="rule" style="margin:24px 0 20px">

        <h2 class="heading-s">Demonstration accounts</h2>
        <p class="body-s secondary" style="margin:2px 0 12px">
          All three use the password <span class="mono">velar-demo-2026</span>.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${DEMO_ACCOUNTS.map(([email, label]) =>
            `<button type="button" class="btn secondary sm"
              data-email="${esc(email)}">${esc(label)}</button>`).join('')}
        </div>

        <hr class="rule" style="margin:24px 0 16px">
        <p class="body-s">
          Want to donate to a party?
          <button type="button" class="btn-link" id="goDonate">You do not need an account</button>.
        </p>
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

  root.querySelector('#goDonate')?.addEventListener('click', () => {
    location.hash = '#/donate'
    renderDonate()
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
      if (!res.ok) throw new Error(body.error ?? 'Could not sign you in.')
      state.me = body.user
      await start()
    } catch (err) {
      renderLogin(err.message)
    }
  })
}

/* ══ Public donation page ══════════════════════════════════════════════════ */

/**
 * Reachable without a session, and it should be.
 *
 * Someone donating has no reason to hold an account in the system that audits
 * the party. Only what is already public on-chain is published here: each
 * party's address and the network it operates on.
 */
async function renderDonate() {
  clearInterval(state.poll)
  state.poll = null

  let data
  try {
    data = await (await fetch('/api/public/parties')).json()
  } catch {
    root.innerHTML = '<div class="auth-screen"><p>Could not load this page.</p></div>'
    return
  }

  const isTestnet = data.network !== 'mainnet'

  root.innerHTML = `
  <a href="#main" class="skip-link">Skip to main content</a>

  <div class="navbar">
    <div class="navbar-inner">
      <button class="brand-link" data-goto-login aria-label="Velar Audit">
        <span class="brand-mark">V</span>
        <span>
          <span class="brand-name">Velar Audit</span><br>
          <span class="brand-sub">Supreme Electoral Tribunal of Costa Rica</span>
        </span>
      </button>
      <div class="navbar-right">
        <button class="btn secondary sm" data-goto-login>Institutional sign in</button>
      </div>
    </div>
  </div>

  <main id="main" class="content" style="max-width:1100px">
    <div class="view-head">
      <span class="caption">Donations</span>
      <h1 class="heading-xl">Donate to a political party</h1>
      <p class="lede">Donations go straight from your own wallet to the party's. There is no
        intermediary: neither this system nor any other platform ever holds the money.</p>
    </div>

    ${isTestnet ? `
    <div class="warning-text">
      <span class="mark" aria-hidden="true">!</span>
      <p><span class="sr">Warning: </span>This runs on <strong>${esc(data.network)}</strong>, a
        test network. The funds <strong>have no real value</strong>. Do not send mainnet
        ${esc(data.token.symbol)} to these addresses — it would be lost.</p>
    </div>` : ''}

    <div class="cols ${data.parties.length > 1 ? 'halves' : ''}" style="margin-bottom:32px">
      ${data.parties.map((party) => `
        <div class="wallet">
          <div class="sub">Political party</div>
          <h2 class="heading-l" style="margin-bottom:16px">${esc(party.name)}</h2>

          <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
            <img src="/api/public/qr/${esc(party.id)}.svg" width="150" height="150"
              alt="QR code holding the donation address for ${esc(party.name)}"
              style="border:1px solid var(--border);border-radius:8px;background:#fff">

            <div style="flex:1;min-width:15em">
              <p class="body-s secondary" style="margin-bottom:8px">
                Scan it with a mobile wallet, or copy the address.</p>
              <div class="addr" style="margin-top:0">
                <code>${esc(party.address)}</code>
                <button class="btn secondary sm" data-copy="${esc(party.address)}">Copy</button>
              </div>
            </div>
          </div>

          ${summaryList([
            ['Network', `${esc(data.chain)}, ${esc(data.network)}`],
            ['Accepted currency', esc(data.token.symbol)],
            ['Token contract', `<span class="mono">${esc(data.token.address || 'native currency')}</span>`],
          ])}
        </div>`).join('')}
    </div>

    <div class="block">
      <h2 class="heading-m">What happens after you donate</h2>
      <p class="caption">Every step is recorded, and anyone can check it.</p>
      <ol class="flow">
        ${[
          ['Your donation reaches the chain', 'The indexer detects and records it automatically. The party cannot leave it out.'],
          ['An attestation is requested', 'An external provider verifies identity and source of funds. Your personal data never enters this system.'],
          ['Compliance is assessed', 'Deterministic rules check nationality, the annual cap and the declared source.'],
          ['The evidence is anchored', 'Hash, timestamp and transaction reference, verifiable by the electoral tribunal.'],
        ].map(([t, d], i) => `
          <li class="flow-step">
            <div class="n">${i + 1}</div>
            <div class="t">${t}</div>
            <div class="d">${d}</div>
          </li>`).join('')}
      </ol>

      <div class="inset">
        <p>If a donation turns out to be non-compliant — for example if it comes from abroad,
        which is illegal in Costa Rica — the system flags it for return and the refund goes
        back to the address it came from.</p>
      </div>
    </div>
  </main>

  <div class="content body-s secondary" style="max-width:1100px;padding-top:0">
    <p>Velar Audit — donation auditability for political financing. Donors' personal data is
      stored neither in this system nor on the blockchain.</p>
  </div>`

  root.querySelectorAll('[data-goto-login]').forEach((el) =>
    el.addEventListener('click', () => { location.hash = ''; renderLogin() }))

  root.querySelectorAll('[data-copy]').forEach((el) =>
    el.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(el.dataset.copy)
        toast('Wallet address copied.')
      } catch {
        toast('Could not copy the address.')
      }
    }))
}

/* ══ Page shell ════════════════════════════════════════════════════════════ */

const NAV = [
  { route: 'dashboard', label: 'Overview' },
  { route: 'donations', label: 'Donations', count: () => state.summary?.count },
  { route: 'compliance', label: 'Compliance', count: () => attentionRows().length },
  { route: 'wallets', label: 'Wallets', count: () => state.wallets?.wallets.length },
  // Only the tribunal gets the audit surface; a party inspecting itself is not
  // an audit, and the view exists to be read by someone other than the audited.
  { route: 'audit', label: 'Audit view', tseOnly: true },
]

const CRUMBS = {
  dashboard: [['Overview', null]],
  donations: [['Donations', null]],
  detail: [['Donations', 'donations'], ['Donation detail', null]],
  compliance: [['Compliance', null]],
  wallets: [['Wallets', null]],
  audit: [['Audit view', null]],
}

function renderShell(view, body) {
  const me = state.me
  const org = me.role === 'tse' ? 'Supreme Electoral Tribunal' : (me.partyName ?? 'Political party')
  const crumbs = CRUMBS[view] ?? CRUMBS.dashboard
  const initials = me.email.slice(0, 2).toUpperCase()

  root.innerHTML = `
  <a href="#main" class="skip-link">Skip to main content</a>

  <div class="navbar">
    <div class="navbar-inner">
      <button class="brand-link" data-route="dashboard" aria-label="Velar Audit, go to overview">
        <span class="brand-mark">V</span>
        <span>
          <span class="brand-name">Velar Audit</span><br>
          <span class="brand-sub">Supreme Electoral Tribunal of Costa Rica</span>
        </span>
      </button>

      <div class="navbar-right">
        <span class="navbar-env">
          <span class="dot ${state.wallets?.demoMode ? '' : 'live'}"
            ${state.wallets?.demoMode ? 'style="background:var(--blue-300)"' : ''}></span>
          ${state.wallets?.demoMode ? 'Demonstration mode' : 'Live — WDK and local analysis'}
        </span>
        <span class="navbar-user">
          <span class="who">
            ${esc(me.email)}<br>
            <span class="org">${esc(org)}</span>
          </span>
          <span class="avatar" aria-hidden="true">${esc(initials)}</span>
        </span>
        <button class="btn secondary sm" id="logout">Sign out</button>
      </div>
    </div>
  </div>

  <nav class="section-nav" aria-label="Sections">
    <div class="inner">
      ${NAV.filter((item) => !item.tseOnly || me.role === 'tse').map((item) => {
        const active = view === item.route || (view === 'detail' && item.route === 'donations')
        const count = item.count?.()
        return `<button class="nav-item" data-route="${item.route}"
          ${active ? 'aria-current="page"' : ''}>
          <span>${item.label}</span>
          ${count != null ? `<span class="nav-count">${count}</span>` : ''}
        </button>`
      }).join('')}
    </div>
  </nav>

  <div class="shell">
    <header class="topbar">
      <nav class="breadcrumbs" aria-label="Breadcrumb">
        <ol>
          <li><button data-route="dashboard">Home</button></li>
          ${crumbs.map(([label, route]) =>
            `<li>${route
              ? `<button data-route="${route}">${esc(label)}</button>`
              : `<span aria-current="page">${esc(label)}</span>`}</li>`).join('')}
        </ol>
      </nav>
    </header>

    <div class="phase-banner">
      <strong class="tag returned">Beta</strong>
      <span>A service being built for the Supreme Electoral Tribunal of Costa Rica.
        ${state.wallets?.demoMode
          ? 'It is currently running against a simulated chain.'
          : 'Connected to the test network, with local analysis.'}</span>
    </div>

    <main id="main" class="content">${body}</main>
  </div>

  ${state.drawer ? renderDrawer(state.drawer) : ''}`

  root.querySelector('#logout').addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' })
    renderLogin()
  })

  wireView(view)
}

/* ══ Overview ══════════════════════════════════════════════════════════════ */

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
    label: new Date(day).toLocaleDateString('en-US', { weekday: 'short' }),
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
  ['The donor sends the money', 'Straight to the party wallet, with no intermediary.'],
  ['The party wallet receives it', 'Built with WDK, held in the party’s own custody.'],
  ['The indexer records it', 'It reads the chain directly. The party does not self-report.'],
  ['An attestation is linked', 'Only the hash. Personal data never enters the system.'],
  ['Compliance is assessed', 'Deterministic rules, explained by a local model.'],
  ['The evidence is anchored', 'Hash, timestamp and transaction reference, on-chain.'],
]

function viewDashboard() {
  const s = state.summary
  const change = periodChange()
  const scored = s.verified + s.pending + s.non_compliant

  const donutSlices = [
    { label: 'Verified', value: s.verified, color: '#0f7a52' },
    { label: 'Pending', value: s.pending, color: '#b56a00' },
    { label: 'Non-compliant', value: s.non_compliant, color: '#ca3535' },
  ]

  return `
  <div class="view-head">
    <span class="caption">${esc(state.me.role === 'tse'
      ? 'All political parties' : (state.me.partyName ?? ''))}</span>
    <h1 class="heading-xl">Donation auditability</h1>
    <p class="lede">Every donation is recorded from the moment it arrives until it is
      verified, flagged or returned. The evidence is public and verifiable; the identity of
      the person who donated is not.</p>
    <div class="actions">
      <button class="btn secondary" data-route="donations">View all donations</button>
      <button class="btn secondary" data-route="compliance">Review compliance</button>
      ${state.me.role === 'tse'
        ? '<button class="btn" id="runDemo">Reload demonstration data</button>' : ''}
    </div>
  </div>

  <div class="stack">
    <section aria-label="Headline figures">
      <ul class="stats">
        <li class="stat">
          <div class="k">Total received</div>
          <div class="v">${money(s.totalDecimal)}</div>
          <div class="n">${change === null
            ? `${s.count} donations in total`
            : `${change >= 0 ? 'Up' : 'Down'} ${Math.abs(change)}% on the previous week`}</div>
        </li>
        <li class="stat ok">
          <div class="k">Verified</div>
          <div class="v">${pct(s.verified, scored)}%</div>
          <div class="n">${s.verified} of ${scored} assessed donations</div>
        </li>
        <li class="stat warn">
          <div class="k">Awaiting review</div>
          <div class="v">${s.pending}</div>
          <div class="n">Waiting on the provider's attestation</div>
        </li>
        <li class="stat err">
          <div class="k">Non-compliant</div>
          <div class="v">${s.non_compliant}</div>
          <div class="n">Must be returned within the cure window</div>
        </li>
      </ul>
    </section>

    <section class="cols two-thirds">
      <div class="block">
        <h2 class="heading-m">Activity over the last 7 days</h2>
        <p class="caption">Amount received per day, in USDC.</p>
        ${areaChart(activitySeries())}
      </div>

      <div class="block">
        <h2 class="heading-m">Compliance status</h2>
        <p class="caption">Share of assessed donations.</p>
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
      <h2 class="heading-l">How a donation is verified</h2>
      <p class="secondary" style="margin:8px 0 20px">Each step leaves a hash anchored on the
        blockchain, so the whole sequence can be reconstructed afterwards.</p>
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
      <h2 class="heading-l" style="margin-bottom:16px">Recent donations</h2>
      <div class="table-card">
        ${donationTable(state.rows.slice(0, 8), { compact: true })}
        <div class="pager">
          <span>Showing the 8 most recent</span>
          <button class="btn-link" data-route="donations">View all ${s.count} donations</button>
        </div>
      </div>
    </section>
  </div>`
}

/* ══ Donation table ════════════════════════════════════════════════════════ */

function donationTable(rows, { compact = false } = {}) {
  const showParty = state.me.role === 'tse'

  if (rows.length === 0) {
    return `<p class="empty">No donations match the filters you have applied.</p>`
  }

  return `
  <div class="table-wrap">
    <table>
      <caption class="sr">Donations</caption>
      <thead>
        <tr>
          <th scope="col">Reference</th>
          ${showParty ? '<th scope="col">Party</th>' : ''}
          <th scope="col" class="num">Amount</th>
          <th scope="col">Asset</th>
          ${compact ? '' : '<th scope="col">Country</th>'}
          <th scope="col">Attestation</th>
          <th scope="col">Status</th>
          <th scope="col">Received</th>
          <th scope="col"><span class="sr">Actions</span></th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const d = row.donation
          const status = statusOf(row)
          return `
          <tr>
            <th scope="row" style="font-weight:600">${esc(refOf(d.id))}</th>
            ${showParty ? `<td>${esc(state.parties[d.partyId] ?? d.partyId)}</td>` : ''}
            <td class="num">${money2(d.amountDecimal)}</td>
            <td>${esc(d.asset)}</td>
            ${compact ? '' : `<td>${row.attestation ? esc(row.attestation.donorCountry) : 'No data'}</td>`}
            <td class="mono">${row.attestation ? esc(shortHash(row.attestation.hash)) : 'Pending'}</td>
            <td><strong class="tag ${status}">${STATUS_LABEL[status]}</strong></td>
            <td class="nowrap">${esc(longDate(d.receivedAt))}</td>
            <td><button class="btn-link" data-donation="${esc(d.id)}">View<span class="sr">
              donation ${esc(refOf(d.id))}</span></button></td>
          </tr>`
        }).join('')}
      </tbody>
    </table>
  </div>`
}

/* ══ Donations ═════════════════════════════════════════════════════════════ */

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
    ['all', 'All'], ['verified', 'Verified'], ['pending', 'Pending'],
    ['non_compliant', 'Non-compliant'], ['returned', 'Returned'],
  ]

  return `
  <div class="view-head">
    <span class="caption">${esc(state.me.role === 'tse'
      ? 'All political parties' : (state.me.partyName ?? ''))}</span>
    <h1 class="heading-xl">Donations</h1>
    <p class="lede">Showing ${rows.length} of ${state.rows.length} donations.</p>
  </div>

  <div class="table-card">
    <div class="tabs" role="tablist">
      ${TABS.map(([key, label]) => `
        <button class="tab" role="tab" data-tab="${key}"
          aria-selected="${state.filters.status === key}">${label} (${counts[key] ?? 0})</button>`).join('')}
    </div>

    <div class="filter-bar">
      <div class="field">
        <label for="q">Search</label>
        <p class="hint">By reference, transaction hash or sending address.</p>
        <input class="input narrow" id="q" type="search" value="${esc(state.filters.q)}">
      </div>
      <div class="field">
        <label for="assetFilter">Asset</label>
        <select class="select" id="assetFilter" style="width:auto">
          <option value="all">All</option>
          ${assets.map((a) => `<option value="${esc(a)}"
            ${state.filters.asset === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
      </div>
    </div>

    ${donationTable(slice)}

    <div class="pager">
      <span>Page ${page} of ${pages}</span>
      <span style="display:flex;gap:8px">
        <button class="btn secondary sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
        <button class="btn secondary sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>
      </span>
    </div>
  </div>`
}

/* ══ Donation detail ═══════════════════════════════════════════════════════ */

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
      <h1 class="heading-xl">Donation not found</h1>
      <p class="lede">This donation does not exist, or it belongs to a party whose records
        you are not allowed to see.</p>
      <div class="actions">
        <button class="btn secondary" data-route="donations">Back to donations</button>
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
      <button class="btn secondary" data-route="donations">Back</button>
      ${status === 'non_compliant'
        ? `<button class="btn warning" data-return="${esc(d.id)}">Start the return</button>` : ''}
    </div>
  </div>

  <h2 class="heading-l" style="margin-bottom:24px">Traceability</h2>

  <ol class="timeline">
    ${step('done', 'Donation received', dateTime(d.receivedAt), summaryList([
      ['Amount', `${money2(d.amountDecimal)} ${esc(d.asset)}`],
      ['Sending address', `<span class="mono">${esc(d.fromAddress)}</span>`],
      ['Receiving party', esc(state.parties[d.partyId] ?? d.partyId)],
    ]))}

    ${step('done', 'Confirmed on the chain', `${esc(d.chain)} network`, summaryList([
      ['Transaction', `<span class="mono">${esc(d.txHash)}</span>`],
      ['Block', d.blockNumber ? String(d.blockNumber) : 'Simulated in demonstration mode'],
    ]))}

    ${a
      ? step('done', 'Attestation linked', dateTime(a.issuedAt),
          summaryList([
            ['Attestation hash', `<span class="mono">${esc(a.hash)}</span>`],
            ['Donor country', esc(a.donorCountry)],
            ['Source of funds', esc(a.sourceOfFunds)],
            ['Identity verified', a.kycVerified ? 'Yes' : 'No'],
            ['Politically exposed person', a.isPep ? 'Yes' : 'No'],
          ]) +
          `<div class="inset">
            <p>No personal data about the donor is stored on the blockchain. Only the hash of
            the attestation, which the provider can recompute to prove the document has not
            changed.</p>
          </div>`)
      : step('todo', 'Attestation pending',
          'The provider has not issued the attestation yet',
          `<div class="inset warn">
            <p>If the attestation does not arrive within the cure window, the donation becomes
            non-compliant and must be returned.</p>
          </div>`)}

    ${v ? step(v.status === 'non_compliant' ? 'todo' : 'done', 'Compliance assessment',
        dateTime(v.evaluatedAt),
        summaryList([
          ['Result', `<strong class="tag ${v.status}">${STATUS_LABEL[v.status]}</strong>`],
          ['Deciding engine', v.engine === 'qvac'
            ? 'Deterministic rules, explained by the local model'
            : 'Deterministic rules'],
          ['Rules applied', String(v.findings.length)],
        ]) +
        (v.rationale ? `<div class="inset"><p>${esc(v.rationale)}</p></div>` : '') +
        `<ul class="checks">${checks}</ul>`)
      : ''}

    ${step(anchors.length ? 'done' : 'todo', 'Audit evidence',
      `${anchors.length} ${anchors.length === 1 ? 'anchor' : 'anchors'} on the chain`,
      summaryList([
        attAnchor && ['Attestation hash', `<span class="mono">${esc(attAnchor.subjectHash)}</span>`],
        verdictAnchor && ['Verdict hash', `<span class="mono">${esc(verdictAnchor.subjectHash)}</span>`],
        returnAnchor && ['Return hash', `<span class="mono">${esc(returnAnchor.subjectHash)}</span>`],
        anchors[0] && ['Anchoring transaction',
          `<span class="mono">${esc(anchors[0].txRef)}</span>${
            anchors[0].simulated ? ' (simulated in demonstration mode)' : ''}`],
      ]))}

    ${r?.status === 'returned'
      ? step('done', 'Return executed', dateTime(r.executedAt), summaryList([
          ['Reason', esc(r.reason)],
          ['Refund transaction', `<span class="mono">${esc(r.refundTxRef)}</span>`],
        ]))
      : ''}
  </ol>`
}

/* ══ Compliance ════════════════════════════════════════════════════════════ */

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
    ? `${Math.max(1, Math.round((Date.now() - lastVerdict) / 1000))}s ago`
    : 'not run yet'

  return `
  <div class="view-head">
    <span class="caption">Compliance</span>
    <h1 class="heading-xl">Compliance centre</h1>
    <p class="lede">Analysis runs on this machine. No donor identification data is sent to
      any external service.</p>
  </div>

  <div class="stack">
    <section class="engine-panel">
      <div class="engine-head">
        <div>
          <h2 class="heading-m">QVAC compliance engine</h2>
          <p class="engine-sub">Local enforcement node · compliance evaluated on-premise,
            with zero external cloud exposure.</p>
        </div>
        <span class="engine-badge">
          <span class="dot ${usedAgent ? 'live' : ''}"></span>
          ${usedAgent ? 'Running locally' : 'Rules only — model unavailable'}
        </span>
      </div>

      <ul class="engine-metrics">
        <li><div class="k">Processing mode</div><div class="v">On-premise</div></li>
        <li><div class="k">Donations processed</div><div class="v">${state.rows.length}</div></li>
        <li><div class="k">Last assessment</div><div class="v">${sinceLast}</div></li>
        <li><div class="k">Data sent off-device</div><div class="v">None</div></li>
      </ul>

      <div class="progress" id="analysisBar"><i></i></div>
      <button class="btn" id="runAnalysis">Re-run ruleset evaluation</button>
    </section>

    <section class="warning-text">
      <span class="mark" aria-hidden="true">!</span>
      <p><span class="sr">Warning: </span>The model writes the explanation an auditor reads,
        but <strong>it does not decide whether something is legal</strong>. That decision is
        made by deterministic rules, because a ruling with a legal consequence must be
        reproducible by a regulator.</p>
    </section>

    <section>
      <h2 class="heading-l">Requires immediate action</h2>
      <p class="secondary" style="margin:8px 0 20px">
        ${attention.length === 0
          ? 'Nothing outstanding.'
          : `${attention.length} ${attention.length === 1 ? 'donation' : 'donations'} unresolved,
             ordered by risk.`}</p>

      ${attention.length === 0 ? '' : `
      <div class="risk-grid">
        ${attention.slice(0, 12).map((row) => {
          const risk = riskOf(row)
          const worst = (row.verdict?.findings ?? [])
            .find((f) => f.severity === 'violation') ?? row.verdict?.findings?.[0]
          return `
          <article class="risk-card">
            <div class="risk-head">
              <span class="ref">${esc(refOf(row.donation.id))}</span>
              <strong class="tag ${risk === 'high' ? 'high' : 'medium'}">
                ${risk === 'high' ? 'High risk' : 'Medium risk'}</strong>
            </div>
            <div class="risk-amount">${money2(row.donation.amountDecimal)} ${esc(row.donation.asset)}</div>
            <div class="risk-party">${esc(state.parties[row.donation.partyId] ?? '')}</div>
            <p class="risk-why">${esc(worst?.message ?? 'No findings recorded.')}</p>
            <button class="btn secondary sm" data-review="${esc(row.donation.id)}">Open audit drawer</button>
          </article>`
        }).join('')}
      </div>`}
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
        <h2 class="heading-m" id="drawerTitle">Compliance file review</h2>
        <p class="body-s secondary">${esc(refOf(d.id))} ·
          ${esc(state.parties[d.partyId] ?? d.partyId)}</p>
      </div>
      <button class="btn-link" data-close-drawer>Close</button>
    </div>

    <div class="drawer-body">
      <p style="margin-bottom:20px">
        <strong class="tag ${status}">${STATUS_LABEL[status]}</strong>
        ${risk ? ` <strong class="tag ${risk}">${risk === 'high' ? 'High risk' : 'Medium risk'}</strong>` : ''}
      </p>

      <h3 class="heading-s">Donation</h3>
      ${summaryList([
        ['Amount', `${money2(d.amountDecimal)} ${esc(d.asset)}`],
        ['Network', esc(d.chain)],
        ['Sending address', `<span class="mono">${esc(shortHash(d.fromAddress))}</span>`],
        ['Received', esc(dateTime(d.receivedAt))],
      ])}

      <h3 class="heading-s" style="margin-top:28px">Attestation</h3>
      ${a
        ? summaryList([
            ['Country', esc(a.donorCountry)],
            ['Identity verified', a.kycVerified ? 'Yes' : 'No'],
            ['Source of funds', esc(a.sourceOfFunds)],
            ['Politically exposed person', a.isPep ? 'Yes' : 'No'],
          ])
        : '<p style="margin-top:10px">The provider has not issued the attestation yet.</p>'}

      <h3 class="heading-s" style="margin-top:28px">Findings</h3>
      ${v?.rationale ? `<div class="inset"><p>${esc(v.rationale)}</p></div>` : ''}
      <ul class="checks">${checks}</ul>

      ${summaryList([
        ['Deciding engine', v?.engine === 'qvac'
          ? 'Deterministic rules, explained by the local model'
          : 'Deterministic rules'],
        ['Rules applied', String(v?.findings.length ?? 0)],
      ])}
    </div>

    <div class="drawer-foot">
      <button class="btn secondary" data-detail="${esc(d.id)}">View full file</button>
      <button class="btn secondary" data-rescore="${esc(d.id)}">Re-evaluate</button>
      ${status === 'non_compliant'
        ? `<button class="btn warning" data-return="${esc(d.id)}">Initiate mandatory return</button>` : ''}
    </div>
  </aside>`
}

/* ══ Wallets ═══════════════════════════════════════════════════════════════ */

const PRIVATE_ITEMS = [
  'Donor identity',
  'Identity verification file',
  'Declared source of funds',
  'Any other personal data',
]
const PUBLIC_ITEMS = [
  'Transaction hash',
  'Attestation hash',
  'Compliance result — pass or fail',
  'Timestamp',
  'Return evidence, where there was one',
]

function privacyDiagram() {
  return `
  <div class="privacy">
    <div class="privacy-col">
      <h3>Private · off-chain</h3>
      <p class="cap">Held by the identity verification provider under electoral data
        protection rules. It never enters this system.</p>
      <ul class="privacy-list">
        ${PRIVATE_ITEMS.map((label) => `<li>${label}</li>`).join('')}
      </ul>
    </div>

    <div class="transform" aria-hidden="true">
      <span class="step">Sensitive data</span>
      <span class="arrow">↓</span>
      <span class="step mid">SHA-256</span>
      <span class="arrow">↓</span>
      <span class="step">Verifiable proof</span>
    </div>

    <div class="privacy-col on">
      <h3>Publicly verifiable · on-chain</h3>
      <p class="cap">Anchored on-chain so anyone can check it, including the electoral
        tribunal and accredited observers.</p>
      <ul class="privacy-list">
        ${PUBLIC_ITEMS.map((label) => `<li>${label}</li>`).join('')}
      </ul>
    </div>
  </div>`
}

function viewWallets() {
  const w = state.wallets
  const fromBase = (raw, dec) => Number(BigInt(raw ?? '0')) / 10 ** dec

  return `
  <div class="view-head">
    <span class="caption">Custody</span>
    <h1 class="heading-xl">Wallets</h1>
    <p class="lede">Each party holds its own wallet. No exchange or custodian sits between
      the donor and the party, so nobody can move or hide a donation without it being
      recorded.</p>
  </div>

  <div class="stack">
    <section>
      <h2 class="heading-l" style="margin-bottom:20px">Party donation wallets</h2>
      <div class="cols ${w.wallets.length > 1 ? 'halves' : ''}">
        ${w.wallets.map((wallet) => {
          const native = fromBase(wallet.balances?.native, 18)
          const token = fromBase(wallet.balances?.token, w.token.decimals)
          return `
          <div class="wallet">
            <div class="sub">${esc(wallet.partyName)}</div>
            <div class="amount">${money2(token)} ${esc(w.token.symbol)}</div>
            <div class="sub">${native.toFixed(4)} ETH for network fees</div>
            <div class="addr">
              <code>${esc(wallet.address)}</code>
              <button class="btn secondary sm" data-copy="${esc(wallet.address)}">Copy</button>
            </div>
            ${summaryList([
              ['Status', '<strong class="tag verified">Active</strong>'],
              ['Network', `${esc(w.chain)}, ${esc(w.network)}`],
              ['Infrastructure', 'Wallet Development Kit (WDK)'],
              ['Derived account', `Index ${wallet.walletIndex}`],
            ])}
          </div>`
        }).join('')}
      </div>
      <div class="inset">
        <p>All wallets are derived from a single seed phrase, each with its own account
        index. A deployment covering many parties needs one seed rather than one per party,
        and donations still stay separated on-chain.</p>
      </div>
    </section>

    <section>
      <h2 class="heading-l">Evidence without exposure</h2>
      <p class="secondary" style="margin:8px 0 20px">What stays off the blockchain, and what
        is published on it.</p>
      ${privacyDiagram()}
    </section>
  </div>`
}

/* ══ Electoral authority audit view ════════════════════════════════════════ */

/**
 * The tribunal's own read-only surface.
 *
 * Everything here is derived from anchored evidence, and nothing on this screen
 * identifies a donor. That is the point: an observer should be able to check
 * the arithmetic of a party's financing without being handed its donor list.
 */
function viewAudit() {
  const rows = state.rows
  const totals = rows.reduce((acc, row) => {
    const amount = row.donation.amountDecimal
    acc.declared += amount
    if (row.anchors.some((a) => !a.simulated)) acc.anchored += amount
    if (statusOf(row) === 'non_compliant') acc.investigation += amount
    if (statusOf(row) === 'returned') acc.returned += amount
    return acc
  }, { declared: 0, anchored: 0, investigation: 0, returned: 0 })

  const parties = Object.entries(state.parties)

  return `
  <div class="view-head">
    <span class="caption">Electoral authority</span>
    <h1 class="heading-xl">Public audit view</h1>
    <p class="lede">Independent inspection for the Supreme Electoral Tribunal and accredited
      observers. Every figure below is derived from anchored evidence.</p>
    <p style="margin-top:12px">
      <strong class="tag returned">Read-only · official audit session</strong></p>
  </div>

  <div class="stack">
    <section class="filter-card">
      <div class="filter-bar" style="border:none;padding:0">
        <div class="field">
          <label for="auditParty">Political party</label>
          <select class="select" id="auditParty" style="width:auto">
            <option value="all">All parties</option>
            ${parties.map(([id, name]) =>
              `<option value="${esc(id)}">${esc(name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="auditPeriod">Electoral period</label>
          <select class="select" id="auditPeriod" style="width:auto">
            <option>2026</option>
          </select>
        </div>
        <div class="field">
          <label for="auditStatus">Compliance level</label>
          <select class="select" id="auditStatus" style="width:auto">
            <option value="all">All</option>
            <option value="verified">Verified</option>
            <option value="pending">Pending</option>
            <option value="non_compliant">Non-compliant</option>
            <option value="returned">Returned</option>
          </select>
        </div>
      </div>
    </section>

    <section aria-label="Public verification figures">
      <ul class="stats">
        <li class="stat">
          <div class="k">Total declared funds</div>
          <div class="v">${money(totals.declared)}</div>
          <div class="n">Across ${parties.length} registered parties</div>
        </li>
        <li class="stat ok">
          <div class="k">Anchored on-chain</div>
          <div class="v">${money(totals.anchored)}</div>
          <div class="n">Backed by a real anchoring transaction</div>
        </li>
        <li class="stat err">
          <div class="k">Under investigation</div>
          <div class="v">${money(totals.investigation)}</div>
          <div class="n">Flagged as non-compliant</div>
        </li>
        <li class="stat">
          <div class="k">Returned to source</div>
          <div class="v">${money(totals.returned)}</div>
          <div class="n">Refunded to the sending address</div>
        </li>
      </ul>
    </section>

    <section>
      <h2 class="heading-l" style="margin-bottom:16px">Audit evidence matrix</h2>
      <p class="secondary" style="margin-bottom:16px">The mathematical proof, without any
        private identity attached to it.</p>
      <div class="table-card">
        <div class="table-wrap">
          <table id="auditTable">
            <caption class="sr">Cryptographic evidence per donation</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">Receiving party</th>
                <th scope="col" class="num">Amount</th>
                <th scope="col">Attestation hash</th>
                <th scope="col">Legal status</th>
                <th scope="col">Certificate</th>
              </tr>
            </thead>
            <tbody>
              ${rows.slice(0, 25).map((row) => {
                const status = statusOf(row)
                return `
                <tr data-party="${esc(row.donation.partyId)}" data-status="${esc(status)}">
                  <th scope="row" style="font-weight:600">${esc(refOf(row.donation.id))}</th>
                  <td>${esc(state.parties[row.donation.partyId] ?? '')}</td>
                  <td class="num">${money2(row.donation.amountDecimal)}</td>
                  <td class="mono">${row.attestation
                    ? esc(shortHash(row.attestation.hash)) : 'Not issued'}</td>
                  <td><strong class="tag ${status}">${STATUS_LABEL[status]}</strong></td>
                  <td><button class="btn-link" data-cert="${esc(row.donation.id)}">
                    Download<span class="sr"> certificate for ${esc(refOf(row.donation.id))}</span>
                  </button></td>
                </tr>`
              }).join('')}
            </tbody>
          </table>
        </div>
        <div class="pager">
          <span>Showing ${Math.min(25, rows.length)} of ${rows.length} files</span>
        </div>
      </div>
    </section>

    <section>
      <h2 class="heading-l">Evidence without exposure</h2>
      <p class="secondary" style="margin:8px 0 20px">How a donation can be publicly proven
        without publishing who made it.</p>
      ${privacyDiagram()}
    </section>
  </div>`
}

/* ══ Routing ═══════════════════════════════════════════════════════════════ */

/** The donation page is the only route that does not require a session. */
function isPublicRoute() {
  return location.hash.replace(/^#\/?/, '').split('/')[0] === 'donate'
}

const ROUTES = ['dashboard', 'donations', 'compliance', 'wallets', 'audit']

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '')
  const [head, tail] = hash.split('/')
  if (head === 'donations' && tail) return { view: 'detail', id: tail }
  if (ROUTES.includes(head)) return { view: head }
  return { view: 'dashboard' }
}

function go(route, id) {
  location.hash = id ? `#/${route}/${id}` : `#/${route}`
}

function render() {
  if (isPublicRoute()) return renderDonate()
  if (!state.me) return renderLogin()
  const { view, id } = currentRoute()

  const body =
    view === 'donations' ? viewDonations()
    : view === 'detail' ? viewDetail(id)
    : view === 'compliance' ? viewCompliance()
    : view === 'wallets' ? viewWallets()
    : view === 'audit' ? viewAudit()
    : viewDashboard()

  renderShell(view, body)
}

/* ══ Events ════════════════════════════════════════════════════════════════ */

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
        toast('Wallet address copied.')
      } catch {
        toast('Could not copy the address.')
      }
    }))

  root.querySelectorAll('[data-return]').forEach((el) =>
    el.addEventListener('click', async () => {
      el.disabled = true
      try {
        await api(`/api/donations/${el.dataset.return}/return`, { method: 'POST' })
        toast('The return has been executed and its evidence anchored on the chain.')
        state.drawer = null
        await refresh(); render()
      } catch (err) { toast(err.message) }
    }))

  root.querySelectorAll('[data-rescore]').forEach((el) =>
    el.addEventListener('click', async () => {
      el.disabled = true
      try {
        await api(`/api/donations/${el.dataset.rescore}/score`, { method: 'POST' })
        toast('The donation has been re-assessed.')
        await refresh(); render()
      } catch (err) { toast(err.message) }
    }))

  root.querySelectorAll('[data-review]').forEach((el) =>
    el.addEventListener('click', () => { state.drawer = el.dataset.review; render() }))

  root.querySelectorAll('[data-close-drawer]').forEach((el) =>
    el.addEventListener('click', () => { state.drawer = null; render() }))

  root.querySelectorAll('[data-cert]').forEach((el) =>
    el.addEventListener('click', () => downloadCertificate(el.dataset.cert)))

  if (view === 'donations') wireDonationFilters()
  if (view === 'compliance') wireCompliance()
  if (view === 'audit') wireAuditFilters()

  const demo = root.querySelector('#runDemo')
  demo?.addEventListener('click', async () => {
    demo.disabled = true
    demo.textContent = 'Reloading…'
    try {
      await api('/api/demo/seed', { method: 'POST' })
      await refresh(); render()
      toast('Demonstration data reloaded.')
    } catch (err) { toast(err.message); demo.disabled = false }
  })

  root.querySelector('.drawer')?.querySelector('button')?.focus()
}

/**
 * Download the evidence certificate for one donation.
 *
 * The file is built by the server from anchored evidence, so what an observer
 * downloads is the same thing the tribunal would verify — not a rendering of
 * it produced by the browser.
 */
async function downloadCertificate(donationId) {
  try {
    const cert = await api(`/api/audit/certificate/${donationId}`)
    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${refOf(donationId)}-certificate.json`
    document.body.append(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    toast('Certificate downloaded.')
  } catch (err) {
    toast(err.message)
  }
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

/** Audit-view filters act on the rendered rows; no re-render, no lost scroll. */
function wireAuditFilters() {
  const party = root.querySelector('#auditParty')
  const status = root.querySelector('#auditStatus')
  if (!party || !status) return

  const apply = () => {
    root.querySelectorAll('#auditTable tbody tr').forEach((tr) => {
      const okParty = party.value === 'all' || tr.dataset.party === party.value
      const okStatus = status.value === 'all' || tr.dataset.status === status.value
      tr.classList.toggle('hidden', !(okParty && okStatus))
    })
  }
  party.addEventListener('change', apply)
  status.addEventListener('change', apply)
}

function wireCompliance() {
  const button = root.querySelector('#runAnalysis')
  const bar = root.querySelector('#analysisBar > i')
  if (!button) return

  button.addEventListener('click', async () => {
    button.disabled = true
    const pending = attentionRows().slice(0, 8)
    if (pending.length === 0) {
      toast('Nothing left to re-assess.')
      button.disabled = false
      return
    }

    let done = 0
    for (const row of pending) {
      try { await api(`/api/donations/${row.donation.id}/score`, { method: 'POST' }) } catch { /* keep going */ }
      done++
      bar.style.width = `${Math.round((done / pending.length) * 100)}%`
    }

    await refresh()
    toast(`Re-assessed ${done} ${done === 1 ? 'donation' : 'donations'}.`)
    render()
  })
}

/* ══ Boot ══════════════════════════════════════════════════════════════════ */

async function start() {
  await refresh()
  render()

  clearInterval(state.poll)
  state.poll = setInterval(async () => {
    // A donation arriving mid-demo should appear on its own. Never re-render
    // while a drawer is open or someone is typing into a filter.
    if (state.drawer || document.activeElement?.id === 'q') return
    try { await refresh(); render() } catch { /* session handled in api() */ }
  }, 8000)
}

window.addEventListener('hashchange', () => {
  // A drawer belongs to the view that opened it.
  state.drawer = null
  if (state.me || isPublicRoute()) render()
})

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.drawer) { state.drawer = null; render() }
})

if (isPublicRoute()) {
  await renderDonate()
} else try {
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
