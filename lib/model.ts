// Token Launch Radar — the valuation and farming model.
//
// One sealed DefiLlama snapshot in, one ranked board out. The board ranks every
// protocol that records no token yet: the snapshot's whole watchlist (the floor,
// never the ceiling) plus every other rankable pre-token protocol the snapshot
// carries, down to its $5M TVL cut. Protocols whose token already trades are
// never ranked by the model; they are reported separately at the market's own
// market cap, and they do one job inside the model: they are the comparables.
//
// The implied value of a pre-token protocol is
//
//   implied = TVL x comp_multiple(category) x growth_factor x track_factor
//
// comp_multiple  The market's own verdict on the protocol's category. Among the
//                snapshot's live-token protocols we take each one's market cap
//                over TVL, take the median inside the protocol's category, and
//                shrink it toward the global median (0.205x on this snapshot)
//                by the peer count, so a category with two peers cannot shout
//                down one with forty: multiple = (n x median + 4 x global) /
//                (n + 4), clamped to [0.03, 2.5]. No name is ever looked up.
// growth_factor  1 + clamp(change_7d, -50, +100) / 100 x 0.6, so a protocol
//                whose TVL grew 100% in a week is marked up 1.6x and one that
//                halved is marked down to 0.7x. Momentum is evidence, not proof.
// track_factor   0.78 + 0.42 x age / (age + 420 days): a protocol tracked for
//                years with no token has survived long enough for a launch to
//                mean something; a week-old one has not. Unknown listing dates
//                are scored as 300 days, never as zero and never as ancient.
//
// A conviction score (0-100) rides beside the value for the reader's eye only:
// TVL scale, 7-day momentum, track record, chain breadth and watchlist
// membership. It never changes a rank: rank is implied value, nothing else.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'comps-2';

/** The model's constants, stated in the dashboard's Method view. */
export const MODEL = {
  shrink_peers: 4,
  multiple_min: 0.03,
  multiple_max: 2.5,
  growth_floor_pct: -50,
  growth_cap_pct: 100,
  growth_weight: 0.6,
  track_base: 0.78,
  track_span: 0.42,
  track_half_days: 420,
  unknown_age_days: 300,
} as const;

const DAY_MS = 86_400_000;

/** Whole days from the day DefiLlama began tracking a protocol to the snapshot's day; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when all three token fields are null. */
export function recordsNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release marker is a version of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of another protocol, per the watchlist's own rule. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** A whole word wrapped, staked or staking in the name, in any case. */
const PRODUCT_NAME = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name: the product of an exchange, not a launch of its own. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/**
 * Rankable by the radar: records no token, and is not a wrapped, staked or
 * bridged product of a token that already trades — the same exclusions the
 * snapshot's watchlist rule states, applied to the whole snapshot instead of
 * only above its floor. WBTC is Bitcoin on Ethereum and a bridged BTC product
 * is BTC in a bridge: neither is a protocol still waiting on a launch of its
 * own, whatever its TVL. (The house's rule also reads DefiLlama's
 * parentProtocol, which the snapshot does not carry; the field-based rules
 * above are the part of it the snapshot can check, and every watchlist slug
 * passes them, as the gate's coverage row requires.)
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!recordsNoToken(p)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name) || PRODUCT_NAME.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** One category's comparable set: how many live peers, their median multiple, and the shrunk multiple used. */
export interface CompStat {
  category: string | null;
  peers: number;
  median_multiple: number | null;
  multiple: number;
}

/** The comparables: live-token protocols' market cap over TVL, by category, shrunk toward the global median. */
export function buildComps(snapshot: Snapshot): { byCategory: Map<string | null, CompStat>; global: CompStat } {
  const ratios: number[] = [];
  const perCategory = new Map<string | null, number[]>();
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    ratios.push(ratio);
    const list = perCategory.get(p.category) ?? [];
    list.push(ratio);
    perCategory.set(p.category, list);
  }
  const globalMedian = ratios.length > 0 ? median(ratios) : 0.2;
  const shrink = (catMedian: number | null, n: number): number => {
    if (catMedian === null) return clamp(globalMedian, MODEL.multiple_min, MODEL.multiple_max);
    return clamp((n * catMedian + MODEL.shrink_peers * globalMedian) / (n + MODEL.shrink_peers), MODEL.multiple_min, MODEL.multiple_max);
  };
  const byCategory = new Map<string | null, CompStat>();
  for (const [category, list] of perCategory) {
    const med = median(list);
    byCategory.set(category, { category, peers: list.length, median_multiple: round4(med), multiple: round4(shrink(med, list.length)) });
  }
  const global: CompStat = { category: null, peers: ratios.length, median_multiple: round4(globalMedian), multiple: round4(shrink(null, ratios.length)) };
  return { byCategory, global };
}

/** The comp multiple one protocol is priced with, and the peer set behind it. */
function compFor(p: SnapshotProtocol, comps: { byCategory: Map<string | null, CompStat>; global: CompStat }): CompStat {
  return comps.byCategory.get(p.category) ?? { category: p.category, peers: 0, median_multiple: null, multiple: comps.global.multiple };
}

/** The model's three factors and the implied value for one protocol. */
export interface Valuation {
  implied_value_usd: number;
  comp_multiple: number;
  comp_peers: number;
  comp_median: number | null;
  growth_pct: number;
  growth_factor: number;
  age_days: number | null;
  track_factor: number;
  conviction: number;
}

export function valueProtocol(p: SnapshotProtocol, snapshot: Snapshot, comps: { byCategory: Map<string | null, CompStat>; global: CompStat }): Valuation {
  const comp = compFor(p, comps);
  const age = ageDays(snapshot.as_of, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, MODEL.growth_floor_pct, MODEL.growth_cap_pct);
  const growthFactor = 1 + (growthPct / 100) * MODEL.growth_weight;
  const ageForTrack = age ?? MODEL.unknown_age_days;
  const trackFactor = MODEL.track_base + MODEL.track_span * (ageForTrack / (ageForTrack + MODEL.track_half_days));
  const implied = Math.max(1, Math.round(p.tvl_usd * comp.multiple * growthFactor * trackFactor));

  // Conviction, for the reader's eye only: scale, momentum, track record, breadth, watchlist.
  const scale = 34 * clamp(Math.log10(Math.max(p.tvl_usd, 1) / 5_000_000) / 3, 0, 1);
  const momentum = 22 * clamp((growthPct + 20) / 120, 0, 1);
  const track = age === null ? 8 : 22 * clamp(age / 1095, 0, 1);
  const breadth = 12 * clamp(p.chains.length / 6, 0, 1);
  const listed = snapshot.watchlist.includes(p.slug) ? 10 : 0;
  const conviction = Math.round(clamp(scale + momentum + track + breadth + listed, 0, 100));

  return {
    implied_value_usd: implied,
    comp_multiple: comp.multiple,
    comp_peers: comp.peers,
    comp_median: comp.median_multiple,
    growth_pct: round4(p.change_7d ?? 0),
    growth_factor: round4(growthFactor),
    age_days: age,
    track_factor: round4(trackFactor),
    conviction,
  };
}

/* ------------------------------------------------------------------ */
/* Farm plans                                                          */
/* ------------------------------------------------------------------ */

/** Approximate cost of one ordinary transaction on a chain, in dollars, as the plan states it. */
const GAS_USD: Record<string, number> = {
  Ethereum: 7.5, Solana: 0.06, Base: 0.12, Arbitrum: 0.35, BSC: 0.25, Polygon: 0.03,
  Avalanche: 0.4, OP: 0.25, Optimism: 0.25, Tron: 1.2, Sui: 0.05, Aptos: 0.02,
  TON: 0.08, Bitcoin: 1.5, Linea: 0.2, Scroll: 0.3, Mantle: 0.1, zkSync: 0.25,
  Starknet: 0.15, Near: 0.02, Cosmos: 0.05, Sei: 0.02, Sonic: 0.03, Berachain: 0.1,
  Monad: 0.05, Hyperliquid: 0.05, Eclipse: 0.05, Fuel: 0.05, Movement: 0.05,
};

function gasFor(chain: string): string {
  const g = GAS_USD[chain];
  return g === undefined ? 'about $0.50' : `about $${g.toFixed(2)}`;
}

function firstChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** Working capital for one farm position, sized to the protocol's own TVL so the plan stays realistic. */
function capitalFor(tvl: number): number {
  if (tvl >= 2_000_000_000) return 500;
  if (tvl >= 500_000_000) return 250;
  if (tvl >= 100_000_000) return 150;
  if (tvl >= 25_000_000) return 100;
  return 50;
}

/** Weeks of weekly activity the plan asks for, from the protocol's track record. */
function weeksFor(age: number | null): number {
  if (age === null) return 6;
  if (age < 180) return 8;
  if (age < 365) return 6;
  if (age < 730) return 5;
  return 4;
}

type Playbook = { open: (n: string, c: string, cap: number) => string; second: (n: string, c: string, cap: number) => string };

function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      open: (n, ch, cap) => `Supply $${cap} of USDC as collateral in ${n} on ${ch}; lending markets read suppliers first when they score a launch.`,
      second: (n, ch, cap) => `Borrow about $${Math.round(cap / 3)} against that collateral and re-supply it once, so the wallet shows both sides of ${n}'s market.`,
    };
  }
  if (c.includes('dex') || c.includes('liquidity') || c.includes('farm') || c.includes('leveraged')) {
    return {
      open: (n, ch, cap) => `Add $${cap} of liquidity to ${n}'s busiest USDC pool on ${ch} and keep the LP position open; volume plus time in pool is what DEX points seasons count.`,
      second: (n, ch, cap) => `Route two swaps a week through ${n}'s own interface rather than an aggregator, so the trades are attributed to your wallet.`,
    };
  }
  if (c.includes('bridge')) {
    return {
      open: (n, ch, cap) => `Bridge $${cap} of USDC from Ethereum to ${ch} through ${n}, then use the bridged funds in one app on the far side instead of bridging straight back.`,
      second: (n, ch, cap) => `Make one return transfer a week later over a different route ${n} supports, so the wallet reads as a user of the bridge, not a passer-through.`,
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      open: (n, ch, cap) => `Stake $${cap} of the native staking asset through ${n} on ${ch} and hold the receipt token in the same wallet.`,
      second: (n, ch, cap) => `Put the receipt token to work once — as collateral or in the vault ${n} itself points to — so the wallet carries two layers of activity.`,
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options') || c.includes('basis') || c.includes('synthetic')) {
    return {
      open: (n, ch, cap) => `Deposit $${cap} of USDC margin on ${n} and open one small hedged position; market makers' launch scores weigh real trading over idle margin.`,
      second: (n, ch, cap) => `Trade a little each week — one open and one close — rather than one large trade, so the wallet shows a trading history, not a single visit.`,
    };
  }
  if (c.includes('yield') || c.includes('curator') || c.includes('allocator') || c.includes('manager')) {
    return {
      open: (n, ch, cap) => `Deposit $${cap} of USDC into a ${n} vault on ${ch} and keep the vault shares; curated vaults score depositors by size and by how long shares are held.`,
      second: (n, ch, cap) => `Split a second $${Math.round(cap / 2)} into another ${n} vault on a different chain it curates, so the wallet appears in two of its markets.`,
    };
  }
  if (c.includes('rwa')) {
    return {
      open: (n, ch, cap) => `Mint $${cap} of ${n}'s yield-bearing asset on ${ch} after its onboarding check, and hold the asset rather than flipping it.`,
      second: (n, ch, cap) => `Use the minted asset once where ${n} lists it — as collateral or in its paired pool — so the wallet shows the full product loop.`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: (n, ch, cap) => `Fund $${cap} on ${n} and take small positions in three different markets; prediction platforms score breadth of markets, not one big bet.`,
      second: (n, ch, cap) => `Provide liquidity to one market's book if ${n} offers it, and let one position settle so the wallet has a completed outcome.`,
    };
  }
  if (c.includes('chain')) {
    return {
      open: (n, ch, cap) => `Bridge $${cap} of USDC onto ${n} and make it the wallet's home chain for a month: pay gas there, hold the balance there.`,
      second: (n, ch, cap) => `Use two native apps on ${n} each week — a swap and a lending deposit — since chain launches score wallets by distinct contracts touched.`,
    };
  }
  if (c.includes('launchpad')) {
    return {
      open: (n, ch, cap) => `Stake or hold $${cap} in ${n}'s allocation asset on ${ch} so the wallet qualifies for its sale tiers.`,
      second: (n, ch, cap) => `Take part in one small sale on ${n} and hold what it issues past the first week; launchpads reward holders over flippers.`,
    };
  }
  return {
    open: (n, ch, cap) => `Deposit $${cap} of USDC into ${n} on ${ch} through its own app and keep the position open.`,
    second: (n, ch, cap) => `Make one more deposit of $${Math.round(cap / 2)} a week later, so the wallet shows returning use of ${n} rather than a single touch.`,
  };
}

/**
 * One protocol's farm plan: seven steps, each a concrete action carrying its
 * cost and its time inside the string. Everything in it is derived from the
 * protocol's own record — category, first chain, TVL and age — never from a
 * hand-written list of protocol names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = firstChain(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const book = playbookFor(p.category);
  return [
    `Set up a fresh wallet for ${p.name} alone and write its seed phrase on paper, offline; never farm a launch from the wallet that holds your savings. Cost: nothing to create. Time: 10 minutes.`,
    `Fund the wallet with $${capital} of USDC on ${chain}; if your funds sit elsewhere, bridge them in a day ahead so a failed bridge never strands the plan. Cost: ${gas} in gas, plus any bridge fee. Time: 15 minutes.`,
    `${book.open(p.name, chain, capital)} Cost: $${capital} of working capital plus ${gas} in gas. Time: 20 minutes.`,
    `${book.second(p.name, chain, capital)} Cost: ${gas} in gas per action. Time: 15 minutes.`,
    `Repeat one qualifying action every week for ${weeks} weeks; points and launch snapshots are taken more than once, and a wallet active in several of them outranks a one-week visitor. Cost: ${gas} in gas a week. Time: 10 minutes a week for ${weeks} weeks.`,
    `Keep the position open the whole ${weeks} weeks and log every transaction hash, date and balance in a farm diary, so the position can be proven, repeated or unwound without guesswork. Cost: nothing. Time: 5 minutes a week.`,
    `Claim only from ${p.name}'s official app, reached from its DefiLlama page — never from a search ad or a direct message, and never pay a fee to claim. Unwind in reverse order when you are done. Cost: ${gas} in gas to exit. Time: 20 minutes.`,
  ];
}

/* ------------------------------------------------------------------ */
/* The board                                                           */
/* ------------------------------------------------------------------ */

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    comp_multiple: number;
    comp_peers: number;
    comp_median_multiple: number | null;
    growth_pct: number;
    growth_factor: number;
    track_factor: number;
    conviction: number;
  };
  farm_steps: string[];
}

/** A live-token protocol, shown at the market's own value and never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: typeof MODEL;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  global_comp: CompStat;
  comps: CompStat[];
  rows: (BoardRow & { farm_steps: string[] })[];
  live: LiveRow[];
}

export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; comps: { byCategory: Map<string | null, CompStat>; global: CompStat } } {
  const comps = buildComps(snapshot);
  const onWatchlist = new Set(snapshot.watchlist);
  const scored = snapshot.protocols
    .filter(isRankable)
    .map((p) => ({ p, v: valueProtocol(p, snapshot, comps) }));
  scored.sort((a, b) => b.v.implied_value_usd - a.v.implied_value_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.v.age_days,
    watchlist: onWatchlist.has(s.p.slug),
    implied_value_usd: s.v.implied_value_usd,
    model: {
      comp_multiple: s.v.comp_multiple,
      comp_peers: s.v.comp_peers,
      comp_median_multiple: s.v.comp_median,
      growth_pct: s.v.growth_pct,
      growth_factor: s.v.growth_factor,
      track_factor: s.v.track_factor,
      conviction: s.v.conviction,
    },
    farm_steps: farmSteps(s.p, s.v.age_days),
  }));
  return { board, comps };
}

export function buildLive(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.mcap_usd !== null)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : 1))
    .slice(0, 36)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const { board, comps } = buildBoard(snapshot);
  const live = buildLive(snapshot);
  const compList = [...comps.byCategory.values()]
    .filter((c) => c.peers >= 2)
    .sort((a, b) => b.peers - a.peers)
    .slice(0, 18);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: MODEL,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.watchlist).length,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    global_comp: comps.global,
    comps: compList,
    rows: board,
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} out-values rank ${i}`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new Error('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new Error('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
