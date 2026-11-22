# Token Launch Radar

A dashboard that ranks protocols by the implied value of the token they may one day issue, with a farm plan for each, for the make.fun bounty "Build the best token launch radar".

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/musemuseng/makefun-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/musemuseng/makefun-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

## About

`main.ts` reads a snapshot of pre-token protocols and writes a ranked board (`board.json`), a static offline dashboard, screenshots, and a dossier. Implied values come from a comps model: TVL times a category multiple derived from already-issued peers in the same snapshot, shrunk toward the global median and adjusted for growth and track record. Every row carries a 7-step farm plan with per-step cost and time. Practice snapshot: all 7 submission gates pass, watchlist coverage 40/40, 198 board rows, byte-identical output across runs.
