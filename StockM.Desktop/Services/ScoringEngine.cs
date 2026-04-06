using StockM.Desktop.Models;

namespace StockM.Desktop.Services;

/// <summary>
/// Simplified scoring engine inspired by H-BLSTM + XGBoost hybrid approach.
/// Combines feature importance (XGBoost-style) with temporal signal analysis.
/// In production, replace with actual ML model inference via ONNX Runtime.
/// </summary>
public class ScoringEngine
{
    // Feature weights (simulating XGBoost feature selection output)
    private static readonly Dictionary<string, double> FeatureWeights = new()
    {
        ["ma_crossover"] = 0.20,
        ["rsi_signal"] = 0.18,
        ["bollinger_position"] = 0.15,
        ["volume_trend"] = 0.12,
        ["price_momentum"] = 0.15,
        ["volatility_regime"] = 0.10,
        ["mean_reversion"] = 0.10
    };

    /// <summary>
    /// Generate a composite model score between 0.0 and 1.0.
    /// Score > 0.65 → Strong signal (Risk-Control mode entry)
    /// Score > 0.55 → Normal signal (Normal mode entry)
    /// </summary>
    public double CalculateScore(IReadOnlyList<StockQuote> quotes, IndicatorSnapshot snapshot)
    {
        if (quotes.Count < 121) return 0.0;

        double score = 0.0;

        // MA Crossover signal
        double maCrossScore = snapshot.MACrossoverBullish ? 0.8 : 0.3;
        score += maCrossScore * FeatureWeights["ma_crossover"];

        // RSI signal (best in 30-60 range for buy)
        double rsiScore;
        if (snapshot.RSI < 30) rsiScore = 0.9;       // Oversold - strong buy
        else if (snapshot.RSI < 45) rsiScore = 0.7;   // Approaching oversold
        else if (snapshot.RSI < 55) rsiScore = 0.5;   // Neutral
        else if (snapshot.RSI < 70) rsiScore = 0.3;   // Approaching overbought
        else rsiScore = 0.1;                           // Overbought - weak
        score += rsiScore * FeatureWeights["rsi_signal"];

        // Bollinger Band position (price near lower band = buy opportunity)
        var lastClose = quotes[^1].Close;
        double bbRange = (double)(snapshot.BollingerUpper - snapshot.BollingerLower);
        double bbPosition = bbRange > 0
            ? (double)(lastClose - snapshot.BollingerLower) / bbRange
            : 0.5;
        double bbScore = 1.0 - bbPosition; // Lower position = higher score
        score += bbScore * FeatureWeights["bollinger_position"];

        // Volume trend (increasing volume confirms moves)
        double volumeScore = CalculateVolumeTrend(quotes);
        score += volumeScore * FeatureWeights["volume_trend"];

        // Price momentum (rate of change)
        double momentumScore = CalculateMomentum(quotes);
        score += momentumScore * FeatureWeights["price_momentum"];

        // Volatility regime (lower ATR relative to price = more predictable)
        double volScore = snapshot.ATR > 0 ? Math.Max(0, 1.0 - (double)(snapshot.ATR / lastClose) * 10) : 0.5;
        score += volScore * FeatureWeights["volatility_regime"];

        // Mean reversion signal
        double mrScore = CalculateMeanReversion(quotes, snapshot);
        score += mrScore * FeatureWeights["mean_reversion"];

        return Math.Clamp(score, 0.0, 1.0);
    }

    public StockSignal GenerateSignal(string symbol, IReadOnlyList<StockQuote> quotes, RiskParameters riskParams)
    {
        var snapshot = TechnicalIndicators.ComputeSnapshot(quotes);
        var score = CalculateScore(quotes, snapshot);
        var lastQuote = quotes[^1];

        var mode = score >= riskParams.RiskControlThreshold
            ? TradingMode.RiskControl
            : TradingMode.Normal;

        var signal = score switch
        {
            >= 0.75 => SignalType.StrongBuy,
            >= 0.55 => SignalType.Buy,
            >= 0.45 => SignalType.Hold,
            >= 0.30 => SignalType.Sell,
            _ => SignalType.StrongSell
        };

        // SL: 5% below entry or below entry candle low (whichever gives more room)
        var slPercent = lastQuote.Close * (1 - riskParams.StopLossPercent);
        var slCandleLow = lastQuote.Low - snapshot.ATR * 0.5m;
        var stopLoss = Math.Min(slPercent, slCandleLow);

        // TP: 15% above entry or previous session high
        var tpPercent = lastQuote.Close * (1 + riskParams.TakeProfitPercent);
        var recentHigh = quotes.Skip(Math.Max(0, quotes.Count - 20)).Max(q => q.High);
        var takeProfit = Math.Max(tpPercent, recentHigh);

        // Position sizing with volatility adjustment
        var posSize = riskParams.MaxPositionSizePct;
        bool volAdjusted = false;
        if (snapshot.ATR > lastQuote.Close * 0.03m) // High volatility
        {
            posSize *= (1 - riskParams.VolatilityReductionPct / 100);
            volAdjusted = true;
        }

        var reasoning = BuildReasoning(snapshot, score, signal, volAdjusted);

        return new StockSignal
        {
            Symbol = symbol,
            Signal = signal,
            ModelScore = Math.Round(score, 4),
            EntryPrice = lastQuote.Close,
            StopLoss = Math.Round(stopLoss, 2),
            TakeProfit = Math.Round(takeProfit, 2),
            PositionSizePct = Math.Round(posSize, 2),
            Reasoning = reasoning,
            Mode = mode,
            Indicators = snapshot
        };
    }

    private static double CalculateVolumeTrend(IReadOnlyList<StockQuote> quotes)
    {
        if (quotes.Count < 20) return 0.5;
        var recent = quotes.Skip(quotes.Count - 5).Average(q => (double)q.Volume);
        var baseline = quotes.Skip(quotes.Count - 20).Take(15).Average(q => (double)q.Volume);
        if (baseline == 0) return 0.5;
        var ratio = recent / baseline;
        return Math.Clamp(ratio / 2.0, 0, 1);
    }

    private static double CalculateMomentum(IReadOnlyList<StockQuote> quotes)
    {
        if (quotes.Count < 10) return 0.5;
        var current = (double)quotes[^1].Close;
        var past = (double)quotes[^10].Close;
        if (past == 0) return 0.5;
        var roc = (current - past) / past;
        return Math.Clamp(0.5 + roc * 5, 0, 1); // Normalize around 0.5
    }

    private static double CalculateMeanReversion(IReadOnlyList<StockQuote> quotes, IndicatorSnapshot snapshot)
    {
        var lastClose = (double)quotes[^1].Close;
        var bbMid = (double)snapshot.BollingerMiddle;
        if (bbMid == 0) return 0.5;

        var deviation = (lastClose - bbMid) / bbMid;
        // Far below mean = buy signal, far above = sell signal
        return Math.Clamp(0.5 - deviation * 5, 0, 1);
    }

    private static string BuildReasoning(IndicatorSnapshot snap, double score, SignalType signal, bool volAdj)
    {
        var parts = new List<string>();

        if (snap.MACrossoverBullish) parts.Add("MA30 above MA120 (bullish trend)");
        else parts.Add("MA30 below MA120 (bearish trend)");

        if (snap.IsOversold) parts.Add("RSI oversold — potential reversal");
        else if (snap.IsOverbought) parts.Add("RSI overbought — caution");
        else parts.Add($"RSI at {snap.RSI:F1}");

        if (volAdj) parts.Add("Position reduced due to high volatility");

        parts.Add($"Model confidence: {score:P1}");

        return string.Join(" | ", parts);
    }
}
