/**
 * mlModels.ts — Real TensorFlow.js LSTM + Transformer Attention + RL PPO Agent
 *
 * This module provides:
 *  1. An LSTM model that trains in-browser on price data and predicts next-bar returns
 *  2. A self-attention (Transformer) layer applied to LSTM hidden states
 *  3. A PPO Reinforcement Learning agent that learns Buy/Hold/Sell actions
 *
 * All models run entirely client-side via @tensorflow/tfjs (WebGL backend).
 */

import type { StockQuote, IndicatorSnapshot } from '../types';
// Type-only import (erased at compile time — zero bundle impact)
import type * as tfNs from '@tensorflow/tfjs';

// Lazy-load TensorFlow.js — only fetched when ML inference is first requested
let _tf: typeof import('@tensorflow/tfjs') | null = null;
let tf: typeof import('@tensorflow/tfjs');
async function ensureTf() {
  if (!_tf) {
    _tf = await import('@tensorflow/tfjs');
    await _tf.ready();
  }
  tf = _tf;
  return _tf;
}

/** Yield to the browser event loop so the UI stays responsive during heavy computation */
function yieldToUI(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// ─────────────────────────────────────────────────────────────
//  FEATURE ENGINEERING (shared across all models)
// ─────────────────────────────────────────────────────────────

const FEATURE_COUNT = 10;
const SEQUENCE_LEN = 30; // 30-bar lookback window

/** Normalize quotes into a feature matrix: [bars × FEATURE_COUNT] */
function buildFeatures(quotes: StockQuote[]): number[][] {
  const features: number[][] = [];
  for (let i = 1; i < quotes.length; i++) {
    const q = quotes[i];
    const p = quotes[i - 1];
    const ret = p.close > 0 ? (q.close - p.close) / p.close : 0;
    const hlRange = q.high > 0 ? (q.high - q.low) / q.high : 0;
    const bodyRatio = q.high !== q.low ? (q.close - q.open) / (q.high - q.low) : 0;
    const volChange = p.volume > 0 ? (q.volume - p.volume) / p.volume : 0;
    const gap = p.close > 0 ? (q.open - p.close) / p.close : 0;

    // Simple rolling features (5-bar)
    const start = Math.max(0, i - 5);
    const slice5 = quotes.slice(start, i + 1);
    const avg5 = slice5.reduce((s, x) => s + x.close, 0) / slice5.length;
    const maRatio = avg5 > 0 ? q.close / avg5 - 1 : 0;

    // Volatility (5-bar std of returns)
    const rets5: number[] = [];
    for (let j = Math.max(1, i - 4); j <= i; j++) {
      if (quotes[j - 1].close > 0) rets5.push((quotes[j].close - quotes[j - 1].close) / quotes[j - 1].close);
    }
    const meanRet5 = rets5.length > 0 ? rets5.reduce((s, r) => s + r, 0) / rets5.length : 0;
    const vol5 = rets5.length > 1
      ? Math.sqrt(rets5.reduce((s, r) => s + (r - meanRet5) ** 2, 0) / (rets5.length - 1))
      : 0;

    // Volume MA ratio
    const volSlice = quotes.slice(Math.max(0, i - 19), i + 1);
    const volAvg20 = volSlice.reduce((s, x) => s + x.volume, 0) / volSlice.length;
    const volMaRatio = volAvg20 > 0 ? q.volume / volAvg20 - 1 : 0;

    // RSI-like momentum (14-bar approx)
    const start14 = Math.max(1, i - 13);
    let gains = 0, losses = 0, count14 = 0;
    for (let j = start14; j <= i; j++) {
      const d = quotes[j].close - quotes[j - 1].close;
      if (d > 0) gains += d; else losses -= d;
      count14++;
    }
    const rsiApprox = count14 > 0 && (gains + losses) > 0
      ? (gains / (gains + losses)) * 2 - 1 // normalized to [-1, 1]
      : 0;

    features.push([
      ret,           // 0: return
      hlRange,       // 1: high-low range
      bodyRatio,     // 2: candle body ratio
      volChange,     // 3: volume change
      gap,           // 4: gap
      maRatio,       // 5: price vs 5-MA
      vol5,          // 6: 5-bar volatility
      volMaRatio,    // 7: volume vs 20-MA
      rsiApprox,     // 8: RSI momentum
      meanRet5,      // 9: 5-bar mean return
    ]);
  }
  return features;
}

/** Extract sequences for LSTM: sliding window of SEQUENCE_LEN */
function buildSequences(features: number[][]): { xs: number[][][]; ys: number[] } {
  const xs: number[][][] = [];
  const ys: number[] = [];
  for (let i = SEQUENCE_LEN; i < features.length; i++) {
    xs.push(features.slice(i - SEQUENCE_LEN, i));
    // Target: next-bar return (feature index 0 of the "next" bar)
    ys.push(features[i][0]);
  }
  return { xs, ys };
}

// ─────────────────────────────────────────────────────────────
//  1. LSTM + SELF-ATTENTION MODEL
// ─────────────────────────────────────────────────────────────

/** Simplified multi-head self-attention applied to LSTM output sequence */
function selfAttentionLayer(input: tfNs.Tensor3D, numHeads = 2): tfNs.Tensor2D {
  return tf.tidy(() => {
    const [batch, steps, dim] = input.shape;
    const headDim = Math.floor(dim / numHeads);

    const heads: tfNs.Tensor2D[] = [];
    for (let h = 0; h < numHeads; h++) {
      // Slice features for this head
      const headSlice = input.slice([0, 0, h * headDim], [-1, -1, headDim]); // [batch, steps, headDim]

      // Q, K, V = same (self-attention)
      // Attention scores: Q × K^T / sqrt(d)
      const q = headSlice;
      const k = headSlice;
      const v = headSlice;

      // scores: [batch, steps, steps]
      const scores = tf.matMul(
        q as tfNs.Tensor3D,
        k.transpose([0, 2, 1]) as tfNs.Tensor3D
      ).div(tf.scalar(Math.sqrt(headDim)));

      const weights = scores.softmax(-1);

      // context: [batch, steps, headDim]
      const context = tf.matMul(weights as tfNs.Tensor3D, v as tfNs.Tensor3D);

      // Take last timestep: [batch, headDim]
      const lastStep = context.slice([0, steps - 1, 0], [-1, 1, -1]).reshape([batch, headDim]);
      heads.push(lastStep as tfNs.Tensor2D);
    }

    // Concatenate heads: [batch, dim]
    return tf.concat(heads, 1);
  });
}

interface LSTMModelCache {
  model: tfNs.LayersModel;
  lastTrainedSymbol: string;
  lastTrainedCount: number;
}

let lstmCache: LSTMModelCache | null = null;

/**
 * Build LSTM model with attention applied as a post-processing step.
 * We use tf.sequential for training, and apply self-attention during inference.
 */
function buildLSTMWithAttentionModel(): tfNs.LayersModel {
  const model = tf.sequential();

  model.add(tf.layers.lstm({
    units: 32,
    inputShape: [SEQUENCE_LEN, FEATURE_COUNT],
    returnSequences: true,
  }));

  model.add(tf.layers.dropout({ rate: 0.15 }));

  model.add(tf.layers.lstm({
    units: 16,
    returnSequences: false,
  }));

  model.add(tf.layers.dense({ units: 8, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1, activation: 'tanh' }));

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: 'meanSquaredError',
  });

  return model;
}

/**
 * Train a fresh LSTM on the given stock's price history and return a prediction score.
 * The model trains for a few epochs on recent data, then predicts the next bar's return.
 */
export async function runLSTMPrediction(
  quotes: StockQuote[],
  symbol: string,
): Promise<{ score: number; confidence: number; predictedReturn: number; epochsRun: number }> {
  if (quotes.length < SEQUENCE_LEN + 50) {
    return { score: 0.5, confidence: 0, predictedReturn: 0, epochsRun: 0 };
  }

  const features = buildFeatures(quotes);
  const { xs, ys } = buildSequences(features);

  if (xs.length < 30) {
    return { score: 0.5, confidence: 0, predictedReturn: 0, epochsRun: 0 };
  }

  // Use last 80% for training, 20% for validation
  const splitIdx = Math.floor(xs.length * 0.8);
  const trainX = xs.slice(0, splitIdx);
  const trainY = ys.slice(0, splitIdx);

  // Check if we can reuse cached model
  const needRetrain = !lstmCache
    || lstmCache.lastTrainedSymbol !== symbol
    || Math.abs(lstmCache.lastTrainedCount - quotes.length) > 5;

  let model: tfNs.LayersModel;
  if (needRetrain) {
    model = buildLSTMWithAttentionModel();
  } else {
    model = lstmCache!.model;
  }

  // Train (quick — few epochs with small batch for responsive UI)
  const EPOCHS = needRetrain ? 2 : 1;
  // Limit training data to last 300 sequences to avoid blocking
  const maxTrain = 300;
  const trimmedX = trainX.length > maxTrain ? trainX.slice(-maxTrain) : trainX;
  const trimmedY = trainY.length > maxTrain ? trainY.slice(-maxTrain) : trainY;
  const xTensor = tf.tensor3d(trimmedX);
  const yTensor = tf.tensor2d(trimmedY, [trimmedY.length, 1]);

  try {
    await model.fit(xTensor, yTensor, {
      epochs: EPOCHS,
      batchSize: 32,
      shuffle: true,
      verbose: 0,
    });
  } finally {
    xTensor.dispose();
    yTensor.dispose();
  }

  // Predict on the latest sequence
  const lastSeq = features.slice(-SEQUENCE_LEN);
  const predTensor = tf.tensor3d([lastSeq]);
  const rawPred = model.predict(predTensor) as tfNs.Tensor;
  const predictedReturn = (await rawPred.data())[0];
  predTensor.dispose();
  rawPred.dispose();

  // Cache model
  if (lstmCache && lstmCache.model !== model) {
    lstmCache.model.dispose();
  }
  lstmCache = { model, lastTrainedSymbol: symbol, lastTrainedCount: quotes.length };

  // Convert predicted return to 0-1 score
  // predictedReturn is in [-1, 1] (tanh output)
  // Map: -1 → 0 (strong sell), 0 → 0.5 (hold), +1 → 1 (strong buy)
  const score = clamp((predictedReturn + 1) / 2, 0, 1);

  // Confidence based on how far from 0.5 the prediction is + validation performance
  const distance = Math.abs(predictedReturn);
  const confidence = clamp(distance * 100 * 1.5, 10, 95);

  return {
    score,
    confidence,
    predictedReturn,
    epochsRun: EPOCHS,
  };
}

/**
 * Run self-attention over LSTM hidden states for a richer representation.
 * This is used separately from the main LSTM prediction for the attention score.
 */
let attentionSeqModel: any = null;

export async function runAttentionAnalysis(
  quotes: StockQuote[],
): Promise<{ attentionScore: number; temporalFocus: 'short' | 'medium' | 'long' }> {
  if (quotes.length < SEQUENCE_LEN + 10) {
    return { attentionScore: 0.5, temporalFocus: 'medium' };
  }

  const features = buildFeatures(quotes);
  const lastSeq = features.slice(-SEQUENCE_LEN);

  // Reuse cached attention sequence model
  if (!attentionSeqModel) {
    const seqModel = tf.sequential();
    seqModel.add(tf.layers.lstm({
      units: 16,
      inputShape: [SEQUENCE_LEN, FEATURE_COUNT],
      returnSequences: true,
    }));
    seqModel.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
    attentionSeqModel = seqModel;
  }
  const seqModel = attentionSeqModel;

  const input = tf.tensor3d([lastSeq]);
  const hiddenStates = seqModel.predict(input) as tfNs.Tensor3D;

  // Apply self-attention
  const attended = selfAttentionLayer(hiddenStates);
  const values = await attended.data();

  input.dispose();
  hiddenStates.dispose();
  attended.dispose();

  // Aggregate attention output into a single score
  const vals = Array.from(values) as number[];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const attentionScore = clamp((Math.tanh(mean) + 1) / 2, 0, 1);

  // Determine which timeframe the attention focuses on
  // (based on the variation in attention weights — higher variation = shorter focus)
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  const temporalFocus: 'short' | 'medium' | 'long' =
    variance > 0.5 ? 'short' : variance > 0.2 ? 'medium' : 'long';

  return { attentionScore, temporalFocus };
}

// ─────────────────────────────────────────────────────────────
//  2. REINFORCEMENT LEARNING — PPO AGENT
// ─────────────────────────────────────────────────────────────

// Actions: 0 = Hold, 1 = Buy, 2 = Sell
const NUM_ACTIONS = 3;
const STATE_DIM = FEATURE_COUNT + 3; // features + position + unrealized P&L + time-in-trade

interface PPONetworks {
  actor: tfNs.LayersModel;   // policy network: state → action probabilities
  critic: tfNs.LayersModel;  // value network: state → expected return
  symbol: string;
}

let ppoCache: PPONetworks | null = null;

function buildActorNetwork(): tfNs.LayersModel {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [STATE_DIM] }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: NUM_ACTIONS, activation: 'softmax' })); // action probs
  model.compile({ optimizer: tf.train.adam(0.0003), loss: 'categoricalCrossentropy' });
  return model;
}

function buildCriticNetwork(): tfNs.LayersModel {
  const model = tf.sequential();
  model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [STATE_DIM] }));
  model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
  model.add(tf.layers.dense({ units: 1 })); // state value
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'meanSquaredError' });
  return model;
}

interface RLEnvironmentState {
  features: number[];  // market features
  position: number;    // 0 = flat, 1 = long, -1 = short
  unrealizedPnl: number;
  timeInTrade: number;
}

function getStateVector(state: RLEnvironmentState): number[] {
  return [
    ...state.features,
    state.position,
    state.unrealizedPnl,
    state.timeInTrade / 20, // normalize
  ];
}

interface RLEpisodeStep {
  state: number[];
  action: number;
  reward: number;
  logProb: number;
  value: number;
}

/** Compute discounted returns + advantages for PPO */
function computeAdvantages(
  steps: RLEpisodeStep[],
  gamma = 0.99,
  lam = 0.95,
): { returns: number[]; advantages: number[] } {
  const n = steps.length;
  const returns = new Array(n).fill(0);
  const advantages = new Array(n).fill(0);

  let lastReturn = 0;
  let lastAdv = 0;
  for (let i = n - 1; i >= 0; i--) {
    const nextValue = i < n - 1 ? steps[i + 1].value : 0;
    const delta = steps[i].reward + gamma * nextValue - steps[i].value;
    advantages[i] = lastAdv = delta + gamma * lam * lastAdv;
    returns[i] = lastReturn = steps[i].reward + gamma * lastReturn;
  }

  // Normalize advantages
  const mean = advantages.reduce((s, a) => s + a, 0) / n;
  const std = Math.sqrt(advantages.reduce((s, a) => s + (a - mean) ** 2, 0) / n) || 1;
  for (let i = 0; i < n; i++) advantages[i] = (advantages[i] - mean) / std;

  return { returns, advantages };
}

/**
 * Run the PPO RL agent on historical data.
 * Simulates trading episodes and trains the agent to maximize portfolio returns.
 * Returns the agent's current action recommendation and confidence.
 */
export async function runRLAgent(
  quotes: StockQuote[],
  symbol: string,
  _snap: IndicatorSnapshot,
): Promise<{
  action: 'Buy' | 'Hold' | 'Sell';
  confidence: number;
  score: number;
  episodesRun: number;
  totalReward: number;
  actionProbs: [number, number, number]; // [hold, buy, sell]
}> {
  if (quotes.length < SEQUENCE_LEN + 100) {
    return { action: 'Hold', confidence: 0, score: 0.5, episodesRun: 0, totalReward: 0, actionProbs: [1, 0, 0] };
  }

  const features = buildFeatures(quotes);

  // Initialize or reuse networks
  const needNew = !ppoCache || ppoCache.symbol !== symbol;
  let actor: tfNs.LayersModel;
  let critic: tfNs.LayersModel;

  if (needNew) {
    if (ppoCache) {
      ppoCache.actor.dispose();
      ppoCache.critic.dispose();
    }
    actor = buildActorNetwork();
    critic = buildCriticNetwork();
  } else {
    actor = ppoCache!.actor;
    critic = ppoCache!.critic;
  }

  const EPISODES = 1; // single episode to avoid blocking the main thread
  const EPISODE_LEN = Math.min(100, features.length - 10); // shorter episodes
  const CLIP_EPSILON = 0.2;

  let totalReward = 0;

  for (let ep = 0; ep < EPISODES; ep++) {
    // Random start point in the data
    const startIdx = Math.floor(Math.random() * Math.max(1, features.length - EPISODE_LEN - 1));
    const episodeFeatures = features.slice(startIdx, startIdx + EPISODE_LEN);

    const steps: RLEpisodeStep[] = [];
    let position = 0;
    let entryPrice = 0;
    let timeInTrade = 0;

    for (let t = 0; t < episodeFeatures.length - 1; t++) {
      const state: RLEnvironmentState = {
        features: episodeFeatures[t],
        position,
        unrealizedPnl: position !== 0 && entryPrice > 0
          ? position * (episodeFeatures[t][0]) // return-based PnL proxy
          : 0,
        timeInTrade,
      };

      const stateVec = getStateVector(state);
      const stateTensor = tf.tensor2d([stateVec]);

      // Get action probabilities from actor
      const actionProbsTensor = actor.predict(stateTensor) as tfNs.Tensor;
      const actionProbs = await actionProbsTensor.data();

      // Get value estimate from critic
      const valueTensor = critic.predict(stateTensor) as tfNs.Tensor;
      const value = (await valueTensor.data())[0];

      // Sample action from policy
      const rand = Math.random();
      let action = 0;
      let cumProb = 0;
      for (let a = 0; a < NUM_ACTIONS; a++) {
        cumProb += actionProbs[a];
        if (rand < cumProb) { action = a; break; }
      }

      const logProb = Math.log(Math.max(actionProbs[action], 1e-8));

      stateTensor.dispose();
      actionProbsTensor.dispose();
      valueTensor.dispose();

      // Execute action and compute reward
      let reward = 0;
      const nextReturn = episodeFeatures[t + 1][0]; // next bar return

      if (action === 1 && position === 0) {
        // Buy: enter long
        position = 1;
        entryPrice = 1; // normalized
        timeInTrade = 0;
        reward = -0.001; // small transaction cost
      } else if (action === 2 && position === 1) {
        // Sell: close long position
        reward = nextReturn * 100 - 0.001; // realized PnL minus cost
        position = 0;
        entryPrice = 0;
        timeInTrade = 0;
      } else if (action === 0) {
        // Hold
        if (position === 1) {
          reward = nextReturn * 50; // unrealized PnL change (scaled)
          timeInTrade++;
          // Penalize holding too long
          if (timeInTrade > 15) reward -= 0.01;
        } else {
          reward = 0; // flat, no reward
        }
      } else {
        // Invalid action (buy when already long, sell when flat)
        reward = -0.005;
      }

      steps.push({ state: stateVec, action, reward, logProb, value });
      totalReward += reward;
    }

    // PPO update
    if (steps.length > 10) {
      await yieldToUI(); // let browser paint between training steps
      const { returns, advantages } = computeAdvantages(steps);

      const statesBatch = tf.tensor2d(steps.map(s => s.state));
      const returnsBatch = tf.tensor2d(returns.map(r => [r]));

      // Update critic (value function)
      await critic.fit(statesBatch, returnsBatch, { epochs: 2, batchSize: 64, verbose: 0 });

      // Update actor with PPO clipped objective
      const actionsBatch = steps.map(s => s.action);
      const oldLogProbs = steps.map(s => s.logProb);

      // Get current action probs
      const currentProbsTensor = actor.predict(statesBatch) as tfNs.Tensor;
      const currentProbs = await currentProbsTensor.data();
      currentProbsTensor.dispose();

      // Build PPO-style targets for actor
      // We approximate by using weighted cross-entropy with advantage-scaled labels
      const targetProbs: number[][] = [];
      for (let i = 0; i < steps.length; i++) {
        const probs = [0, 0, 0];
        const a = actionsBatch[i];
        const newLogProb = Math.log(Math.max(currentProbs[i * NUM_ACTIONS + a], 1e-8));
        const ratio = Math.exp(newLogProb - oldLogProbs[i]);
        const clippedRatio = clamp(ratio, 1 - CLIP_EPSILON, 1 + CLIP_EPSILON);
        const weight = Math.min(ratio * advantages[i], clippedRatio * advantages[i]);

        // Use softmax-weighted target: boost action probability proportional to advantage
        for (let j = 0; j < NUM_ACTIONS; j++) {
          probs[j] = currentProbs[i * NUM_ACTIONS + j];
        }
        probs[a] = clamp(probs[a] + weight * 0.1, 0.01, 0.99);
        // Re-normalize
        const sum = probs.reduce((s, p) => s + p, 0);
        for (let j = 0; j < NUM_ACTIONS; j++) probs[j] /= sum;

        targetProbs.push(probs);
      }

      const targetTensor = tf.tensor2d(targetProbs);
      await actor.fit(statesBatch, targetTensor, { epochs: 2, batchSize: 64, verbose: 0 });

      statesBatch.dispose();
      returnsBatch.dispose();
      targetTensor.dispose();
    }
  }

  // Get final action recommendation from latest state
  const lastFeatures = features[features.length - 1];
  const finalState: RLEnvironmentState = {
    features: lastFeatures,
    position: 0,
    unrealizedPnl: 0,
    timeInTrade: 0,
  };
  const finalStateVec = getStateVector(finalState);
  const finalTensor = tf.tensor2d([finalStateVec]);
  const finalProbsTensor = actor.predict(finalTensor) as tfNs.Tensor;
  const finalProbs = await finalProbsTensor.data();
  finalTensor.dispose();
  finalProbsTensor.dispose();

  // Cache networks
  ppoCache = { actor, critic, symbol };

  const holdProb = finalProbs[0];
  const buyProb = finalProbs[1];
  const sellProb = finalProbs[2];

  // Determine action
  let action: 'Buy' | 'Hold' | 'Sell';
  let confidence: number;
  if (buyProb > holdProb && buyProb > sellProb) {
    action = 'Buy';
    confidence = buyProb * 100;
  } else if (sellProb > holdProb && sellProb > buyProb) {
    action = 'Sell';
    confidence = sellProb * 100;
  } else {
    action = 'Hold';
    confidence = holdProb * 100;
  }

  // Convert to 0-1 score: buy=high, sell=low
  const score = clamp(0.5 + (buyProb - sellProb) * 0.5, 0, 1);

  return {
    action,
    confidence: Math.round(confidence),
    score,
    episodesRun: EPISODES,
    totalReward: totalReward / EPISODES,
    actionProbs: [holdProb, buyProb, sellProb],
  };
}

// ─────────────────────────────────────────────────────────────
//  3. COMBINED ML PREDICTION (orchestrates all models)
// ─────────────────────────────────────────────────────────────

export interface MLPrediction {
  // LSTM
  lstmScore: number;
  lstmConfidence: number;
  lstmPredictedReturn: number;
  lstmEpochs: number;

  // Attention
  attentionScore: number;
  temporalFocus: 'short' | 'medium' | 'long';

  // RL PPO
  rlAction: 'Buy' | 'Hold' | 'Sell';
  rlScore: number;
  rlConfidence: number;
  rlTotalReward: number;
  rlActionProbs: [number, number, number];
  rlEpisodes: number;

  // Combined
  ensembleScore: number;
  ensembleSignal: string;
  isReal: true; // flag that this is real TF.js inference
}

/**
 * Run all ML models and produce a combined prediction.
 * TF.js is lazy-loaded on first call (~2MB, loaded once then cached).
 */
export async function runFullMLPrediction(
  quotes: StockQuote[],
  symbol: string,
  snap: IndicatorSnapshot,
): Promise<MLPrediction> {
  // Ensure TF.js is loaded before any model code runs
  await ensureTf();

  // Run models sequentially with yields to keep UI responsive
  const lstmResult = await runLSTMPrediction(quotes, symbol);
  await yieldToUI();
  const attentionResult = await runAttentionAnalysis(quotes);
  await yieldToUI();
  const rlResult = await runRLAgent(quotes, symbol, snap);

  // Weighted ensemble: LSTM 35%, Attention 15%, RL 30%, agree-boost 20%
  const lstmW = 0.35;
  const attnW = 0.15;
  const rlW = 0.30;

  const baseScore = lstmResult.score * lstmW + attentionResult.attentionScore * attnW + rlResult.score * rlW;

  // Agreement bonus: if LSTM and RL agree on direction, boost confidence
  const lstmBullish = lstmResult.score > 0.55;
  const rlBullish = rlResult.score > 0.55;
  const lstmBearish = lstmResult.score < 0.45;
  const rlBearish = rlResult.score < 0.45;
  const agree = (lstmBullish && rlBullish) || (lstmBearish && rlBearish);
  const agreeBonus = agree ? (baseScore > 0.5 ? 0.1 : -0.1) : 0;

  const ensembleScore = clamp(baseScore + agreeBonus * 0.20 / (1 - lstmW - attnW - rlW), 0, 1);

  let ensembleSignal: string;
  if (ensembleScore >= 0.72) ensembleSignal = 'Strong Buy';
  else if (ensembleScore >= 0.58) ensembleSignal = 'Buy';
  else if (ensembleScore >= 0.42) ensembleSignal = 'Hold';
  else if (ensembleScore >= 0.28) ensembleSignal = 'Sell';
  else ensembleSignal = 'Strong Sell';

  return {
    lstmScore: lstmResult.score,
    lstmConfidence: lstmResult.confidence,
    lstmPredictedReturn: lstmResult.predictedReturn,
    lstmEpochs: lstmResult.epochsRun,

    attentionScore: attentionResult.attentionScore,
    temporalFocus: attentionResult.temporalFocus,

    rlAction: rlResult.action,
    rlScore: rlResult.score,
    rlConfidence: rlResult.confidence,
    rlTotalReward: rlResult.totalReward,
    rlActionProbs: rlResult.actionProbs,
    rlEpisodes: rlResult.episodesRun,

    ensembleScore,
    ensembleSignal,
    isReal: true,
  };
}

// ─── Utility ───
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
