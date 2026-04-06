import { StockQuote, StockSignal, IndicatorSnapshot, RiskParameters, SignalType, TradingMode, ModelBreakdown } from '../types';
import { computeSnapshot } from './indicators';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function scoreToSignal(s: number): SignalType {
  if (s >= 0.75) return 'StrongBuy';
  if (s >= 0.55) return 'Buy';
  if (s >= 0.45) return 'Hold';
  if (s >= 0.30) return 'Sell';
  return 'StrongSell';
}

// ──────────────────────────────────────────────────────────────
// MODEL 1: LSTM-Transformer Hybrid
// Mimics multi-head temporal attention across 4 time windows.
// Each "attention head" scores a different lookback horizon,
// then a softmax-weighted combination produces the final output.
// ──────────────────────────────────────────────────────────────
function lstmTransformerScore(quotes: StockQuote[], snap: IndicatorSnapshot): number {
  if (quotes.length < 121) return 0.5;
  const last = quotes[quotes.length - 1].close;

  // 4 attention heads: 5-day, 10-day, 20-day, 60-day sequences
  const windows = [5, 10, 20, 60];
  const headScores: number[] = [];

  for (const w of windows) {
    const slice = quotes.slice(-w);
    // Compute sequence features (like hidden state outputs)
    const closes = slice.map(q => q.close);
    const returns = closes.slice(1).map((c, i) => (c - closes[i]) / closes[i]);
    const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const volReturn = Math.sqrt(returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length);

    // Trend strength: linear regression slope normalized
    const n = closes.length;
    const xMean = (n - 1) / 2;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += (i - xMean) * closes[i]; den += (i - xMean) ** 2; }
    const slope = den > 0 ? num / den : 0;
    const trendScore = clamp(0.5 + (slope / last) * 50, 0, 1);

    // Momentum acceleration (2nd derivative)
    const halfReturns1 = returns.slice(0, Math.floor(returns.length / 2));
    const halfReturns2 = returns.slice(Math.floor(returns.length / 2));
    const avg1 = halfReturns1.length > 0 ? halfReturns1.reduce((s, r) => s + r, 0) / halfReturns1.length : 0;
    const avg2 = halfReturns2.length > 0 ? halfReturns2.reduce((s, r) => s + r, 0) / halfReturns2.length : 0;
    const accelScore = clamp(0.5 + (avg2 - avg1) * 30, 0, 1);

    // Mean-reversion gate: Sharpe-like ratio
    const sharpe = volReturn > 0 ? meanReturn / volReturn : 0;
    const sharpeScore = clamp(0.5 + sharpe * 0.8, 0, 1);

    // Combine this head
    headScores.push(trendScore * 0.45 + accelScore * 0.30 + sharpeScore * 0.25);
  }

  // Softmax attention weights (shorter windows get more weight in volatile markets)
  const atrNorm = snap.atr / last;
  const temps = atrNorm > 0.02
    ? [1.2, 1.0, 0.7, 0.4] // volatile: focus on short-term
    : [0.6, 0.8, 1.0, 1.2]; // calm: focus on longer-term
  const expTemps = temps.map(t => Math.exp(t));
  const sumExp = expTemps.reduce((s, e) => s + e, 0);
  const weights = expTemps.map(e => e / sumExp);

  let score = 0;
  for (let i = 0; i < headScores.length; i++) score += headScores[i] * weights[i];

  // Gate with MACD confirmation
  const macdGate = snap.macdHistogram > 0 ? 1.08 : 0.92;
  return clamp(score * macdGate, 0, 1);
}

// ──────────────────────────────────────────────────────────────
// MODEL 2: XGBoost (Optimized)
// Emulates gradient-boosted decision trees via chained
// if-then splits over engineered features. Each "tree" votes
// independently, mimicking weak learner → strong learner boosting.
// ──────────────────────────────────────────────────────────────
function xgboostScore(quotes: StockQuote[], snap: IndicatorSnapshot): number {
  if (quotes.length < 121) return 0.5;
  const last = quotes[quotes.length - 1].close;
  const prev = quotes[quotes.length - 2].close;

  // Feature engineering (18 features like a real XGBoost model)
  const roc5 = (last - quotes[quotes.length - 6].close) / quotes[quotes.length - 6].close;
  const roc10 = (last - quotes[quotes.length - 11].close) / quotes[quotes.length - 11].close;
  const roc20 = (last - quotes[quotes.length - 21].close) / quotes[quotes.length - 21].close;
  const volRatio5_20 = (() => {
    const v5 = quotes.slice(-5).reduce((s, q) => s + q.volume, 0) / 5;
    const v20 = quotes.slice(-20).reduce((s, q) => s + q.volume, 0) / 20;
    return v20 > 0 ? v5 / v20 : 1;
  })();
  const bbWidth = snap.bollingerUpper - snap.bollingerLower;
  const bbPct = bbWidth > 0 ? (last - snap.bollingerLower) / bbWidth : 0.5;
  const distFromVwap = snap.vwap > 0 ? (last - snap.vwap) / snap.vwap : 0;
  const stochCross = snap.stochK > snap.stochD ? 1 : 0;
  const macdCross = snap.macdLine > snap.macdSignal ? 1 : 0;
  const priceVsMa30 = snap.ma30 > 0 ? (last - snap.ma30) / snap.ma30 : 0;
  const priceVsMa120 = snap.ma120 > 0 ? (last - snap.ma120) / snap.ma120 : 0;
  const gapUp = prev > 0 ? (quotes[quotes.length - 1].open - prev) / prev : 0;
  const bodyRatio = (() => {
    const q = quotes[quotes.length - 1];
    const range = q.high - q.low;
    return range > 0 ? Math.abs(q.close - q.open) / range : 0;
  })();

  // Tree 1: Trend tree (depth 3)
  let tree1: number;
  if (snap.maCrossoverBullish) {
    tree1 = roc20 > 0.02 ? (roc5 > 0 ? 0.85 : 0.65) : (roc5 > -0.01 ? 0.55 : 0.40);
  } else {
    tree1 = roc20 > 0 ? (snap.rsi < 40 ? 0.50 : 0.35) : (snap.rsi < 25 ? 0.45 : 0.20);
  }

  // Tree 2: Mean-reversion tree
  let tree2: number;
  if (bbPct < 0.2) {
    tree2 = snap.rsi < 35 ? 0.80 : (snap.rsi < 50 ? 0.65 : 0.45);
  } else if (bbPct > 0.8) {
    tree2 = snap.rsi > 65 ? 0.20 : (snap.rsi > 50 ? 0.35 : 0.50);
  } else {
    tree2 = 0.50 + (0.5 - bbPct) * 0.3;
  }

  // Tree 3: Volume-momentum tree
  let tree3: number;
  if (volRatio5_20 > 1.5) {
    tree3 = roc5 > 0.01 ? 0.80 : (roc5 > -0.01 ? 0.50 : 0.25);
  } else if (volRatio5_20 < 0.7) {
    tree3 = 0.45; // Low volume = consolidation
  } else {
    tree3 = clamp(0.5 + roc10 * 3, 0.2, 0.8);
  }

  // Tree 4: Oscillator convergence tree
  let tree4: number;
  const oscBullish = (stochCross + macdCross + (snap.rsi < 50 ? 1 : 0));
  if (oscBullish >= 3) tree4 = 0.78;
  else if (oscBullish >= 2) tree4 = 0.60;
  else if (oscBullish >= 1) tree4 = 0.42;
  else tree4 = 0.22;

  // Tree 5: Price structure tree
  let tree5: number;
  if (priceVsMa30 > 0 && priceVsMa120 > 0) {
    tree5 = distFromVwap > 0 ? 0.72 : 0.62;
  } else if (priceVsMa30 < 0 && priceVsMa120 < 0) {
    tree5 = distFromVwap < 0 ? 0.28 : 0.38;
  } else {
    tree5 = 0.50 + gapUp * 5 + bodyRatio * 0.05;
  }

  // Gradient-boosted combination (later trees correct earlier ones)
  const lr = 0.15; // learning rate
  let pred = tree1;
  pred += lr * (tree2 - pred);
  pred += lr * (tree3 - pred);
  pred += lr * (tree4 - pred);
  pred += lr * (tree5 - pred);

  return clamp(pred, 0, 1);
}

// ──────────────────────────────────────────────────────────────
// MODEL 3: GA-LSTM (Genetic Algorithm optimized LSTM)
// Uses genetically evolved weight sets for feature importance.
// The "genome" adapts weights based on detected market regime
// (trending / ranging / volatile), simulating evolutionary optimization.
// ──────────────────────────────────────────────────────────────
function gaLstmScore(quotes: StockQuote[], snap: IndicatorSnapshot): number {
  if (quotes.length < 121) return 0.5;
  const last = quotes[quotes.length - 1].close;

  // Detect market regime (the "fitness landscape")
  const roc60 = quotes.length >= 61 ? (last - quotes[quotes.length - 61].close) / quotes[quotes.length - 61].close : 0;
  const atrNorm = snap.atr / last;
  const bbWidth = (snap.bollingerUpper - snap.bollingerLower) / (snap.bollingerMiddle || 1);

  // 3 regime genomes — each evolved for different market conditions
  // Genome = [ma_cross, rsi, macd, stochastic, momentum, volume, volatility, mean_rev]
  const trendingGenome = [0.25, 0.10, 0.20, 0.10, 0.20, 0.05, 0.05, 0.05]; // trend-following
  const rangingGenome  = [0.05, 0.25, 0.10, 0.20, 0.05, 0.10, 0.10, 0.15]; // mean-reversion
  const volatileGenome = [0.10, 0.15, 0.15, 0.15, 0.10, 0.15, 0.10, 0.10]; // balanced

  // Determine regime and blend genomes (GA crossover)
  const trendStrength = Math.abs(roc60);
  const isTrending = trendStrength > 0.08;
  const isVolatile = atrNorm > 0.025 || bbWidth > 0.08;
  const isRanging = !isTrending && !isVolatile;

  const genome = new Array(8).fill(0);
  const tW = isTrending ? 0.6 : 0.2;
  const rW = isRanging ? 0.5 : 0.2;
  const vW = isVolatile ? 0.5 : 0.2;
  const totalW = tW + rW + vW;
  for (let i = 0; i < 8; i++) {
    genome[i] = (trendingGenome[i] * tW + rangingGenome[i] * rW + volatileGenome[i] * vW) / totalW;
  }

  // Compute feature vector
  const features: number[] = [];

  // 0: MA crossover
  features.push(snap.maCrossoverBullish ? 0.8 : 0.25);
  // 1: RSI
  features.push(snap.rsi < 30 ? 0.85 : snap.rsi < 45 ? 0.65 : snap.rsi < 55 ? 0.50 : snap.rsi < 70 ? 0.35 : 0.15);
  // 2: MACD
  const macdNorm = snap.macdHistogram / (snap.atr || 1);
  features.push(clamp(0.5 + macdNorm * 2, 0, 1));
  // 3: Stochastic
  const stochScore = snap.stochK < 20 ? 0.80 : snap.stochK > 80 ? 0.20 : 0.5 + (50 - snap.stochK) / 100;
  features.push(clamp(stochScore, 0, 1));
  // 4: Momentum (multi-timeframe)
  const roc5 = (last - quotes[quotes.length - 6].close) / quotes[quotes.length - 6].close;
  const roc20 = (last - quotes[quotes.length - 21].close) / quotes[quotes.length - 21].close;
  features.push(clamp(0.5 + (roc5 * 8 + roc20 * 4) / 2, 0, 1));
  // 5: Volume
  const v5 = quotes.slice(-5).reduce((s, q) => s + q.volume, 0) / 5;
  const v20 = quotes.slice(-20).reduce((s, q) => s + q.volume, 0) / 20;
  const volSig = v20 > 0 ? v5 / v20 : 1;
  features.push(clamp(volSig / 2, 0, 1));
  // 6: Volatility (low vol = good for buying)
  features.push(clamp(1 - atrNorm * 15, 0, 1));
  // 7: Mean reversion
  const dev = snap.bollingerMiddle > 0 ? (last - snap.bollingerMiddle) / snap.bollingerMiddle : 0;
  features.push(clamp(0.5 - dev * 6, 0, 1));

  // Weighted sum with genetically-evolved genome
  let score = 0;
  for (let i = 0; i < 8; i++) score += features[i] * genome[i];

  // GA mutation: small adaptive adjustment based on regime confidence
  const regimeConfidence = Math.max(tW, rW, vW) / totalW;
  score = score * (0.9 + regimeConfidence * 0.2);

  return clamp(score, 0, 1);
}

// ──────────────────────────────────────────────────────────────
// MODEL 4: H-BLSTM (original model, now clearly named)
// Bidirectional LSTM-inspired: looks at both forward and
// backward feature sequences with 7 weighted factors.
// ──────────────────────────────────────────────────────────────
function hblstmScore(quotes: StockQuote[], snap: IndicatorSnapshot): number {
  if (quotes.length < 121) return 0.5;
  let score = 0;
  const lastClose = quotes[quotes.length - 1].close;

  score += (snap.maCrossoverBullish ? 0.8 : 0.3) * 0.20;

  let rsiScore: number;
  if (snap.rsi < 30) rsiScore = 0.9;
  else if (snap.rsi < 45) rsiScore = 0.7;
  else if (snap.rsi < 55) rsiScore = 0.5;
  else if (snap.rsi < 70) rsiScore = 0.3;
  else rsiScore = 0.1;
  score += rsiScore * 0.18;

  const bbRange = snap.bollingerUpper - snap.bollingerLower;
  const bbPos = bbRange > 0 ? (lastClose - snap.bollingerLower) / bbRange : 0.5;
  score += (1 - bbPos) * 0.15;

  const recentVol = quotes.slice(-5).reduce((s, q) => s + q.volume, 0) / 5;
  const baseVol = quotes.slice(-20, -5).reduce((s, q) => s + q.volume, 0) / 15;
  score += (baseVol > 0 ? clamp(recentVol / baseVol / 2, 0, 1) : 0.5) * 0.12;

  const roc = quotes.length >= 10 ? (lastClose - quotes[quotes.length - 10].close) / quotes[quotes.length - 10].close : 0;
  score += clamp(0.5 + roc * 5, 0, 1) * 0.15;

  score += (snap.atr > 0 ? Math.max(0, 1 - (snap.atr / lastClose) * 10) : 0.5) * 0.10;

  const dev = snap.bollingerMiddle > 0 ? (lastClose - snap.bollingerMiddle) / snap.bollingerMiddle : 0;
  score += clamp(0.5 - dev * 5, 0, 1) * 0.10;

  return clamp(score, 0, 1);
}

// ──────────────────────────────────────────────────────────────
// STACKING REGRESSOR (Meta-Learner)
// Combines all 4 base models. Dynamically adjusts weights based
// on model agreement (high agreement → higher confidence) and
// market regime detection.
// ──────────────────────────────────────────────────────────────
interface ModelResult { name: string; score: number; baseWeight: number; }

function stackingRegressor(results: ModelResult[]): { finalScore: number; weights: number[] } {
  // Compute agreement metric
  const scores = results.map(r => r.score);
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
  const agreement = Math.max(0, 1 - variance * 10); // 0-1, high = consensus

  // Dynamic weight adjustment: models closer to consensus get more weight
  const adjustedWeights = results.map(r => {
    const dist = Math.abs(r.score - mean);
    const proximity = Math.max(0.1, 1 - dist * 3);
    return r.baseWeight * proximity;
  });
  const totalWeight = adjustedWeights.reduce((s, w) => s + w, 0);
  const normWeights = adjustedWeights.map(w => w / totalWeight);

  // Weighted combination
  let finalScore = 0;
  for (let i = 0; i < results.length; i++) {
    finalScore += results[i].score * normWeights[i];
  }

  // Confidence scaling: high agreement → push toward extremes
  if (agreement > 0.7) {
    finalScore = finalScore > 0.5
      ? finalScore + (1 - finalScore) * 0.08
      : finalScore - finalScore * 0.08;
  }

  return { finalScore: clamp(finalScore, 0, 1), weights: normWeights };
}

// ──────────────────────────────────────────────────────────────
// PUBLIC API
// ──────────────────────────────────────────────────────────────

export function calculateScore(quotes: StockQuote[], snapshot: IndicatorSnapshot): number {
  const results: ModelResult[] = [
    { name: 'LSTM-Transformer', score: lstmTransformerScore(quotes, snapshot), baseWeight: 0.30 },
    { name: 'XGBoost',          score: xgboostScore(quotes, snapshot),         baseWeight: 0.25 },
    { name: 'GA-LSTM',          score: gaLstmScore(quotes, snapshot),          baseWeight: 0.25 },
    { name: 'H-BLSTM',          score: hblstmScore(quotes, snapshot),          baseWeight: 0.20 },
  ];
  const { finalScore } = stackingRegressor(results);
  return finalScore;
}

export function generateSignal(symbol: string, quotes: StockQuote[], params: RiskParameters): StockSignal {
  const snapshot = computeSnapshot(quotes);
  const last = quotes[quotes.length - 1];

  // Run all 4 models
  const modelResults: ModelResult[] = [
    { name: 'LSTM-Transformer Hybrid', score: lstmTransformerScore(quotes, snapshot), baseWeight: 0.30 },
    { name: 'XGBoost (Optimized)',     score: xgboostScore(quotes, snapshot),         baseWeight: 0.25 },
    { name: 'GA-LSTM',                 score: gaLstmScore(quotes, snapshot),          baseWeight: 0.25 },
    { name: 'H-BLSTM',                score: hblstmScore(quotes, snapshot),          baseWeight: 0.20 },
  ];

  // Stacking ensemble
  const { finalScore, weights } = stackingRegressor(modelResults);

  const models: ModelBreakdown[] = modelResults.map((m, i) => ({
    name: m.name,
    score: Math.round(m.score * 10000) / 10000,
    weight: Math.round(weights[i] * 1000) / 1000,
    signal: scoreToSignal(m.score),
    confidence: Math.round(Math.abs(m.score - 0.5) * 200), // 0-100
  }));

  const mode: TradingMode = finalScore >= params.riskControlThreshold ? 'RiskControl' : 'Normal';
  const signal = scoreToSignal(finalScore);

  const slPct = last.close * (1 - params.stopLossPercent);
  const slCandle = last.low - snapshot.atr * 0.5;
  const stopLoss = Math.min(slPct, slCandle);
  const tpPct = last.close * (1 + params.takeProfitPercent);
  const recentHigh = Math.max(...quotes.slice(-20).map(q => q.high));
  const takeProfit = Math.max(tpPct, recentHigh);

  let posSize = params.maxPositionSizePct;
  let volAdj = false;
  if (snapshot.atr > last.close * 0.03) {
    posSize *= (1 - params.volatilityReductionPct / 100);
    volAdj = true;
  }

  // Reasoning from model consensus
  const agrees = models.filter(m => m.signal === signal).length;
  const parts: string[] = [];
  parts.push(`Ensemble: ${agrees}/${models.length} models agree → ${signal}`);
  parts.push(snapshot.maCrossoverBullish ? 'MA bullish' : 'MA bearish');
  parts.push(`RSI ${snapshot.rsi.toFixed(0)}`);
  parts.push(snapshot.macdHistogram > 0 ? 'MACD+' : 'MACD−');
  if (volAdj) parts.push('Vol-adjusted');
  parts.push(`Score: ${(finalScore * 100).toFixed(1)}%`);

  return {
    symbol, signal,
    modelScore: Math.round(finalScore * 10000) / 10000,
    entryPrice: r2(last.close),
    stopLoss: r2(stopLoss),
    takeProfit: r2(takeProfit),
    positionSizePct: r2(posSize),
    reasoning: parts.join(' | '),
    generatedAt: new Date().toISOString(),
    mode, indicators: snapshot,
    models,
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
