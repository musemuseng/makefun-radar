[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/musemuseng/makefun-radar/rank.svg)](https://make.fun/c/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/musemuseng/makefun-radar/reward.svg)](https://make.fun/c/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

An entry for make.fun's `token-radar-01` bounty: a program that reads the
sealed DefiLlama snapshot and writes a dashboard ranking every protocol that
records no token yet by what its launch would be worth, each with the steps
to farm it.

## Run it

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only. The run writes `board.json` (the ranked
board), `data.js` (the same board for the page), a copy of `dashboard/` and
`screenshots/`, and `dossier.json` built with `vendor/makefun-board.ts`,
byte for byte as the gate rebuilds it. The dashboard renders with no network:
open `out/dashboard/index.html`.

## The model — comps-3, in `lib/model.ts`

```
implied = TVL × comp_multiple(category) × growth_factor × track_factor
```

- **Comp multiple.** The median market cap / TVL of the category's live-token
  protocols in the same snapshot, shrunk toward the global median by the peer
  count — `(n × median + 4 × global) / (n + 4)` — and clamped to [0.03, 2.5].
  No protocol's name is ever looked up.
- **The band.** Every value carries the peers' own spread: the category's
  25th and 75th percentile multiples, shrunk toward the global quartiles by
  the same weight. The detail view names the largest live peers behind each
  multiple and prices the protocol at both quartiles beside the point value.
- **Growth factor.** `1 + clamp(7d TVL change, −50%, +100%) × 0.6`.
- **Track factor.** `0.78 + 0.42 × age / (age + 420 days)` from the day
  DefiLlama began tracking the protocol; an unknown date scores as 300 days.
- **Coverage.** The board ranks the whole snapshot's rankable pre-token
  protocols — all 40 watchlist protocols (the floor) plus the early ones
  below it — and keeps protocols whose token already trades in a separate
  view, at the market's own values, as the comparables.

## Farm plans

Eight steps per protocol, generated from its own record: the category picks
the playbook, the first chain sets the gas figures, TVL sizes the working
capital, and age sets the weeks of weekly activity. One step weighs the risk
the record itself shows — a seven-day drawdown, a short track record, or a
single chain — and each detail view totals the plan's capital, gas and
minutes from the same figures its steps state.

## Layout

- `main.ts` — the entry program: snapshot in, outputs out.
- `lib/model.ts` — the valuation model, the farm plans and the board.
- `vendor/makefun-board.ts` — the house dossier library, shipped by the kit.
- `dashboard/` — the static page (board, per-protocol detail, live tokens,
  method), rendered from `data.js` with no fetch.
- `screenshots/` — the board, a detail view and a filtered view, rendered
  from this dashboard's own output at 1280×960.
