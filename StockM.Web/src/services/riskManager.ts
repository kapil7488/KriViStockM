import { StockSignal, RiskParameters, RiskAssessment } from '../types';

export function evaluateRisk(signal: StockSignal, params: RiskParameters): RiskAssessment {
  const entry = signal.entryPrice;
  const sl = signal.stopLoss;
  const tp = signal.takeProfit;

  const riskPerShare = entry - sl;
  const rewardPerShare = tp - entry;

  const maxRiskAmount = params.portfolioValue * params.maxPositionSizePct / 100;
  let shareCount = riskPerShare > 0 ? Math.floor(maxRiskAmount / riskPerShare) : 0;

  let volAdj = false;
  if (signal.indicators.atr > entry * 0.03) {
    shareCount = Math.floor(shareCount * (1 - params.volatilityReductionPct / 100));
    volAdj = true;
  }

  const maxLoss = round2(shareCount * riskPerShare);
  const maxGain = round2(shareCount * rewardPerShare);
  const rrRatio = maxLoss > 0 ? round2(maxGain / maxLoss) : 0;

  return {
    stopLossPrice: sl,
    takeProfitPrice: tp,
    recommendedPositionPct: signal.positionSizePct,
    shareCount,
    maxLoss,
    maxGain,
    riskRewardRatio: rrRatio,
    volatilityAdjusted: volAdj,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
