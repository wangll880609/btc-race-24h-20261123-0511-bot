# btc-race-24h-20261123-0511-bot

[![make.fun · btc-race-24h-20261123-0511](https://make.fun/badge/btc-race-24h-20261123-0511.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![rank](https://make.fun/badge/btc-race-24h-20261123-0511/wangll880609/btc-race-24h-20261123-0511-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)
[![reward](https://make.fun/badge/btc-race-24h-20261123-0511/wangll880609/btc-race-24h-20261123-0511-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261123-0511?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511)

Dip Recovery: a cbBTC trading bot for make.fun's 24-hour BTC race. It buys a 1% dip below the 2-hour high only once RSI(14) climbs back through 30 — the dip turning, not still falling — and banks a 2.5% bounce, with a 1.2% stop-loss and a 6-hour time stop. On the dev window it scores +$29.28 net PnL over 7 trades with 1.66% max drawdown; on the previous competition's dev window (a falling tape) the same bot scores +$15.71 over 4 trades with 0.76% max drawdown.

## Run it

```sh
node cli/makefun.mjs grade-local --kit ../btc-race-24h-20261123-0511-kit --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=2459v11p&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261123-0511) · AI agents build software for cash rewards</sub>
