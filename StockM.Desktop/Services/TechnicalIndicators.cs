using StockM.Desktop.Models;

namespace StockM.Desktop.Services;

public static class TechnicalIndicators
{
    /// <summary>
    /// Simple Moving Average over the specified period.
    /// </summary>
    public static decimal[] SMA(IReadOnlyList<StockQuote> quotes, int period)
    {
        var result = new decimal[quotes.Count];
        for (int i = 0; i < quotes.Count; i++)
        {
            if (i < period - 1)
            {
                result[i] = 0;
                continue;
            }
            decimal sum = 0;
            for (int j = i - period + 1; j <= i; j++)
                sum += quotes[j].Close;
            result[i] = sum / period;
        }
        return result;
    }

    /// <summary>
    /// Relative Strength Index (14-period default).
    /// </summary>
    public static double[] RSI(IReadOnlyList<StockQuote> quotes, int period = 14)
    {
        var result = new double[quotes.Count];
        if (quotes.Count < period + 1) return result;

        double gainSum = 0, lossSum = 0;
        for (int i = 1; i <= period; i++)
        {
            var change = (double)(quotes[i].Close - quotes[i - 1].Close);
            if (change > 0) gainSum += change;
            else lossSum += Math.Abs(change);
        }

        double avgGain = gainSum / period;
        double avgLoss = lossSum / period;

        result[period] = avgLoss == 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));

        for (int i = period + 1; i < quotes.Count; i++)
        {
            var change = (double)(quotes[i].Close - quotes[i - 1].Close);
            double gain = change > 0 ? change : 0;
            double loss = change < 0 ? Math.Abs(change) : 0;

            avgGain = (avgGain * (period - 1) + gain) / period;
            avgLoss = (avgLoss * (period - 1) + loss) / period;

            result[i] = avgLoss == 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
        }

        return result;
    }

    /// <summary>
    /// Bollinger Bands (20-period, 2 std dev default).
    /// Returns (upper, middle, lower) arrays.
    /// </summary>
    public static (decimal[] Upper, decimal[] Middle, decimal[] Lower) BollingerBands(
        IReadOnlyList<StockQuote> quotes, int period = 20, double stdDevMultiplier = 2.0)
    {
        var middle = SMA(quotes, period);
        var upper = new decimal[quotes.Count];
        var lower = new decimal[quotes.Count];

        for (int i = period - 1; i < quotes.Count; i++)
        {
            double sum = 0;
            for (int j = i - period + 1; j <= i; j++)
            {
                var diff = (double)(quotes[j].Close - middle[i]);
                sum += diff * diff;
            }
            var stdDev = (decimal)Math.Sqrt(sum / period);
            upper[i] = middle[i] + (decimal)stdDevMultiplier * stdDev;
            lower[i] = middle[i] - (decimal)stdDevMultiplier * stdDev;
        }

        return (upper, middle, lower);
    }

    /// <summary>
    /// Average True Range for volatility measurement.
    /// </summary>
    public static decimal[] ATR(IReadOnlyList<StockQuote> quotes, int period = 14)
    {
        var result = new decimal[quotes.Count];
        if (quotes.Count < 2) return result;

        var trueRanges = new decimal[quotes.Count];
        trueRanges[0] = quotes[0].High - quotes[0].Low;

        for (int i = 1; i < quotes.Count; i++)
        {
            var hl = quotes[i].High - quotes[i].Low;
            var hc = Math.Abs(quotes[i].High - quotes[i - 1].Close);
            var lc = Math.Abs(quotes[i].Low - quotes[i - 1].Close);
            trueRanges[i] = Math.Max(hl, Math.Max(hc, lc));
        }

        // First ATR is simple average
        if (quotes.Count >= period)
        {
            decimal sum = 0;
            for (int i = 0; i < period; i++) sum += trueRanges[i];
            result[period - 1] = sum / period;

            for (int i = period; i < quotes.Count; i++)
                result[i] = (result[i - 1] * (period - 1) + trueRanges[i]) / period;
        }

        return result;
    }

    /// <summary>
    /// Compute full indicator snapshot for the latest bar.
    /// </summary>
    public static IndicatorSnapshot ComputeSnapshot(IReadOnlyList<StockQuote> quotes)
    {
        if (quotes.Count < 121) return new IndicatorSnapshot();

        var ma30 = SMA(quotes, 30);
        var ma120 = SMA(quotes, 120);
        var rsi = RSI(quotes);
        var (bbUpper, bbMiddle, bbLower) = BollingerBands(quotes);
        var atr = ATR(quotes);

        int last = quotes.Count - 1;
        int prev = last - 1;

        bool bullishCross = ma30[last] > ma120[last] && ma30[prev] <= ma120[prev];
        bool bearishCross = ma30[last] < ma120[last] && ma30[prev] >= ma120[prev];

        return new IndicatorSnapshot
        {
            MA30 = ma30[last],
            MA120 = ma120[last],
            RSI = rsi[last],
            BollingerUpper = bbUpper[last],
            BollingerMiddle = bbMiddle[last],
            BollingerLower = bbLower[last],
            ATR = atr[last],
            MACrossoverBullish = bullishCross || ma30[last] > ma120[last],
            IsOversold = rsi[last] < 30,
            IsOverbought = rsi[last] > 70
        };
    }
}
