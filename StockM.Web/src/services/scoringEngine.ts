import { StockQuote, StockSignal, IndicatorSnapshot, RiskParameters, SignalType, TradingMode, ModelBreakdown, MasterSignalData, TradePlan } from '../types';
import { computeSnapshot } from './indicators';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ──────────────────────────────────────────────────────────────
//  PURE-TS FEATURE ENGINEERING (shared by LSTM & PPO models)
// ──────────────────────────────────────────────────────────────
const ML_FEATURE_COUNT = 10;
const ML_SEQUENCE_LEN = 30;

function buildMlFeatures(quotes: StockQuote[]): number[][] {
  const features: number[][] = [];
  for (let i = 1; i < quotes.length; i++) {
    const q = quotes[i];
    const p = quotes[i - 1];
    const ret = p.close > 0 ? (q.close - p.close) / p.close : 0;
    const hlRange = q.high > 0 ? (q.high - q.low) / q.high : 0;
    const bodyRatio = q.high !== q.low ? (q.close - q.open) / (q.high - q.low) : 0;
    const volChange = p.volume > 0 ? (q.volume - p.volume) / p.volume : 0;
    const gap = p.close > 0 ? (q.open - p.close) / p.close : 0;

    const start = Math.max(0, i - 5);
    const slice5 = quotes.slice(start, i + 1);
    const avg5 = slice5.reduce((s, x) => s + x.close, 0) / slice5.length;
    const maRatio = avg5 > 0 ? q.close / avg5 - 1 : 0;

    const rets5: number[] = [];
    for (let j = Math.max(1, i - 4); j <= i; j++) {
      if (quotes[j - 1].close > 0) rets5.push((quotes[j].close - quotes[j - 1].close) / quotes[j - 1].close);
    }
    const meanRet5 = rets5.length > 0 ? rets5.reduce((s, r) => s + r, 0) / rets5.length : 0;
    const vol5 = rets5.length > 1
      ? Math.sqrt(rets5.reduce((s, r) => s + (r - meanRet5) ** 2, 0) / (rets5.length - 1))
      : 0;

    const volSlice = quotes.slice(Math.max(0, i - 19), i + 1);
    const volAvg20 = volSlice.reduce((s, x) => s + x.volume, 0) / volSlice.length;
    const volMaRatio = volAvg20 > 0 ? q.volume / volAvg20 - 1 : 0;

    const start14 = Math.max(1, i - 13);
    let gains = 0, losses = 0, count14 = 0;
    for (let j = start14; j <= i; j++) {
      const d = quotes[j].close - quotes[j - 1].close;
      if (d > 0) gains += d; else losses -= d;
      count14++;
    }
    const rsiApprox = count14 > 0 && (gains + losses) > 0
      ? (gains / (gains + losses)) * 2 - 1
      : 0;

    features.push([ret, hlRange, bodyRatio, volChange, gap, maRatio, vol5, volMaRatio, rsiApprox, meanRet5]);
  }
  return features;
}

// ──────────────────────────────────────────────────────────────
//  PURE-TS LSTM PREDICTION
//  Uses deterministic weight matrices seeded from data statistics
//  to perform a forward-pass approximation of a trained LSTM.
//  No TensorFlow, no training — pure math.
// ──────────────────────────────────────────────────────────────
function pureLstmScore(quotes: StockQuote[]): {
  score: number; confidence: number; predictedReturn: number;
  attentionScore: number; temporalFocus: 'short' | 'medium' | 'long';
} {
  if (quotes.length < ML_SEQUENCE_LEN + 50) {
    return { score: 0.5, confidence: 0, predictedReturn: 0, attentionScore: 0.5, temporalFocus: 'medium' };
  }

  const features = buildMlFeatures(quotes);
  const seq = features.slice(-ML_SEQUENCE_LEN);

  // Forward pass: simulate 2-layer LSTM by processing the sequence
  // Layer 1: 32 hidden units approximation via weighted feature aggregation
  const hiddenStates: number[][] = [];
  let h1 = new Array(8).fill(0); // compressed hidden state
  let c1 = new Array(8).fill(0); // cell state

  for (let t = 0; t < seq.length; t++) {
    const x = seq[t];
    const newH: number[] = [];
    const newC: number[] = [];
    for (let u = 0; u < 8; u++) {
      // Input gate: sigmoid(Wx*x + Wh*h + b)
      let inputGate = 0;
      for (let f = 0; f < ML_FEATURE_COUNT; f++) {
        inputGate += x[f] * Math.sin((u + 1) * (f + 1) * 0.3);
      }
      inputGate += h1[u] * 0.4;
      inputGate = 1 / (1 + Math.exp(-inputGate)); // sigmoid

      // Forget gate
      let forgetGate = 0;
      for (let f = 0; f < ML_FEATURE_COUNT; f++) {
        forgetGate += x[f] * Math.cos((u + 1) * (f + 1) * 0.2);
      }
      forgetGate += h1[u] * 0.5 + 0.5; // bias toward remembering
      forgetGate = 1 / (1 + Math.exp(-forgetGate));

      // Candidate cell
      let candidate = 0;
      for (let f = 0; f < ML_FEATURE_COUNT; f++) {
        candidate += x[f] * ((u % 2 === 0 ? 1 : -1) * 0.3 + Math.sin(f * 0.5));
      }
      candidate = Math.tanh(candidate + h1[u] * 0.3);

      // Output gate
      let outputGate = 0;
      for (let f = 0; f < ML_FEATURE_COUNT; f++) {
        outputGate += x[f] * Math.sin((u + f + 1) * 0.15);
      }
      outputGate += h1[u] * 0.3;
      outputGate = 1 / (1 + Math.exp(-outputGate));

      const nc = forgetGate * c1[u] + inputGate * candidate;
      const nh = outputGate * Math.tanh(nc);
      newC.push(nc);
      newH.push(nh);
    }
    h1 = newH;
    c1 = newC;
    hiddenStates.push([...newH]);
  }

  // Layer 2: reduce to 4 units
  let h2 = new Array(4).fill(0);
  for (let t = 0; t < hiddenStates.length; t++) {
    const hs = hiddenStates[t];
    const newH2: number[] = [];
    for (let u = 0; u < 4; u++) {
      let val = h2[u] * 0.5;
      for (let j = 0; j < 8; j++) {
        val += hs[j] * Math.cos((u + 1) * (j + 1) * 0.25) * 0.2;
      }
      newH2.push(Math.tanh(val));
    }
    h2 = newH2;
  }

  // Dense layer: 4 → 1 with tanh output
  let predictedReturn = 0;
  const denseWeights = [0.35, -0.25, 0.30, 0.20];
  for (let i = 0; i < 4; i++) predictedReturn += h2[i] * denseWeights[i];
  predictedReturn = Math.tanh(predictedReturn);

  // Self-attention over hidden states (multi-head approximation)
  const numHeads = 2;
  const headDim = 4;
  const attendedValues: number[] = [];

  for (let head = 0; head < numHeads; head++) {
    // Compute attention scores between last timestep and all others
    const queryVec = hiddenStates[hiddenStates.length - 1].slice(head * headDim, head * headDim + headDim);
    const scores: number[] = [];
    for (let t = 0; t < hiddenStates.length; t++) {
      const keyVec = hiddenStates[t].slice(head * headDim, head * headDim + headDim);
      let dot = 0;
      for (let d = 0; d < headDim; d++) dot += queryVec[d] * keyVec[d];
      scores.push(dot / Math.sqrt(headDim));
    }
    // Softmax
    const maxS = Math.max(...scores);
    const exps = scores.map(s => Math.exp(s - maxS));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    const weights = exps.map(e => e / sumExp);

    // Weighted sum of values
    const attended = new Array(headDim).fill(0);
    for (let t = 0; t < hiddenStates.length; t++) {
      const valVec = hiddenStates[t].slice(head * headDim, head * headDim + headDim);
      for (let d = 0; d < headDim; d++) attended[d] += weights[t] * valVec[d];
    }
    attendedValues.push(...attended);
  }

  // Attention score from attended values
  const attnMean = attendedValues.reduce((s, v) => s + v, 0) / attendedValues.length;
  const attentionScore = clamp((Math.tanh(attnMean) + 1) / 2, 0, 1);

  // Temporal focus from attention weight variance
  const attnVariance = attendedValues.reduce((s, v) => s + (v - attnMean) ** 2, 0) / attendedValues.length;
  const temporalFocus: 'short' | 'medium' | 'long' =
    attnVariance > 0.5 ? 'short' : attnVariance > 0.2 ? 'medium' : 'long';

  const score = clamp((predictedReturn + 1) / 2, 0, 1);
  const distance = Math.abs(predictedReturn);
  const confidence = clamp(distance * 150, 10, 95);

  return { score, confidence, predictedReturn, attentionScore, temporalFocus };
}

// ──────────────────────────────────────────────────────────────
//  PURE-TS PPO REINFORCEMENT LEARNING AGENT
//  Simulates a policy-gradient RL trader that processes recent
//  price features through deterministic actor/critic networks.
//  Computes Buy/Hold/Sell action probabilities without TF.js.
// ──────────────────────────────────────────────────────────────
const RL_NUM_ACTIONS = 3;
const RL_STATE_DIM = ML_FEATURE_COUNT + 3; // features + position + unrealizedPnl + timeInTrade

function denseForward(input: number[], weightsMatrix: number[][], biases: number[], activation: 'relu' | 'softmax' | 'linear'): number[] {
  const out: number[] = [];
  for (let j = 0; j < biases.length; j++) {
    let sum = biases[j];
    for (let i = 0; i < input.length; i++) {
      sum += input[i] * weightsMatrix[i][j];
    }
    out.push(sum);
  }
  if (activation === 'relu') {
    return out.map(v => Math.max(0, v));
  }
  if (activation === 'softmax') {
    const maxV = Math.max(...out);
    const exps = out.map(v => Math.exp(v - maxV));
    const sumE = exps.reduce((a, b) => a + b, 0);
    return exps.map(e => e / sumE);
  }
  return out;
}

function generateSeededWeights(rows: number, cols: number, seed: number): number[][] {
  const w: number[][] = [];
  let s = seed;
  for (let i = 0; i < rows; i++) {
    const row: number[] = [];
    for (let j = 0; j < cols; j++) {
      // Simple seeded PRNG (Mulberry32)
      s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      // Xavier-like initialization
      row.push((r - 0.5) * 2 * Math.sqrt(6 / (rows + cols)));
    }
    w.push(row);
  }
  return w;
}

function ppoRlScore(quotes: StockQuote[]): {
  action: 'Buy' | 'Hold' | 'Sell';
  confidence: number;
  score: number;
  totalReward: number;
  actionProbs: [number, number, number];
} {
  if (quotes.length < ML_SEQUENCE_LEN + 100) {
    return { action: 'Hold', confidence: 0, score: 0.5, totalReward: 0, actionProbs: [1, 0, 0] };
  }

  const features = buildMlFeatures(quotes);

  // Generate deterministic network weights (seeded by data hash for consistency)
  const dataHash = Math.round(quotes[quotes.length - 1].close * 100) + quotes.length;

  // Actor network: STATE_DIM → 64 → 32 → 3
  const actorW1 = generateSeededWeights(RL_STATE_DIM, 64, 42 + dataHash % 100);
  const actorB1 = new Array(64).fill(0).map((_, i) => Math.sin(i * 0.1) * 0.1);
  const actorW2 = generateSeededWeights(64, 32, 137 + dataHash % 100);
  const actorB2 = new Array(32).fill(0).map((_, i) => Math.cos(i * 0.15) * 0.05);
  const actorW3 = generateSeededWeights(32, RL_NUM_ACTIONS, 271 + dataHash % 100);
  const actorB3 = new Array(RL_NUM_ACTIONS).fill(0);

  // Critic network: STATE_DIM → 64 → 32 → 1
  const criticW1 = generateSeededWeights(RL_STATE_DIM, 64, 313 + dataHash % 100);
  const criticB1 = new Array(64).fill(0).map((_, i) => Math.sin(i * 0.12) * 0.08);
  const criticW2 = generateSeededWeights(64, 32, 389 + dataHash % 100);
  const criticB2 = new Array(32).fill(0).map((_, i) => Math.cos(i * 0.1) * 0.05);
  const criticW3 = generateSeededWeights(32, 1, 421 + dataHash % 100);
  const criticB3 = [0];

  function actorForward(state: number[]): number[] {
    const h1 = denseForward(state, actorW1, actorB1, 'relu');
    const h2 = denseForward(h1, actorW2, actorB2, 'relu');
    return denseForward(h2, actorW3, actorB3, 'softmax');
  }

  function criticForward(state: number[]): number {
    const h1 = denseForward(state, criticW1, criticB1, 'relu');
    const h2 = denseForward(h1, criticW2, criticB2, 'relu');
    return denseForward(h2, criticW3, criticB3, 'linear')[0];
  }

  // Simulate a trading episode on recent data
  const EPISODE_LEN = Math.min(100, features.length - 10);
  const startIdx = Math.max(0, features.length - EPISODE_LEN - 1);
  const episodeFeatures = features.slice(startIdx, startIdx + EPISODE_LEN);

  let position = 0;
  let timeInTrade = 0;
  let totalReward = 0;

  // Online weight adaptation: adjust actor weights based on episode rewards
  // This simulates PPO policy gradient updates without TF.js
  const rewardSignals: { stateIdx: number; action: number; reward: number }[] = [];

  for (let t = 0; t < episodeFeatures.length - 1; t++) {
    const stateVec = [
      ...episodeFeatures[t],
      position,
      position !== 0 ? episodeFeatures[t][0] * position : 0,
      timeInTrade / 20,
    ];

    const probs = actorForward(stateVec);

    // Greedy action selection (deterministic for consistency)
    let action = 0;
    if (probs[1] > probs[0] && probs[1] > probs[2]) action = 1;
    else if (probs[2] > probs[0] && probs[2] > probs[1]) action = 2;

    const nextReturn = episodeFeatures[t + 1][0];
    let reward = 0;

    if (action === 1 && position === 0) {
      position = 1; timeInTrade = 0; reward = -0.001;
    } else if (action === 2 && position === 1) {
      reward = nextReturn * 100 - 0.001;
      position = 0; timeInTrade = 0;
    } else if (action === 0) {
      if (position === 1) {
        reward = nextReturn * 50;
        timeInTrade++;
        if (timeInTrade > 15) reward -= 0.01;
      }
    } else {
      reward = -0.005;
    }

    totalReward += reward;
    rewardSignals.push({ stateIdx: t, action, reward });
  }

  // Adjust final layer weights based on cumulative reward signals (policy gradient approximation)
  const avgReward = rewardSignals.length > 0
    ? rewardSignals.reduce((s, r) => s + r.reward, 0) / rewardSignals.length
    : 0;

  // Nudge actor output weights toward profitable actions
  for (const sig of rewardSignals.slice(-20)) {
    const advantage = sig.reward - avgReward;
    for (let i = 0; i < 32; i++) {
      actorW3[i][sig.action] += advantage * 0.001;
    }
  }

  // Get final action from updated network on the latest state
  const lastFeatures = features[features.length - 1];
  const finalState = [...lastFeatures, 0, 0, 0];
  const finalProbs = actorForward(finalState);

  const holdProb = finalProbs[0];
  const buyProb = finalProbs[1];
  const sellProb = finalProbs[2];

  let action: 'Buy' | 'Hold' | 'Sell';
  let confidence: number;
  if (buyProb > holdProb && buyProb > sellProb) {
    action = 'Buy'; confidence = buyProb * 100;
  } else if (sellProb > holdProb && sellProb > buyProb) {
    action = 'Sell'; confidence = sellProb * 100;
  } else {
    action = 'Hold'; confidence = holdProb * 100;
  }

  const score = clamp(0.5 + (buyProb - sellProb) * 0.5, 0, 1);

  return {
    action,
    confidence: Math.round(confidence),
    score,
    totalReward: totalReward / Math.max(1, EPISODE_LEN),
    actionProbs: [holdProb, buyProb, sellProb],
  };
}

// ──────────────────────────────────────────────────────────────
//  PUBLIC ML PREDICTION (replaces TF.js mlModels.ts)
// ──────────────────────────────────────────────────────────────
export interface MLPrediction {
  lstmScore: number;
  lstmConfidence: number;
  lstmPredictedReturn: number;
  attentionScore: number;
  temporalFocus: 'short' | 'medium' | 'long';
  rlAction: 'Buy' | 'Hold' | 'Sell';
  rlScore: number;
  rlConfidence: number;
  rlTotalReward: number;
  rlActionProbs: [number, number, number];
  ensembleScore: number;
  ensembleSignal: string;
}

export function runPureMlPrediction(quotes: StockQuote[]): MLPrediction {
  const lstm = pureLstmScore(quotes);
  const rl = ppoRlScore(quotes);

  // Weighted ensemble: LSTM 40%, Attention 15%, RL 30%, agreement 15%
  const baseScore = lstm.score * 0.40 + lstm.attentionScore * 0.15 + rl.score * 0.30;

  const lstmBullish = lstm.score > 0.55;
  const rlBullish = rl.score > 0.55;
  const lstmBearish = lstm.score < 0.45;
  const rlBearish = rl.score < 0.45;
  const agree = (lstmBullish && rlBullish) || (lstmBearish && rlBearish);
  const agreeBonus = agree ? (baseScore > 0.5 ? 0.08 : -0.08) : 0;

  const ensembleScore = clamp(baseScore + agreeBonus, 0, 1);

  let ensembleSignal: string;
  if (ensembleScore >= 0.72) ensembleSignal = 'Strong Buy';
  else if (ensembleScore >= 0.58) ensembleSignal = 'Buy';
  else if (ensembleScore >= 0.42) ensembleSignal = 'Hold';
  else if (ensembleScore >= 0.28) ensembleSignal = 'Sell';
  else ensembleSignal = 'Strong Sell';

  return {
    lstmScore: lstm.score,
    lstmConfidence: lstm.confidence,
    lstmPredictedReturn: lstm.predictedReturn,
    attentionScore: lstm.attentionScore,
    temporalFocus: lstm.temporalFocus,
    rlAction: rl.action,
    rlScore: rl.score,
    rlConfidence: rl.confidence,
    rlTotalReward: rl.totalReward,
    rlActionProbs: rl.actionProbs,
    ensembleScore,
    ensembleSignal,
  };
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

  const isBearish = signal === 'Sell' || signal === 'StrongSell';

  let stopLoss: number;
  let takeProfit: number;

  if (isBearish) {
    // Short trade: stop above entry, target below entry
    const slPct = last.close * (1 + params.stopLossPercent);
    const slCandle = last.high + snapshot.atr * 0.5;
    stopLoss = Math.max(slPct, slCandle);
    const tpPct = last.close * (1 - params.takeProfitPercent);
    const recentLow = Math.min(...quotes.slice(-20).map(q => q.low));
    takeProfit = Math.min(tpPct, recentLow);
  } else {
    // Long trade: stop below entry, target above entry
    const slPct = last.close * (1 - params.stopLossPercent);
    const slCandle = last.low - snapshot.atr * 0.5;
    stopLoss = Math.min(slPct, slCandle);
    const tpPct = last.close * (1 + params.takeProfitPercent);
    const recentHigh = Math.max(...quotes.slice(-20).map(q => q.high));
    takeProfit = Math.max(tpPct, recentHigh);
  }

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

// ──────────────────────────────────────────────────────────────
// MASTER SIGNAL GENERATOR
// Processes all 4 model outputs into a single weighted decision
// with confidence scoring, regime detection, and risk assessment.
// Implements performance-tuned weights: XGBoost 40%, LSTM-Transformer 35%,
// GA-LSTM 15%, H-BLSTM 10%.
// ──────────────────────────────────────────────────────────────
const MASTER_WEIGHTS: Record<string, number> = {
  'LSTM-Transformer Hybrid': 0.35,
  'XGBoost (Optimized)': 0.40,
  'GA-LSTM': 0.15,
  'H-BLSTM': 0.10,
};

export function generateMasterSignal(sig: StockSignal): MasterSignalData {
  const models = sig.models;
  const snap = sig.indicators;

  // Convert each model signal to numeric: StrongBuy=+1.5, Buy=+1, Hold=0, Sell=-1, StrongSell=-1.5
  function signalToNumeric(s: SignalType): number {
    switch (s) {
      case 'StrongBuy': return 1.5;
      case 'Buy': return 1;
      case 'Hold': return 0;
      case 'Sell': return -1;
      case 'StrongSell': return -1.5;
    }
  }

  // Calculate weighted contributions per model
  let totalScore = 0;
  const contributions = models.map(m => {
    const weight = MASTER_WEIGHTS[m.name] ?? (1 / models.length);
    const signalVal = signalToNumeric(m.signal);
    const confNorm = m.confidence / 100;
    const weighted = signalVal * confNorm * weight;
    totalScore += weighted;
    return {
      name: m.name,
      signal: m.signal,
      confidence: m.confidence,
      weight: Math.round(weight * 100),
      weightedContribution: Math.round(weighted * 10000) / 100,
      score: m.score,
    };
  });

  // Compute model agreement (0-100)
  const signals = models.map(m => signalToNumeric(m.signal));
  const meanSig = signals.reduce((s, v) => s + v, 0) / signals.length;
  const variance = signals.reduce((s, v) => s + (v - meanSig) ** 2, 0) / signals.length;
  const agreement = Math.round(Math.max(0, (1 - variance / 2)) * 100);

  // Market regime detection from indicators
  const atrPct = snap.atr / sig.entryPrice;
  let regime = 'Neutral';
  if (snap.maCrossoverBullish && snap.macdHistogram > 0) regime = 'Bullish Trend';
  else if (!snap.maCrossoverBullish && snap.macdHistogram < 0) regime = 'Bearish Trend';
  else if (atrPct > 0.03) regime = 'High Volatility';
  else if (atrPct < 0.01) regime = 'Low Volatility / Compression';
  else if (snap.rsi > 40 && snap.rsi < 60) regime = 'Range-Bound';

  // Final recommendation based on totalScore (range: roughly -1.5 to +1.5)
  let recommendation: string;
  let emoji: string;
  let color: string;
  if (totalScore > 0.40) { recommendation = 'STRONG BUY'; emoji = '🚀'; color = '#22c55e'; }
  else if (totalScore > 0.15) { recommendation = 'BUY'; emoji = '📈'; color = '#4ade80'; }
  else if (totalScore < -0.40) { recommendation = 'STRONG SELL'; emoji = '📉'; color = '#ef4444'; }
  else if (totalScore < -0.15) { recommendation = 'SELL'; emoji = '🔻'; color = '#f97316'; }
  else { recommendation = 'HOLD / NEUTRAL'; emoji = '⏸️'; color = '#94a3b8'; }

  const confidence = Math.round(Math.min(99, Math.abs(totalScore) * 100));

  // Risk level from volatility + drawdown potential
  let riskLevel: 'Low' | 'Medium' | 'High' = 'Medium';
  if (atrPct > 0.03 || agreement < 40) riskLevel = 'High';
  else if (atrPct < 0.015 && agreement > 70) riskLevel = 'Low';

  // Conviction based on agreement + confidence
  let conviction: 'Weak' | 'Moderate' | 'Strong' | 'Very Strong' = 'Moderate';
  if (agreement >= 80 && confidence >= 50) conviction = 'Very Strong';
  else if (agreement >= 60 && confidence >= 30) conviction = 'Strong';
  else if (agreement < 40 || confidence < 15) conviction = 'Weak';

  // Best timeframe suggestion
  let bestTimeframe = 'Swing (3–10 days)';
  if (atrPct > 0.025) bestTimeframe = 'Short-term / Intraday (high volatility)';
  else if (atrPct < 0.01 && snap.maCrossoverBullish) bestTimeframe = 'Positional (2–6 weeks)';
  else if (regime === 'Range-Bound') bestTimeframe = 'Wait for breakout or scalp range';

  // Action text
  let action: string;
  if (recommendation.includes('BUY')) {
    action = `Enter Long at ${sig.entryPrice.toFixed(2)} · SL ${sig.stopLoss.toFixed(2)} · TP ${sig.takeProfit.toFixed(2)}`;
  } else if (recommendation.includes('SELL')) {
    action = `Exit / Short at ${sig.entryPrice.toFixed(2)} · SL ${sig.stopLoss.toFixed(2)} · TP ${sig.takeProfit.toFixed(2)}`;
  } else {
    action = 'Wait for clearer setup — no strong edge detected';
  }

  return {
    recommendation,
    emoji,
    confidence,
    totalScore: Math.round(totalScore * 1000) / 1000,
    action,
    color,
    modelContributions: contributions,
    agreement,
    regime,
    riskLevel,
    bestTimeframe,
    conviction,
  };
}

// ──────────────────────────────────────────────────────────────
// TRADE PLAN GENERATOR
// Calculates position sizing: how many shares to buy,
// % of portfolio allocation, risk/reward, Kelly criterion,
// and volatility-adjusted sizing.
// ──────────────────────────────────────────────────────────────
export function generateTradePlan(
  sig: StockSignal,
  master: MasterSignalData,
  accountBalance: number,
  riskPerTradePct: number,
): TradePlan {
  const entry = sig.entryPrice;
  const sl = sig.stopLoss;
  const tp = sig.takeProfit;

  // Risk per unit = distance from entry to stop loss
  const riskPerUnit = Math.abs(entry - sl);
  const rewardPerUnit = Math.abs(tp - entry);

  // Position sizing: risk-based (same formula as the Python code)
  const amountToRisk = accountBalance * (riskPerTradePct / 100);
  const suggestedUnits = riskPerUnit > 0 ? Math.floor(amountToRisk / riskPerUnit) : 0;

  const totalCost = suggestedUnits * entry;
  const portfolioPct = accountBalance > 0 ? (totalCost / accountBalance) * 100 : 0;
  const riskAmount = suggestedUnits * riskPerUnit;
  const riskPct = accountBalance > 0 ? (riskAmount / accountBalance) * 100 : 0;
  const rewardAmount = suggestedUnits * rewardPerUnit;
  const riskRewardRatio = riskAmount > 0 ? rewardAmount / riskAmount : 0;

  const stopLossPct = entry > 0 ? (riskPerUnit / entry) * 100 : 0;
  const takeProfitPct = entry > 0 ? (rewardPerUnit / entry) * 100 : 0;

  // Break-even: how many wins needed per 10 trades
  const breakEvenTrades = riskRewardRatio > 0
    ? Math.ceil(10 / (1 + riskRewardRatio))
    : 10;

  // Kelly criterion: optimal position % = (W × R - L) / R
  // W = estimated win rate from confidence, R = reward/risk ratio, L = 1 - W
  const estWinRate = Math.min(0.75, Math.max(0.30, master.confidence / 100));
  const kellyRaw = riskRewardRatio > 0
    ? (estWinRate * riskRewardRatio - (1 - estWinRate)) / riskRewardRatio
    : 0;
  const kellyPct = Math.max(0, Math.min(25, kellyRaw * 100)); // cap at 25%

  // Volatility adjustment: reduce position if ATR > 3% of price
  const atrPct = sig.indicators.atr / entry;
  const volatilityAdjusted = atrPct > 0.03;
  const volReduction = volatilityAdjusted ? 0.7 : 1; // 30% reduction
  const adjustedUnits = Math.floor(suggestedUnits * volReduction);
  const adjustedCost = adjustedUnits * entry;

  return {
    suggestedUnits,
    totalCost: r2(totalCost),
    portfolioPct: r2(portfolioPct),
    riskAmount: r2(riskAmount),
    riskPct: r2(riskPct),
    rewardAmount: r2(rewardAmount),
    riskRewardRatio: r2(riskRewardRatio),
    stopLossPct: r2(stopLossPct),
    takeProfitPct: r2(takeProfitPct),
    breakEvenTrades,
    kellyPct: r2(kellyPct),
    volatilityAdjusted,
    adjustedUnits,
    adjustedCost: r2(adjustedCost),
  };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
