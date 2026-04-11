import { StockQuote } from '../types';
import {
  vwap as calcVwap, atr as calcAtr, computeFullIndicators,
} from './indicators';

// ── Strategy definitions ───────────────────────────────────────
export type StrategyId =
  | 'vwap' | 'rsi' | 'macd' | 'bollinger' | 'stochastic' | 'sma-cross' | 'ema-cross' | 'atr-breakout'
  | 'combo-momentum' | 'combo-trend' | 'combo-mean-revert' | 'combo-breakout' | 'combo-swing'
  | 'ml-ensemble';

export interface StrategyDef {
  id: StrategyId;
  label: string;
  emoji: string;
  description: string;
  category: 'single' | 'combo' | 'algo';
}

export const STRATEGIES: StrategyDef[] = [
  // Single indicators
  { id: 'vwap', label: 'VWAP Cross', emoji: '📏', description: 'Buy on bull cross above VWAP, sell on bear cross', category: 'single' },
  { id: 'rsi', label: 'RSI (14)', emoji: '📈', description: 'Buy on oversold (<30), sell on overbought (>70)', category: 'single' },
  { id: 'macd', label: 'MACD Crossover', emoji: '📊', description: 'Buy on bull cross, sell on bear cross', category: 'single' },
  { id: 'bollinger', label: 'Bollinger Bands', emoji: '🎯', description: 'Buy at lower band, sell at upper band', category: 'single' },
  { id: 'stochastic', label: 'Stochastic', emoji: '🔄', description: 'Buy on %K/%D bull cross oversold, sell overbought', category: 'single' },
  { id: 'sma-cross', label: 'SMA Cross (50/200)', emoji: '✂️', description: 'Buy on golden cross, sell on death cross', category: 'single' },
  { id: 'ema-cross', label: 'EMA Cross (12/26)', emoji: '⚡', description: 'Buy on EMA12 > EMA26 cross, sell on reverse', category: 'single' },
  { id: 'atr-breakout', label: 'ATR Breakout', emoji: '🌊', description: 'Buy on volatility expansion breakout, sell on contraction', category: 'single' },
  // Combos
  { id: 'combo-momentum', label: 'Momentum (RSI+MACD+Stoch)', emoji: '🚀', description: '3-indicator confluence for momentum trades', category: 'combo' },
  { id: 'combo-trend', label: 'Trend (SMA+EMA+MACD)', emoji: '📈', description: 'Triple trend confirmation strategy', category: 'combo' },
  { id: 'combo-mean-revert', label: 'Mean Revert (RSI+BB+Stoch)', emoji: '🔁', description: 'Mean reversion using oscillators + bands', category: 'combo' },
  { id: 'combo-breakout', label: 'Breakout (BB+ATR+VWAP)', emoji: '💥', description: 'Squeeze breakout with volume confirmation', category: 'combo' },
  { id: 'combo-swing', label: 'Swing (EMA+RSI+VWAP)', emoji: '🏄', description: 'Swing trade setup with trend + momentum + volume', category: 'combo' },
  // ML Algo
  { id: 'ml-ensemble', label: 'ML Ensemble (4-Model)', emoji: '🤖', description: 'LSTM-Transformer + XGBoost + GA-LSTM + H-BLSTM', category: 'algo' },
];

// ── Backtest config ────────────────────────────────────────────
export type HoldingPeriod = 'swing' | 'longterm';

export interface BacktestConfig {
  strategy: StrategyId;
  holdingPeriod: HoldingPeriod;
  initialCapital: number;
  riskPerTradePct: number;     // % of capital risked per trade
  stopLossPct: number;         // hard SL %
  takeProfitPct: number;       // hard TP %
  commissionPct: number;       // round-trip commission %
}

// ── Backtest results ───────────────────────────────────────────
export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  type: 'Long' | 'Short';
  entryPrice: number;
  exitPrice: number;
  shares: number;
  pnl: number;
  pnlPct: number;
  exitReason: 'TP' | 'SL' | 'Signal' | 'End';
  holdingDays: number;
}

export interface BacktestResult {
  strategy: StrategyDef;
  holdingPeriod: HoldingPeriod;
  symbol: string;
  dataRange: string;
  totalBars: number;
  initialCapital: number;
  finalCapital: number;
  netProfit: number;
  netProfitPct: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgWin: number;
  avgLoss: number;
  avgHoldingDays: number;
  longestWinStreak: number;
  longestLoseStreak: number;
  trades: BacktestTrade[];
  equityCurve: { date: string; equity: number }[];
}

// ── Signal generation per strategy ─────────────────────────────
type BarSignal = 'buy' | 'sell' | 'none';

interface PrecomputedIndicators {
  vwapArr: number[];
  rsiArr: number[];
  macdLine: number[];
  macdSignal: number[];
  macdHist: number[];
  bbUpper: number[];
  bbMiddle: number[];
  bbLower: number[];
  stochK: number[];
  stochD: number[];
  sma50: number[];
  sma200: number[];
  ema12: number[];
  ema26: number[];
  atrArr: number[];
}

function precompute(quotes: StockQuote[]): PrecomputedIndicators {
  const full = computeFullIndicators(quotes);
  const vwapArr = calcVwap(quotes);
  const atrArr = calcAtr(quotes);
  return {
    vwapArr,
    rsiArr: full.rsi,
    macdLine: full.macdLine,
    macdSignal: full.macdSignal,
    macdHist: full.macdHistogram,
    bbUpper: full.bollingerUpper,
    bbMiddle: full.bollingerMiddle,
    bbLower: full.bollingerLower,
    stochK: full.stochK,
    stochD: full.stochD,
    sma50: full.sma50,
    sma200: full.sma200,
    ema12: full.ema12,
    ema26: full.ema26,
    atrArr,
  };
}

// Min bars needed before any strategy can fire
const MIN_WARMUP = 201;

function signalVwap(i: number, quotes: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 1 || ind.vwapArr[i] <= 0) return 'none';
  const prevAbove = quotes[i - 1].close > ind.vwapArr[i - 1];
  const currAbove = quotes[i].close > ind.vwapArr[i];
  if (!prevAbove && currAbove) return 'buy';
  if (prevAbove && !currAbove) return 'sell';
  return 'none';
}

function signalRsi(i: number, _q: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (ind.rsiArr[i] === 0) return 'none';
  const prev = ind.rsiArr[i - 1];
  const curr = ind.rsiArr[i];
  // Buy when crossing up through 30, sell when crossing down through 70
  if (prev < 30 && curr >= 30) return 'buy';
  if (prev <= 30 && curr <= 30 && i > 1 && ind.rsiArr[i - 2] > 30) return 'buy'; // just entered oversold
  if (prev > 70 && curr <= 70) return 'sell';
  if (curr < 30) return 'buy';
  if (curr > 70) return 'sell';
  return 'none';
}

function signalMacd(i: number, _q: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 1 || ind.macdLine[i] === 0) return 'none';
  const prevLine = ind.macdLine[i - 1], prevSig = ind.macdSignal[i - 1];
  const line = ind.macdLine[i], sig = ind.macdSignal[i];
  if (prevLine <= prevSig && line > sig) return 'buy';
  if (prevLine >= prevSig && line < sig) return 'sell';
  return 'none';
}

function signalBollinger(i: number, quotes: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (ind.bbUpper[i] === 0) return 'none';
  const close = quotes[i].close;
  const prevClose = quotes[i - 1].close;
  // Buy: price bouncing off lower band
  if (prevClose <= ind.bbLower[i - 1] && close > ind.bbLower[i]) return 'buy';
  if (close <= ind.bbLower[i]) return 'buy';
  // Sell: price rejected at upper band
  if (prevClose >= ind.bbUpper[i - 1] && close < ind.bbUpper[i]) return 'sell';
  if (close >= ind.bbUpper[i]) return 'sell';
  return 'none';
}

function signalStochastic(i: number, _q: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 1 || (ind.stochK[i] === 0 && ind.stochD[i] === 0)) return 'none';
  const prevK = ind.stochK[i - 1], prevD = ind.stochD[i - 1];
  const k = ind.stochK[i], d = ind.stochD[i];
  if (k < 20 && prevK <= prevD && k > d) return 'buy';
  if (k > 80 && prevK >= prevD && k < d) return 'sell';
  if (prevK <= prevD && k > d) return 'buy';
  if (prevK >= prevD && k < d) return 'sell';
  return 'none';
}

function signalSmaCross(i: number, _q: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 1 || ind.sma200[i] === 0) return 'none';
  const prev50 = ind.sma50[i - 1], prev200 = ind.sma200[i - 1];
  const s50 = ind.sma50[i], s200 = ind.sma200[i];
  if (prev50 <= prev200 && s50 > s200) return 'buy';
  if (prev50 >= prev200 && s50 < s200) return 'sell';
  return 'none';
}

function signalEmaCross(i: number, _q: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 1 || ind.ema26[i] === 0) return 'none';
  const prevE12 = ind.ema12[i - 1], prevE26 = ind.ema26[i - 1];
  const e12 = ind.ema12[i], e26 = ind.ema26[i];
  if (prevE12 <= prevE26 && e12 > e26) return 'buy';
  if (prevE12 >= prevE26 && e12 < e26) return 'sell';
  return 'none';
}

function signalAtrBreakout(i: number, quotes: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 21 || ind.atrArr[i] === 0) return 'none';
  // ATR expansion: current ATR > 1.5× average of last 20
  let atrSum = 0;
  for (let j = i - 20; j < i; j++) atrSum += ind.atrArr[j];
  const avgAtr = atrSum / 20;
  const expanding = ind.atrArr[i] > avgAtr * 1.5;
  if (!expanding) return 'none';
  // Direction: close relative to previous close
  if (quotes[i].close > quotes[i - 1].close) return 'buy';
  if (quotes[i].close < quotes[i - 1].close) return 'sell';
  return 'none';
}

// Combo: majority vote from sub-signal functions
function comboSignal(fns: Array<(i: number, q: StockQuote[], ind: PrecomputedIndicators) => BarSignal>, i: number, quotes: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  let buy = 0, sell = 0;
  for (const fn of fns) {
    const s = fn(i, quotes, ind);
    if (s === 'buy') buy++;
    if (s === 'sell') sell++;
  }
  const majority = Math.ceil(fns.length / 2);
  if (buy >= majority) return 'buy';
  if (sell >= majority) return 'sell';
  return 'none';
}

// ML ensemble signal: uses precomputed indicators for O(1) per bar
function signalMlEnsemble(i: number, quotes: StockQuote[], ind: PrecomputedIndicators): BarSignal {
  if (i < 201) return 'none';

  let bullish = 0, bearish = 0;

  // RSI
  if (ind.rsiArr[i] > 0 && ind.rsiArr[i] < 40) bullish++;
  else if (ind.rsiArr[i] > 60) bearish++;

  // MACD
  if (ind.macdLine[i] > ind.macdSignal[i]) bullish++;
  else if (ind.macdLine[i] < ind.macdSignal[i]) bearish++;

  // Stochastic
  if (ind.stochK[i] < 30) bullish++;
  else if (ind.stochK[i] > 70) bearish++;

  // EMA cross
  if (ind.ema12[i] > ind.ema26[i]) bullish++;
  else bearish++;

  // SMA cross (if available)
  if (ind.sma200[i] > 0) {
    if (ind.sma50[i] > ind.sma200[i]) bullish++;
    else bearish++;
  }

  // Trend: linear regression on last 20 closes
  const start = Math.max(0, i - 19);
  const len = i - start + 1;
  const xm = (len - 1) / 2;
  let num = 0, den = 0;
  for (let j = 0; j < len; j++) { num += (j - xm) * quotes[start + j].close; den += (j - xm) ** 2; }
  const slope = den > 0 ? num / den : 0;
  if (slope > 0) bullish++;
  else bearish++;

  // Need strong consensus (>=4 of 6)
  if (bullish >= 4) return 'buy';
  if (bearish >= 4) return 'sell';
  return 'none';
}

function getSignalFn(strategy: StrategyId): (i: number, q: StockQuote[], ind: PrecomputedIndicators) => BarSignal {
  switch (strategy) {
    case 'vwap': return signalVwap;
    case 'rsi': return signalRsi;
    case 'macd': return signalMacd;
    case 'bollinger': return signalBollinger;
    case 'stochastic': return signalStochastic;
    case 'sma-cross': return signalSmaCross;
    case 'ema-cross': return signalEmaCross;
    case 'atr-breakout': return signalAtrBreakout;
    case 'combo-momentum': return (i, q, ind) => comboSignal([signalRsi, signalMacd, signalStochastic], i, q, ind);
    case 'combo-trend': return (i, q, ind) => comboSignal([signalSmaCross, signalEmaCross, signalMacd], i, q, ind);
    case 'combo-mean-revert': return (i, q, ind) => comboSignal([signalRsi, signalBollinger, signalStochastic], i, q, ind);
    case 'combo-breakout': return (i, q, ind) => comboSignal([signalBollinger, signalAtrBreakout, signalVwap], i, q, ind);
    case 'combo-swing': return (i, q, ind) => comboSignal([signalEmaCross, signalRsi, signalVwap], i, q, ind);
    case 'ml-ensemble': return signalMlEnsemble;
    default: return () => 'none';
  }
}

// ── Core backtest engine ───────────────────────────────────────
/** Precompute indicators once — reuse across multiple strategy runs */
export function precomputeIndicators(quotes: StockQuote[]): PrecomputedIndicators {
  return precompute(quotes);
}

export function runBacktest(symbol: string, quotes: StockQuote[], config: BacktestConfig, cachedInd?: PrecomputedIndicators): BacktestResult {
  const stratDef = STRATEGIES.find(s => s.id === config.strategy)!;
  const signalFn = getSignalFn(config.strategy);
  const ind = cachedInd ?? precompute(quotes);

  let capital = config.initialCapital;
  let peakCapital = capital;
  let maxDrawdown = 0;
  const trades: BacktestTrade[] = [];
  const equityCurve: { date: string; equity: number }[] = [];

  // Holding period determines max hold bars: swing = 5-20 days, long = unlimited
  const maxHoldBars = config.holdingPeriod === 'swing' ? 20 : Infinity;

  // Position state
  let inPosition = false;
  let posType: 'Long' | 'Short' = 'Long';
  let entryPrice = 0;
  let entryIdx = 0;
  let shares = 0;
  let stopPrice = 0;
  let targetPrice = 0;

  for (let i = MIN_WARMUP; i < quotes.length; i++) {
    const bar = quotes[i];
    const close = bar.close;

    if (inPosition) {
      const holdingDays = i - entryIdx;
      let exitReason: BacktestTrade['exitReason'] | null = null;
      let exitPrice = 0;

      if (posType === 'Long') {
        // Check SL/TP using high/low of bar (realistic)
        if (bar.low <= stopPrice) { exitReason = 'SL'; exitPrice = stopPrice; }
        else if (bar.high >= targetPrice) { exitReason = 'TP'; exitPrice = targetPrice; }
      } else {
        if (bar.high >= stopPrice) { exitReason = 'SL'; exitPrice = stopPrice; }
        else if (bar.low <= targetPrice) { exitReason = 'TP'; exitPrice = targetPrice; }
      }

      // Max holding period exit
      if (!exitReason && holdingDays >= maxHoldBars) {
        exitReason = 'Signal';
        exitPrice = close;
      }

      // Opposite signal exit
      if (!exitReason) {
        const sig = signalFn(i, quotes, ind);
        if (posType === 'Long' && sig === 'sell') { exitReason = 'Signal'; exitPrice = close; }
        if (posType === 'Short' && sig === 'buy') { exitReason = 'Signal'; exitPrice = close; }
      }

      if (exitReason) {
        const grossPnl = posType === 'Long'
          ? (exitPrice - entryPrice) * shares
          : (entryPrice - exitPrice) * shares;
        const commission = (entryPrice * shares + exitPrice * shares) * (config.commissionPct / 100);
        const netPnl = grossPnl - commission;
        capital += netPnl;

        trades.push({
          entryDate: quotes[entryIdx].timestamp,
          exitDate: bar.timestamp,
          type: posType,
          entryPrice: r2(entryPrice),
          exitPrice: r2(exitPrice),
          shares,
          pnl: r2(netPnl),
          pnlPct: r2((netPnl / (entryPrice * shares)) * 100),
          exitReason,
          holdingDays: holdingDays,
        });

        inPosition = false;
      }
    }

    // Entry logic (only if not in position)
    if (!inPosition && i < quotes.length - 1) {
      const sig = signalFn(i, quotes, ind);
      if (sig === 'buy' || sig === 'sell') {
        const riskAmount = capital * (config.riskPerTradePct / 100);
        const slDist = close * (config.stopLossPct / 100);
        if (slDist <= 0) continue;
        shares = Math.max(1, Math.floor(riskAmount / slDist));
        const positionCost = shares * close;
        // Don't exceed available capital
        if (positionCost > capital * 0.95) {
          shares = Math.max(1, Math.floor((capital * 0.95) / close));
        }
        if (shares < 1) continue;

        posType = sig === 'buy' ? 'Long' : 'Short';
        entryPrice = close;
        entryIdx = i;
        inPosition = true;

        if (posType === 'Long') {
          stopPrice = r2(close * (1 - config.stopLossPct / 100));
          targetPrice = r2(close * (1 + config.takeProfitPct / 100));
        } else {
          stopPrice = r2(close * (1 + config.stopLossPct / 100));
          targetPrice = r2(close * (1 - config.takeProfitPct / 100));
        }
      }
    }

    // Equity tracking
    let unrealized = 0;
    if (inPosition) {
      unrealized = posType === 'Long'
        ? (close - entryPrice) * shares
        : (entryPrice - close) * shares;
    }
    const eq = capital + unrealized;
    equityCurve.push({ date: bar.timestamp, equity: r2(eq) });
    if (eq > peakCapital) peakCapital = eq;
    const dd = peakCapital - eq;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // Force close if still in position at end
  if (inPosition) {
    const lastBar = quotes[quotes.length - 1];
    const exitPrice = lastBar.close;
    const grossPnl = posType === 'Long'
      ? (exitPrice - entryPrice) * shares
      : (entryPrice - exitPrice) * shares;
    const commission = (entryPrice * shares + exitPrice * shares) * (config.commissionPct / 100);
    const netPnl = grossPnl - commission;
    capital += netPnl;
    trades.push({
      entryDate: quotes[entryIdx].timestamp,
      exitDate: lastBar.timestamp,
      type: posType,
      entryPrice: r2(entryPrice),
      exitPrice: r2(exitPrice),
      shares,
      pnl: r2(netPnl),
      pnlPct: r2((netPnl / (entryPrice * shares)) * 100),
      exitReason: 'End',
      holdingDays: quotes.length - 1 - entryIdx,
    });
  }

  // Compute metrics
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));

  // Streaks
  let curWin = 0, curLose = 0, maxWin = 0, maxLose = 0;
  for (const t of trades) {
    if (t.pnl > 0) { curWin++; curLose = 0; maxWin = Math.max(maxWin, curWin); }
    else { curLose++; curWin = 0; maxLose = Math.max(maxLose, curLose); }
  }

  // Sharpe ratio (annualized from daily equity returns)
  const dailyReturns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev > 0) dailyReturns.push((equityCurve[i].equity - prev) / prev);
  }
  const avgReturn = dailyReturns.length > 0 ? dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length : 0;
  const stdReturn = dailyReturns.length > 1
    ? Math.sqrt(dailyReturns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (dailyReturns.length - 1))
    : 0;
  const sharpe = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  const netProfit = capital - config.initialCapital;

  return {
    strategy: stratDef,
    holdingPeriod: config.holdingPeriod,
    symbol,
    dataRange: `${quotes[MIN_WARMUP]?.timestamp?.split('T')[0] || ''} → ${quotes[quotes.length - 1]?.timestamp?.split('T')[0] || ''}`,
    totalBars: quotes.length - MIN_WARMUP,
    initialCapital: config.initialCapital,
    finalCapital: r2(capital),
    netProfit: r2(netProfit),
    netProfitPct: r2((netProfit / config.initialCapital) * 100),
    totalTrades: trades.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: trades.length > 0 ? r2((wins.length / trades.length) * 100) : 0,
    profitFactor: grossLoss > 0 ? r2(grossProfit / grossLoss) : grossProfit > 0 ? 999 : 0,
    maxDrawdown: r2(maxDrawdown),
    maxDrawdownPct: peakCapital > 0 ? r2((maxDrawdown / peakCapital) * 100) : 0,
    sharpeRatio: r2(sharpe),
    avgWin: wins.length > 0 ? r2(grossProfit / wins.length) : 0,
    avgLoss: losses.length > 0 ? r2(grossLoss / losses.length) : 0,
    avgHoldingDays: trades.length > 0 ? r2(trades.reduce((s, t) => s + t.holdingDays, 0) / trades.length) : 0,
    longestWinStreak: maxWin,
    longestLoseStreak: maxLose,
    trades,
    equityCurve,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
