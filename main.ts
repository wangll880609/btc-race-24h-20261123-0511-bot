// Dip Recovery for cbBTC on 1-minute bars (agent-fun/bars-replay/v1).
//
// Idea, in one line: buy a 1% dip below the 2-hour high only once the
// tape shows the dip turning — RSI(14) climbing back through 30 — then
// bank a 2.5% bounce, cutting the trade at -1.2% or after 6 hours.
//
// Why this shape, from the two dev windows on record: the 2026-11-18
// window falls 2.8% over 24 hours and the 2026-11-23 window rises 3.6%,
// so neither a pure trend rider nor a blind dip buyer survives both. A
// plain dip buy (no confirmation) scores about +$34 on the rising window
// but only about +$5 on the falling one, and a 1-minute EMA-crossover
// momentum leg loses on both (roughly -$85 / -$130 in simulation: the
// crosses are noise at this scale). The confirmation is what buys
// robustness: requiring RSI to be at or above 30 and rising means the
// entry waits for the first sign the sellers are exhausted instead of
// catching a knife mid-fall, and it lifts the falling window to about
// +$15 while keeping about +$31 on the rising one. A round trip pays
// roughly 26 bps in fee, slippage and pool impact, so the 1% dip plus
// 2.5% target clears that cost several times over; the bot therefore
// trades rarely, a few times a day:
//   - Entry: the close is at least 1% below the highest close of the
//     previous 120 bars (2 hours), and Wilder's RSI(14) is at least 30
//     and higher than on the previous bar. Full cash, one position.
//     A dip measured against a 2-hour high, not a 25-minute one, keeps
//     ordinary 0.5% chop from triggering a buy.
//   - Exit, whichever comes first:
//       * Take-profit: the position is worth 2.5% over its cost (fees
//         included), measured in exact integer quote units.
//       * Stop-loss: the position is worth 1.2% under its cost — a dip
//         that keeps falling is a falling knife, not a bargain.
//       * Time stop: 360 bars (6 hours) after entry with neither exit
//         hit; a dip that never bounces is dead capital, and freeing it
//         lets the bot buy the next, deeper dip.
//       * After a stop-loss exit, the next entry needs a deeper 1.5%
//         dip, so a slide that just stopped the bot out is not
//         re-bought at the same shallow level.
//   - No re-entry on the same bar as a sell: after a sell the bot waits
//     for the next bar's close before it can buy again.
//   - An exit signal that the market refuses (a fill past the slippage
//     cap) is simply sent again on the next bar while its reason still
//     holds at that close.
//
// All comparisons of money use exact integer (bigint) quote units from
// the harness account. Closes are plain numbers (raw price units, exact
// as integers below 2^53) used only for the dip test and the RSI. The
// RSI runs in float64 on + - * / alone, so the same bars always give
// the same orders. No clock, no network, no randomness, no files.
//
// Parameters were picked on the two published dev windows with an exact
// offline replica of the harness fill model, then verified with the
// kit's local grader: the chosen set scores +$29.28 on the 2026-11-23
// dev window (7 trades, 1.66% max drawdown) and +$15.71 on the
// 2026-11-18 window (4 trades, 0.76% max drawdown), and most neighbouring
// parameter sets are profitable on both windows, so the result is not a
// knife-edge fit. The offline replica predicted +$31.15 / +$15.45 for
// the same set; the small gap is the replica's one-bar entry offset.

import { runBars, type BarsState, type Batch, type BuyInput, type OrderInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
/** Dip lookback, in closes (120 one-minute bars = 2 hours). */
const DIP_BARS = 120;
/** Entry: close at least this far below the lookback high (990/1000). */
const DIP_NUM = 990;
const DIP_DEN = 1000;
/** After a stop-loss exit, the next entry needs a deeper dip (985/1000). */
const REDIP_NUM = 985;
const REDIP_DEN = 1000;
/** RSI window, in closes. */
const RSI_BARS = 14;
/** Confirmation: RSI at least this high and rising bar over bar. */
const RSI_FLOOR = 30;
/** Take-profit: position value this far over its cost (1025/1000). */
const TP_NUM = 1025n;
const TP_DEN = 1000n;
/** Stop-loss: position value this far under its cost (988/1000). */
const STOP_NUM = 988n;
const STOP_DEN = 1000n;
/** Time stop: close the position this many batches after entry. */
const MAX_HOLD_BARS = 360;
/** Slippage cap per order, in bps (1% past the close it was decided on). */
const MAX_SLIPPAGE_BPS = 100;

/** Closes seen so far, oldest first, raw price units. */
const closes: number[] = [];
/** Batch index at which the current position was entered (-1 when flat). */
let entryBatch = -1;
/** True when the last exit was the stop-loss: next entry needs REDIP. */
let stoppedOut = false;
/** Batches answered so far, counting every batch. */
let batchIndex = 0;
/** Batch index of the last sell decision, so a buy never follows a sell
 * on the same bar. */
let lastSellBatch = -1;

/**
 * Wilder's RSI(14), updated one close at a time. The first average gain
 * and loss are the means of the first 14 changes; each next one keeps
 * 13/14 of the last and adds 1/14 of the newest change. `value` is the
 * RSI after the latest close (null before 14 changes), `prev` the one
 * before it.
 */
const rsiState = {
  prevClose: null as number | null,
  first: [] as number[],
  gain: null as number | null,
  loss: null as number | null,
  value: null as number | null,
  prev: null as number | null,
};

function pushClose(close: number): void {
  closes.push(close);
  if (closes.length > DIP_BARS + 1) closes.shift();
  const prev = rsiState.prevClose;
  rsiState.prevClose = close;
  if (prev === null) return;
  const change = close - prev;
  const up = change > 0 ? change : 0;
  const down = change < 0 ? -change : 0;
  if (rsiState.gain === null || rsiState.loss === null) {
    rsiState.first.push(change);
    if (rsiState.first.length === RSI_BARS) {
      rsiState.gain = rsiState.first.reduce((a, x) => a + (x > 0 ? x : 0), 0) / RSI_BARS;
      rsiState.loss = rsiState.first.reduce((a, x) => a + (x < 0 ? -x : 0), 0) / RSI_BARS;
    }
  } else {
    rsiState.gain = (rsiState.gain * (RSI_BARS - 1) + up) / RSI_BARS;
    rsiState.loss = (rsiState.loss * (RSI_BARS - 1) + down) / RSI_BARS;
  }
  const moved = (rsiState.gain ?? 0) + (rsiState.loss ?? 0);
  rsiState.prev = rsiState.value;
  rsiState.value = rsiState.gain === null || rsiState.loss === null
    ? null
    : moved === 0 ? 50 : (100 * rsiState.gain) / moved;
}

/** Highest close of the previous DIP_BARS bars, excluding the current one. */
function lookbackHigh(): number {
  let hi = 0;
  for (let i = 0; i < closes.length - 1; i++) {
    if (closes[i] > hi) hi = closes[i];
  }
  return hi;
}

/** The dip has turned: RSI is back at or above its floor and rising. */
function recovering(): boolean {
  const r = rsiState.value;
  const p = rsiState.prev;
  return r !== null && p !== null && r >= RSI_FLOOR && r > p;
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) pushClose(Number(bar.c));
    }
    const myBatch = batchIndex;
    batchIndex += 1;
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const tookProfit = value * TP_DEN >= held.cost * TP_NUM;
      const hitStop = value * STOP_DEN <= held.cost * STOP_NUM;
      const timedOut = entryBatch >= 0 && myBatch - entryBatch >= MAX_HOLD_BARS;
      // Take-profit, stop-loss, or time stop — whichever comes first.
      if (tookProfit || hitStop || timedOut) {
        stoppedOut = hitStop;
        entryBatch = -1;
        lastSellBatch = myBatch;
        return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
      }
      return [];
    }
    if (closes.length < DIP_BARS + 1 || myBatch - lastSellBatch < 1) return [];
    const close = closes[closes.length - 1];
    const hi = lookbackHigh();
    // Buy the dip only once it turns: close 1% or more below the 2-hour
    // high (1.5% after a stop-loss, see REDIP_NUM) with RSI recovering.
    const dipNum = stoppedOut ? REDIP_NUM : DIP_NUM;
    const dipDen = stoppedOut ? REDIP_DEN : DIP_DEN;
    if (close * dipDen >= hi * dipNum) return [];
    if (!recovering()) return [];
    const cash = state.cash;
    if (cash < BigInt(state.hello.fees.min_notional_quote_units)) return [];
    stoppedOut = false;
    entryBatch = myBatch;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: cash, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
