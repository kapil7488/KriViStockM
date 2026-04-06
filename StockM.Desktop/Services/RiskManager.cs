using StockM.Desktop.Models;

namespace StockM.Desktop.Services;

public class RiskManager
{
    public RiskAssessment Evaluate(StockSignal signal, RiskParameters parameters)
    {
        var entry = signal.EntryPrice;
        var sl = signal.StopLoss;
        var tp = signal.TakeProfit;

        var riskPerShare = entry - sl;
        var rewardPerShare = tp - entry;

        // Position sizing: risk no more than X% of portfolio on one trade
        var maxRiskAmount = parameters.PortfolioValue * (decimal)parameters.MaxPositionSizePct / 100m;
        int shareCount = riskPerShare > 0
            ? (int)(maxRiskAmount / riskPerShare)
            : 0;

        // Volatility adjustment
        bool volAdj = false;
        if (signal.Indicators.ATR > entry * 0.03m)
        {
            shareCount = (int)(shareCount * (1 - parameters.VolatilityReductionPct / 100));
            volAdj = true;
        }

        var maxLoss = shareCount * riskPerShare;
        var maxGain = shareCount * rewardPerShare;
        var rrRatio = maxLoss > 0 ? (double)(maxGain / maxLoss) : 0;

        return new RiskAssessment
        {
            StopLossPrice = sl,
            TakeProfitPrice = tp,
            RecommendedPositionPct = signal.PositionSizePct,
            ShareCount = shareCount,
            MaxLoss = Math.Round(maxLoss, 2),
            MaxGain = Math.Round(maxGain, 2),
            RiskRewardRatio = Math.Round(rrRatio, 2),
            VolatilityAdjusted = volAdj
        };
    }
}
