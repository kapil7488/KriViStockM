/**
 * Signal Engine — generates Buy/Sell/Hold decisions with:
 * - Hysteresis (stronger evidence needed to flip direction)
 * - 3-bar cooldown between direction changes
 * - Structure-first (4H + 5m alignment required for counter-trend)
 * - Funding as tilt only (not a primary driver)
 * - Multi-factor scoring from all indicators
 */
import type { MultiTFData, KrivisAction, KrivisSignal, HysteresisState, StructureResult } from '../types';
import { COOLDOWN_BARS } from '../types';
import { analyzeStructure } from './structureAnalyzer';
import { lastValid } from './multiTimeframeEngine';

const HYSTERESIS_KEY = 'krivis-hysteresis';

/** Load hysteresis state from localStorage */
function loadHysteresis(symbol: string): HysteresisState | null {
  try {
    const raw = localStorage.getItem(HYSTERESIS_KEY);
    if (!raw) return null;
    const map: Record<string, HysteresisState> = JSON.parse(raw);
    return map[symbol] || null;
  } catch { return null; }
}

/** Save hysteresis state to localStorage */
function saveHysteresis(state: HysteresisState): void {
  try {
    const raw = localStorage.getItem(HYSTERESIS_KEY);
    const map: Record<string, HysteresisState> = raw ? JSON.parse(raw) : {};
    map[state.symbol] = state;
    localStorage.setItem(HYSTERESIS_KEY, JSON.stringify(map));
  } catch { /* ignore */ }
}

/** Score a single factor from 0–100 */
interface FactorScore {
  name: string;
  score: number;    // -100 (extreme bearish) to +100 (extreme bullish)
  weight: number;
}

/** Compute multi-factor scores from both timeframes */
function computeFactors(data: MultiTFData, structure: StructureResult): FactorScore[] {
  const { tf5m, tf4h } = data;
  const factors: FactorScore[] = [];

  // 1. Trend (EMA-20 vs EMA-50 on 4H) — weight: 20%
  const ema20_4h = lastValid(tf4h.ema20);
  const ema50_4h = lastValid(tf4h.ema50);
  const trendScore = ema50_4h !== 0 ? ((ema20_4h - ema50_4h) / ema50_4h) * 1000 : 0;
  factors.push({ name: 'trend', score: Math.max(-100, Math.min(100, trendScore)), weight: 20 });

  // 2. Momentum RSI-14 on 5m — weight: 15%
  const rsi14 = lastValid(tf5m.rsi14);
  // Map RSI: 30→-100, 50→0, 70→+100
  const rsiScore = ((rsi14 - 50) / 20) * 100;
  factors.push({ name: 'rsi14', score: Math.max(-100, Math.min(100, rsiScore)), weight: 15 });

  // 3. RSI-7 (short-term) on 5m — weight: 10%
  const rsi7 = lastValid(tf5m.rsi7);
  const rsi7Score = ((rsi7 - 50) / 20) * 100;
  factors.push({ name: 'rsi7', score: Math.max(-100, Math.min(100, rsi7Score)), weight: 10 });

  // 4. MACD regime on 4H — weight: 15%
  const macdH = lastValid(tf4h.macdHistogram);
  const atr14_4h = lastValid(tf4h.atr14);
  const macdNorm = atr14_4h ? (macdH / atr14_4h) * 100 : 0;
  factors.push({ name: 'macd4h', score: Math.max(-100, Math.min(100, macdNorm)), weight: 15 });

  // 5. MACD on 5m (confirmation) — weight: 10%
  const macd5m = lastValid(tf5m.macdHistogram);
  const atr14_5m = lastValid(tf5m.atr14);
  const macd5mNorm = atr14_5m ? (macd5m / atr14_5m) * 100 : 0;
  factors.push({ name: 'macd5m', score: Math.max(-100, Math.min(100, macd5mNorm)), weight: 10 });

  // 6. ADX trend strength — weight: 10%
  const adxVal = structure.trendStrength;
  // ADX > 25 = strong trend; scale linearly
  const adxScore = structure.trend4h === 'bullish' ? adxVal * 2 : structure.trend4h === 'bearish' ? -adxVal * 2 : 0;
  factors.push({ name: 'adx', score: Math.max(-100, Math.min(100, adxScore)), weight: 10 });

  // 7. OBV momentum (slope of last 10 bars on 5m) — weight: 10%
  const obvArr = tf5m.obv;
  const obvLen = obvArr.length;
  const obvSlope = obvLen >= 10 ? obvArr[obvLen - 1] - obvArr[obvLen - 10] : 0;
  // Normalize OBV slope against absolute level
  const obvBase = Math.abs(obvArr[obvLen - 1]) || 1;
  const obvScore = (obvSlope / obvBase) * 200;
  factors.push({ name: 'obv', score: Math.max(-100, Math.min(100, obvScore)), weight: 10 });

  // 8. Stochastic RSI on 5m — weight: 5%
  const stochK = lastValid(tf5m.stochRsiK);
  const stochRsiScore = ((stochK - 50) / 50) * 100;
  factors.push({ name: 'stochRsi', score: Math.max(-100, Math.min(100, stochRsiScore)), weight: 5 });

  // 9. Bollinger position on 5m — weight: 5% (bonus)
  const bbUp = lastValid(tf5m.bbUpper);
  const bbLow = lastValid(tf5m.bbLower);
  const bbMid = lastValid(tf5m.bbMiddle);
  const close = data.last5mClose;
  const bbRange = bbUp - bbLow || 1;
  const bbPos = ((close - bbLow) / bbRange - 0.5) * 200; // -100 to +100
  factors.push({ name: 'bbPosition', score: Math.max(-100, Math.min(100, bbPos)), weight: 5 });

  return factors;
}

/** Convert weighted factor score to action */
function scoreToAction(compositeScore: number): KrivisAction {
  if (compositeScore >= 20) return 'buy';
  if (compositeScore <= -20) return 'sell';
  return 'hold';
}

/** Compute TP/SL from ATR */
function computeTPSL(
  action: KrivisAction,
  entryPrice: number,
  atr14: number,
): { tp: number; sl: number } {
  if (action === 'hold') return { tp: entryPrice, sl: entryPrice };

  const atrMultSL = 1.5;
  const atrMultTP = 3.0;

  if (action === 'buy') {
    return {
      sl: Math.round((entryPrice - atr14 * atrMultSL) * 100) / 100,
      tp: Math.round((entryPrice + atr14 * atrMultTP) * 100) / 100,
    };
  }
  // sell
  return {
    sl: Math.round((entryPrice + atr14 * atrMultSL) * 100) / 100,
    tp: Math.round((entryPrice - atr14 * atrMultTP) * 100) / 100,
  };
}

export function generateKrivisSignal(data: MultiTFData): KrivisSignal {
  const structure = analyzeStructure(data);
  const factors = computeFactors(data, structure);

  // Weighted composite score: -100 to +100
  let weightedSum = 0;
  let totalWeight = 0;
  for (const f of factors) {
    weightedSum += f.score * f.weight;
    totalWeight += f.weight;
  }
  let compositeScore = totalWeight ? weightedSum / totalWeight : 0;

  // Structure-first gate: counter-trend scalps need higher bar
  let rawAction = scoreToAction(compositeScore);
  if (!structure.aligned && rawAction !== 'hold') {
    // Counter-trend: require 50% stronger signal
    if (Math.abs(compositeScore) < 40) {
      rawAction = 'hold';
    }
  }

  // Breakout bonus: +15 if breakout aligns with action
  if (structure.isBreakout) {
    if ((structure.trend5m === 'bullish' && rawAction === 'buy') ||
        (structure.trend5m === 'bearish' && rawAction === 'sell')) {
      compositeScore += 15;
    }
  }

  // --- Hysteresis & Cooldown ---
  const currentBar = Date.now(); // use timestamp as pseudo-bar index
  const prevState = loadHysteresis(data.symbol);
  let finalAction = rawAction;

  if (prevState) {
    const barsSinceFlip = Math.floor((currentBar - prevState.lastFlipBar) / (5 * 60 * 1000)); // 5m bars

    // Cooldown enforcement: if fewer than 3 bars since last flip, keep previous signal
    if (barsSinceFlip < COOLDOWN_BARS && finalAction !== prevState.lastSignal && finalAction !== 'hold') {
      finalAction = prevState.lastSignal; // hold previous direction
    }

    // Hysteresis: require stronger evidence to flip direction
    if (finalAction !== prevState.lastSignal && finalAction !== 'hold' && prevState.lastSignal !== 'hold') {
      // Need composite > 35 to flip (vs 20 to maintain)
      if (Math.abs(compositeScore) < 35) {
        finalAction = 'hold'; // not strong enough evidence to flip
      }
    }
  }

  // Update hysteresis state
  const newState: HysteresisState = {
    symbol: data.symbol,
    lastSignal: finalAction,
    lastSignalBar: currentBar,
    flipCount: prevState && finalAction !== prevState.lastSignal ? (prevState.flipCount + 1) : (prevState?.flipCount || 0),
    lastFlipBar: prevState && finalAction !== prevState.lastSignal ? currentBar : (prevState?.lastFlipBar || currentBar),
    updatedAt: new Date().toISOString(),
  };
  saveHysteresis(newState);

  // Compute entry/TP/SL
  const entryPrice = data.last5mClose;
  const atr14_5m = lastValid(data.tf5m.atr14);
  const { tp, sl } = computeTPSL(finalAction, entryPrice, atr14_5m);

  // Confidence: |compositeScore| mapped to 0–100
  const confidence = Math.min(100, Math.round(Math.abs(compositeScore)));

  // Build reasoning string
  const topFactors = [...factors].sort((a, b) => Math.abs(b.score * b.weight) - Math.abs(a.score * a.weight)).slice(0, 3);
  const reasonParts: string[] = [];
  reasonParts.push(`4H trend: ${structure.trend4h} (ADX: ${structure.trendStrength.toFixed(1)})`);
  reasonParts.push(`5m trend: ${structure.trend5m} | Aligned: ${structure.aligned ? 'YES' : 'NO'}`);
  if (structure.isBreakout) reasonParts.push('⚡ BREAKOUT detected');
  for (const f of topFactors) {
    reasonParts.push(`${f.name}: ${f.score > 0 ? '+' : ''}${f.score.toFixed(0)} (w:${f.weight}%)`);
  }
  if (prevState && finalAction !== rawAction) {
    reasonParts.push(`[Hysteresis/Cooldown adjusted: ${rawAction} → ${finalAction}]`);
  }

  return {
    symbol: data.symbol,
    action: finalAction,
    confidence,
    entryPrice,
    stopLoss: sl,
    takeProfit: tp,
    reasoning: reasonParts.join(' | '),
    structure,
    riskChecks: [],
    riskBlocked: false,
    timestamp: new Date().toISOString(),
  };
}
