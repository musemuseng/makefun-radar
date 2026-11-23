// Token Launch Radar — the dashboard. Renders window.RADAR (written by main.ts
// from the same model that writes board.json) with no network and no fetch:
// the board, one detail view per protocol, a filtered view, the protocols that
// already trade (kept apart, at the market's own values) and the method.
//
// Routes are hashes, so every view has an address:
//   #/                          the board
//   #/board?cat=Dexs&watch=1    the board, filtered
//   #/p/<slug>                  one protocol's detail view
//   #/live                      protocols whose token already trades
//   #/method                    the value model, stated in full

'use strict';

const D = window.RADAR;
const app = document.getElementById('app');
const bySlug = new Map(D.rows.map((r) => [r.slug, r]));

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtUsd(v) {
  if (v === null || v === undefined) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e8 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v}`;
}
function fmtPct(v) {
  if (v === null || v === undefined) return '<span class="flat">—</span>';
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  return `<span class="${cls}">${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%</span>`;
}
function fmtAge(days) {
  if (days === null || days === undefined) return 'unknown';
  if (days >= 730) return `${(days / 365).toFixed(1)}y`;
  if (days >= 60) return `${Math.round(days / 30.4)}mo`;
  return `${days}d`;
}
const mult = (v) => `${Number(v).toFixed(2)}x`;

/* ---------------- routing ---------------- */

function route() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, query] = h.split('?');
  const params = new URLSearchParams(query || '');
  if (path.startsWith('/p/')) return { view: 'detail', slug: decodeURIComponent(path.slice(3)) };
  if (path === '/live') return { view: 'live' };
  if (path === '/method') return { view: 'method' };
  return {
    view: 'board',
    q: params.get('q') || '',
    cat: params.get('cat') || '',
    chain: params.get('chain') || '',
    watch: params.get('watch') === '1',
    sort: params.get('sort') || 'value',
  };
}

function boardHash(state) {
  const p = new URLSearchParams();
  if (state.q) p.set('q', state.q);
  if (state.cat) p.set('cat', state.cat);
  if (state.chain) p.set('chain', state.chain);
  if (state.watch) p.set('watch', '1');
  if (state.sort && state.sort !== 'value') p.set('sort', state.sort);
  const s = p.toString();
  return s ? `#/board?${s}` : '#/';
}

function setTab(view) {
  document.querySelectorAll('.tabs a').forEach((a) => {
    a.classList.toggle('on', a.dataset.tab === view || (view === 'detail' && a.dataset.tab === 'board'));
  });
}

/* ---------------- the board ---------------- */

const SORTERS = {
  value: (a, b) => b.implied_value_usd - a.implied_value_usd,
  tvl: (a, b) => b.tvl_usd - a.tvl_usd,
  growth: (a, b) => (b.change_7d ?? -Infinity) - (a.change_7d ?? -Infinity),
  age: (a, b) => (b.age_days ?? -1) - (a.age_days ?? -1),
  conviction: (a, b) => b.model.conviction - a.model.conviction,
};

function filteredRows(state) {
  let rows = D.rows;
  if (state.watch) rows = rows.filter((r) => r.watchlist);
  if (state.cat) rows = rows.filter((r) => (r.category || 'Uncategorised') === state.cat);
  if (state.chain) rows = rows.filter((r) => r.chains.includes(state.chain));
  if (state.q) {
    const q = state.q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q));
  }
  return [...rows].sort(SORTERS[state.sort] || SORTERS.value);
}

function options(values, current, allLabel) {
  return `<option value="">${allLabel}</option>` + values.map((v) => `<option value="${esc(v)}"${v === current ? ' selected' : ''}>${esc(v)}</option>`).join('');
}

function renderBoard(state) {
  setTab('board');
  const cats = [...new Set(D.rows.map((r) => r.category || 'Uncategorised'))].sort();
  const chainCounts = new Map();
  for (const r of D.rows) for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) || 0) + 1);
  const chains = [...chainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([c]) => c);
  const rows = filteredRows(state);

  const head = `
  <section class="hero">
    <h1>Every protocol still waiting on a token,<br>ranked by <span class="hl">what that token would be worth</span>.</h1>
    <p>The radar scans the sealed DefiLlama snapshot of ${esc(D.as_of)} — ${D.scanned} protocols — prices each one that records
    no token yet with the market's own category multiples — each price carrying the peer band around it — and writes the farm plan beside the price.
    Protocols whose token already trades are <a href="#/live">kept apart</a>; they are the comparables, never the ranked.</p>
    <div class="stats">
      <div class="stat"><div class="k">Protocols scanned</div><div class="v">${D.scanned}</div></div>
      <div class="stat"><div class="k">On the watchlist</div><div class="v">${D.watchlist_size} <small>TVL ≥ ${fmtUsd(D.floor_usd)}</small></div></div>
      <div class="stat"><div class="k">Ranked pre-token</div><div class="v">${D.board_size} <small>${D.early_size} early, below the floor</small></div></div>
      <div class="stat"><div class="k">Implied value, total</div><div class="v">${fmtUsd(D.total_implied_usd)}</div></div>
      <div class="stat"><div class="k">Market's own multiple</div><div class="v">${mult(D.global_comp.multiple)} <small>median mcap / TVL, ${D.global_comp.peers} live peers</small></div></div>
    </div>
  </section>`;

  const controls = `
  <form class="controls" id="controls">
    <input type="search" name="q" placeholder="Search name or slug…" value="${esc(state.q)}" aria-label="Search">
    <select name="cat" aria-label="Category">${options(cats, state.cat, 'All categories')}</select>
    <select name="chain" aria-label="Chain">${options(chains, state.chain, 'All chains')}</select>
    <select name="sort" aria-label="Sort">
      ${[['value', 'Sort: implied value'], ['tvl', 'Sort: TVL'], ['growth', 'Sort: 7d growth'], ['age', 'Sort: track record'], ['conviction', 'Sort: conviction']]
        .map(([v, label]) => `<option value="${v}"${state.sort === v ? ' selected' : ''}>${label}</option>`).join('')}
    </select>
    <label class="check"><input type="checkbox" name="watch"${state.watch ? ' checked' : ''}> Watchlist only</label>
    <span class="count"><b>${rows.length}</b> of ${D.board_size} shown</span>
  </form>`;

  const thSort = (key, label, cls = '') => `<th class="${cls} sortable" data-sort="${key}" title="Sort by ${esc(label)}">${label}${state.sort === key ? ' <span class="sarr">▾</span>' : ''}</th>`;
  const body = rows.length === 0
    ? `<div class="empty">No pre-token protocol matches that filter. Loosen it — the radar ranks ${D.board_size} of them.</div>`
    : `<table class="board"><thead><tr>
        <th class="l">#</th><th class="l">Protocol</th><th class="l hideS">Category</th><th class="l hideS">Chains</th>
        ${thSort('tvl', 'TVL')}${thSort('growth', '7d')}${thSort('age', 'Age')}${thSort('value', 'Implied value')}<th class="hideS">× TVL</th>${thSort('conviction', 'Conviction')}
      </tr></thead><tbody>${rows.map((r) => `
      <tr data-slug="${esc(r.slug)}"${r.rank <= 3 ? ' class="top1"' : ''}>
        <td class="l rank">${r.rank}</td>
        <td class="l name">${esc(r.name)}<span class="slug">${esc(r.slug)}</span>${r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : '<span class="badge early">EARLY</span>'}</td>
        <td class="l cat hideS">${esc(r.category || 'Uncategorised')}</td>
        <td class="l chains hideS">${esc(r.chains.slice(0, 3).join(', '))}${r.chains.length > 3 ? ` +${r.chains.length - 3}` : ''}</td>
        <td>${fmtUsd(r.tvl_usd)}</td>
        <td>${fmtPct(r.change_7d)}</td>
        <td>${fmtAge(r.age_days)}</td>
        <td><strong>${fmtUsd(r.implied_value_usd)}</strong><span class="range">${fmtUsd(r.model.implied_low_usd)} – ${fmtUsd(r.model.implied_high_usd)}</span></td>
        <td class="hideS">${mult(r.implied_value_usd / r.tvl_usd)}</td>
        <td><span class="conv"><i style="width:${r.model.conviction}%"></i></span>${r.model.conviction}</td>
      </tr>`).join('')}</tbody></table>`;

  app.innerHTML = head + controls + body;
  app.setAttribute('aria-busy', 'false');

  const form = document.getElementById('controls');
  form.addEventListener('change', () => {
    const fd = new FormData(form);
    location.hash = boardHash({
      q: String(fd.get('q') || '').trim(),
      cat: String(fd.get('cat') || ''),
      chain: String(fd.get('chain') || ''),
      watch: fd.get('watch') === 'on',
      sort: String(fd.get('sort') || 'value'),
    });
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  app.querySelectorAll('tr[data-slug]').forEach((tr) => {
    tr.addEventListener('click', () => { location.hash = `#/p/${encodeURIComponent(tr.dataset.slug)}`; });
  });
  app.querySelectorAll('th[data-sort]').forEach((th) => {
    th.addEventListener('click', () => {
      location.hash = boardHash({ q: state.q, cat: state.cat, chain: state.chain, watch: state.watch, sort: th.dataset.sort });
    });
  });
}

/* ---------------- detail ---------------- */

function renderDetail(slug) {
  const r = bySlug.get(slug);
  if (!r) { renderBoard(route()); return; }
  setTab('board');
  const m = r.model;
  const peers = m.comp_peers > 0
    ? `${m.comp_peers} live ${esc(r.category || '')} peers, median ${m.comp_median_multiple !== null ? mult(m.comp_median_multiple) : '—'}`
    : 'no live peers in its category — priced on the global median';
  const peerEntry = (D.peers || []).find((c) => (c.category || null) === (r.category || null));
  const peerRows = peerEntry ? peerEntry.peers : D.global_peers;
  const peerScope = peerEntry ? `the largest live ${esc(r.category || 'Uncategorised')} peers` : 'no live peers in its category — the global set that prices it';
  const bandLo = Math.log(m.implied_low_usd / 1.2);
  const bandHi = Math.log(m.implied_high_usd * 1.2);
  const bandPos = (v) => (((Math.log(v) - bandLo) / (bandHi - bandLo)) * 100).toFixed(1);
  app.innerHTML = `
  <a class="back" href="#/">← back to the board</a>
  <div class="detail-head">
    <h1>${esc(r.name)}</h1><span class="slug">${esc(r.slug)}</span>
    ${r.watchlist ? '<span class="badge watch">WATCHLIST</span>' : '<span class="badge early">EARLY — BELOW THE FLOOR</span>'}
  </div>
  <p class="detail-sub">Rank #${r.rank} of ${D.board_size} pre-token protocols · ${esc(r.category || 'Uncategorised')} · ${esc(r.chains.join(', ') || 'no chains recorded')} ·
  records no token in the ${esc(D.as_of)} snapshot — which is a statement about the record, not proof none exists.</p>
  <div class="tiles">
    <div class="stat"><div class="k">Implied value</div><div class="v">${fmtUsd(r.implied_value_usd)}</div><div class="sub">peer band ${fmtUsd(m.implied_low_usd)} – ${fmtUsd(m.implied_high_usd)}</div></div>
    <div class="stat"><div class="k">TVL</div><div class="v">${fmtUsd(r.tvl_usd)}</div></div>
    <div class="stat"><div class="k">TVL change, 7d</div><div class="v">${fmtPct(r.change_7d)}</div></div>
    <div class="stat"><div class="k">Conviction</div><div class="v">${m.conviction}<small> / 100</small></div></div>
  </div>
  <section class="panel">
    <h2>How the radar prices it — model ${esc(D.model_version)}</h2>
    <p class="formula">implied = TVL × comp multiple × growth factor × track factor</p>
    <table class="math">
      <tr><td>TVL in the snapshot</td><td class="num">${fmtUsd(r.tvl_usd)}</td></tr>
      <tr><td>Comp multiple — market cap / TVL of live peers, shrunk to the global median (${peers})</td><td class="num">× ${mult(m.comp_multiple)}</td></tr>
      <tr><td>Growth factor — 7d TVL change of ${Number(m.growth_pct).toFixed(1)}% mapped at weight ${D.model.growth_weight}</td><td class="num">× ${m.growth_factor.toFixed(2)}</td></tr>
      <tr><td>Track factor — tracked ${r.age_days === null ? 'an unknown time (scored as 300 days)' : `${r.age_days} days`} with no token</td><td class="num">× ${m.track_factor.toFixed(2)}</td></tr>
      <tr class="total"><td>Implied value if it launched on this record</td><td class="num">${fmtUsd(r.implied_value_usd)}</td></tr>
      <tr><td>At the same peers' lower quartile instead (× ${mult(m.multiple_low)})</td><td class="num">${fmtUsd(m.implied_low_usd)}</td></tr>
      <tr><td>At the same peers' upper quartile instead (× ${mult(m.multiple_high)})</td><td class="num">${fmtUsd(m.implied_high_usd)}</td></tr>
    </table>
    <div class="band" aria-hidden="true"><span class="band-track"><i class="band-fill" style="left:${bandPos(m.implied_low_usd)}%;width:${Math.max(0, bandPos(m.implied_high_usd) - bandPos(m.implied_low_usd)).toFixed(1)}%"></i><i class="band-dot" style="left:${bandPos(r.implied_value_usd)}%"></i></span><span class="band-labs"><span>${fmtUsd(m.implied_low_usd)} · lower quartile</span><span>point ${fmtUsd(r.implied_value_usd)}</span><span>upper quartile · ${fmtUsd(m.implied_high_usd)}</span></span></div>
    <p class="note">Every figure comes from the snapshot itself; no protocol's name is looked up anywhere in the model.
    The band is the peers' own spread — the interquartile range of their market cap over TVL, shrunk and clamped exactly
    as the point multiple is — so a category whose peers disagree shows a wide band, and the point value stays the median's claim.
    The same three factors price all ${D.board_size} rows — read the whole model on the <a href="#/method">Method page</a>.</p>
  </section>
  <section class="panel">
    <h2>The peers behind the multiple — ${peerScope}</h2>
    <table class="comps"><thead><tr><th class="l">Live peer</th><th>Market cap</th><th>TVL</th><th>Mcap / TVL</th></tr></thead>
    <tbody>${peerRows.map((pp) => `<tr><td class="l">${esc(pp.name)}<span class="slug">${esc(pp.slug)}</span></td><td>${fmtUsd(pp.mcap_usd)}</td><td>${fmtUsd(pp.tvl_usd)}</td><td>${mult(pp.mcap_tvl)}</td></tr>`).join('')}</tbody></table>
    <p class="note">${m.comp_peers > 0
      ? `The five largest of the ${m.comp_peers} live peers in this category by market cap. The multiple above is the whole set's median, shrunk toward the global median — never these five alone.`
      : `This category has no live peer in the snapshot, so the global median over ${D.global_comp.peers} peers prices it; these are that set's largest members.`}</p>
  </section>
  <section class="panel">
    <h2>The farm plan — ${r.farm_steps.length} steps</h2>
    <p class="plansum">All-in estimate: <b>${fmtUsd(m.plan.capital_usd)}</b> of working capital · about <b>${fmtUsd(m.plan.est_gas_total_usd)}</b> of gas in total
    over ${m.plan.weeks} weeks at $${m.plan.gas_usd.toFixed(2)} a transaction on ${esc(r.chains[0] || 'its first chain')} · about <b>${m.plan.est_minutes} minutes</b> of hands-on time.</p>
    <ol class="steps">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
    <p class="note">Costs are the plan's own estimates in dollars and minutes, sized to this protocol's TVL and its first chain.
    One step weighs the risks this protocol's own record shows — its drawdown, its age, its chains.
    A launch is never promised: the plan buys a position in the protocol's own scoring, nothing more.</p>
  </section>`;
  app.setAttribute('aria-busy', 'false');
  window.scrollTo(0, 0);
}

/* ---------------- live tokens ---------------- */

function renderLive() {
  setTab('live');
  app.innerHTML = `
  <section class="live">
    <h1>Already trading — the comparables, kept off the board</h1>
    <p>These protocols' tokens exist, so the radar does not rank them and does not model them: the values below are the
    market's own, from the same snapshot. They earn their place here because their market cap over TVL, taken category
    by category, is exactly what prices the pre-token board. The top ${D.live_size} by market cap are shown.</p>
    <table class="board"><thead><tr>
      <th class="l">Protocol</th><th class="l hideS">Category</th><th>Market cap</th><th>TVL</th><th>Mcap / TVL</th><th>7d</th>
    </tr></thead><tbody>${D.live.map((r) => `
      <tr>
        <td class="l name">${esc(r.name)}<span class="slug">${esc(r.slug)}</span></td>
        <td class="l cat hideS">${esc(r.category || 'Uncategorised')}</td>
        <td>${fmtUsd(r.mcap_usd)}</td>
        <td>${fmtUsd(r.tvl_usd)}</td>
        <td>${r.mcap_tvl !== null ? mult(r.mcap_tvl) : '—'}</td>
        <td>${fmtPct(r.change_7d)}</td>
      </tr>`).join('')}</tbody></table>
  </section>`;
  app.setAttribute('aria-busy', 'false');
}

/* ---------------- method ---------------- */

function renderMethod() {
  setTab('method');
  const M = D.model;
  app.innerHTML = `
  <section class="method">
    <h1>Method — how a number is put on a token that does not exist</h1>
    <p>Data: <span class="kv">${esc(D.source)}</span>, as of <span class="kv">${esc(D.as_of)}</span>. The snapshot carries
    ${D.scanned} protocols at $5M of TVL or more; the radar ranks the ${D.board_size} that record no token and are neither
    exchanges nor versioned re-releases, and covers all ${D.watchlist_size} watchlist protocols among them.</p>
    <div class="panel">
      <h2>The model — ${esc(D.model_version)}</h2>
      <p class="formula">implied = TVL × comp_multiple(category) × growth_factor × track_factor</p>
      <p><b>Comp multiple.</b> For every category, take the live-token protocols in this snapshot, divide each one's market
      cap by its TVL, and take the median. Shrink it toward the global median by the peer count —
      <span class="kv">(n × median + ${M.shrink_peers} × global) / (n + ${M.shrink_peers})</span> — and clamp to
      [${M.multiple_min}, ${M.multiple_max}], so a two-peer category cannot shout down a forty-peer one and no thin
      category prices a protocol at 400× its TVL. A category with no live peers is priced on the global median,
      <span class="kv">${mult(D.global_comp.multiple)}</span> over ${D.global_comp.peers} peers.</p>
      <p><b>The band.</b> No category's peers agree on a single multiple, so every value carries their spread with it:
      the category's 25th and 75th percentile market cap / TVL, each shrunk toward the matching global quartile by the
      same peer weight and clamped to the same [${M.multiple_min}, ${M.multiple_max}]. Each detail view prices its protocol
      at both quartiles beside the point value. A narrow band is a category whose peers cluster; a wide one is the model
      showing how far its own evidence reaches — thin categories and clamped ones say so in the width.</p>
      <p><b>Growth factor.</b> <span class="kv">1 + clamp(7d TVL change, ${M.growth_floor_pct}%, +${M.growth_cap_pct}%) × ${M.growth_weight}</span>:
      a protocol that doubled its TVL in a week is marked up 1.60×, one that halved marked down to 0.70×. Momentum is evidence, not proof.</p>
      <p><b>Track factor.</b> <span class="kv">${M.track_base} + ${M.track_span} × age / (age + ${M.track_half_days} days)</span>, age counted from the day
      DefiLlama began tracking the protocol to the snapshot's day; an unknown listing date is scored as ${M.unknown_age_days} days.
      Surviving for years with no token is worth more than arriving last month.</p>
      <p><b>Conviction (0–100)</b> rides beside the value for the reader's eye — TVL scale, momentum, track record, chain
      breadth, watchlist membership — and never moves a rank. Rank is implied value, nothing else.</p>
      <p><b>What the model never does:</b> look up a protocol's name, import a price from outside the snapshot, or rank a
      protocol whose token already trades. An implied value is this radar's claim about a hypothetical launch on an
      unchanged record — not a prediction that a token will launch, or when.</p>
    </div>
    <div class="panel">
      <h2>A worked example — the board's #1, priced in full</h2>
      ${(() => { const ex = D.rows[0]; const em = ex.model; return `<p><b>${esc(ex.name)}</b> (${esc(ex.category || 'Uncategorised')}) holds ${fmtUsd(ex.tvl_usd)} of TVL.
      Its category's live peers price at a median ${em.comp_median_multiple !== null ? mult(em.comp_median_multiple) : '—'}, shrunk to the multiple used, × ${mult(em.comp_multiple)};
      its seven-day change of ${Number(em.growth_pct).toFixed(1)}% gives a growth factor of × ${em.growth_factor.toFixed(2)}, and its
      ${ex.age_days === null ? 'unknown' : `${ex.age_days}-day`} track record a track factor of × ${em.track_factor.toFixed(2)}.
      ${fmtUsd(ex.tvl_usd)} × ${mult(em.comp_multiple)} × ${em.growth_factor.toFixed(2)} × ${em.track_factor.toFixed(2)} = <b>${fmtUsd(ex.implied_value_usd)}</b>,
      with the quartile band running from ${fmtUsd(em.implied_low_usd)} to ${fmtUsd(em.implied_high_usd)}.
      Its farm plan asks for ${fmtUsd(em.plan.capital_usd)} of working capital, about ${fmtUsd(em.plan.est_gas_total_usd)} of gas and
      ${em.plan.weeks} weeks of weekly activity. Every other row is priced by the same arithmetic — open any row to see its own.</p>`; })()}
    </div>
    <div class="panel">
      <h2>The comparables — live peers by category</h2>
      <table class="comps"><thead><tr><th class="l">Category</th><th>Live peers</th><th>Median mcap / TVL</th><th>Multiple used</th><th>Band P25 – P75</th></tr></thead>
      <tbody>${D.comps.map((c) => `<tr><td class="l">${esc(c.category || 'Uncategorised')}</td><td>${c.peers}</td><td>${c.median_multiple !== null ? mult(c.median_multiple) : '—'}</td><td>${mult(c.multiple)}</td><td>${mult(c.p25_multiple)} – ${mult(c.p75_multiple)}</td></tr>`).join('')}
      <tr><td class="l"><b>All categories (global)</b></td><td>${D.global_comp.peers}</td><td>${mult(D.global_comp.median_multiple)}</td><td>${mult(D.global_comp.multiple)}</td><td>${mult(D.global_comp.p25_multiple)} – ${mult(D.global_comp.p75_multiple)}</td></tr>
      </tbody></table>
    </div>
    <div class="panel">
      <h2>The farm plans</h2>
      <p>Each row's plan is generated from that protocol's own record — its category picks the playbook (supply and borrow
      for lending, liquidity for a DEX, routes for a bridge, stake and restake for staking), its first chain sets the gas
      figures, its TVL sizes the working capital, and its age sets how many weeks of weekly activity the plan asks for.
      Every step states its cost and its time. One step in every plan weighs the risk that protocol's own record shows —
      a seven-day drawdown of 15% or more first, then a track record under 180 days, then a single chain — and each
      detail view totals the plan's gas and minutes beside its steps, computed from the same figures. No plan is a
      promise of an airdrop; each buys a genuine position in the protocol's own activity record, which is the only
      thing a launch can later score.</p>
    </div>
  </section>`;
  app.setAttribute('aria-busy', 'false');
}

/* ---------------- go ---------------- */

function render() {
  const r = route();
  if (r.view === 'detail') renderDetail(r.slug);
  else if (r.view === 'live') renderLive();
  else if (r.view === 'method') renderMethod();
  else renderBoard(r);
}

window.addEventListener('hashchange', render);
render();
