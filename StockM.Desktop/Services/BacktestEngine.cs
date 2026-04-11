using StockM.Desktop.Models;

namespace StockM.Desktop.Services;

public class BacktestEngine
{
    private const int MinWarmup = 121;

    private enum BarSignal { None, Buy, Sell }

    // ── Precomputed indicators ─────────────────────────────────
    private sealed class Indicators
    {
        public decimal[] Sma30 = [];
        public decimal[] Sma120 = [];
        public double[] Rsi = [];
        public decimal[] BbUpper = [];
        public decimal[] BbMiddle = [];
        public decimal[] BbLower = [];
        public decimal[] Atr = [];
    }

    private static Indicators Precompute(IReadOnlyList<StockQuote> quotes)
    {
        var sma30 = TechnicalIndicators.SMA(quotes, 30);
        var sma120 = TechnicalIndicators.SMA(quotes, 120);
        var rsi = TechnicalIndicators.RSI(quotes);
        var (bbU, bbM, bbL) = TechnicalIndicators.BollingerBands(quotes);
        var atr = TechnicalIndicators.ATR(quotes);

        return new Indicators
        {
            Sma30 = sma30, Sma120 = sma120, Rsi = rsi,
            BbUpper = bbU, BbMiddle = bbM, BbLower = bbL,
            Atr = atr
        };
    }

    // ── Signal functions per strategy ──────────────────────────
    private static BarSignal SignalRsi(int i, IReadOnlyList<StockQuote> q, Indicators ind)
    {
        if (i < 15 || ind.Rsi[i] == 0) return BarSignal.None;
        var prev = ind.Rsi[i - 1];
        var curr = ind.Rsi[i];
        if (prev < 30 && curr >= 30) return BarSignal.Buy;
        if (curr < 30) return BarSignal.Buy;
        if (prev > 70 && curr <= 70) return BarSignal.Sell;
        if (curr > 70) return BarSignal.Sell;
        return BarSignal.None;
    }

    private static BarSignal SignalSmaCross(int i, IReadOnlyList<StockQuote> q, Indicators ind)
    {
        if (i < 1 || ind.Sma120[i] == 0) return BarSignal.None;
        var prev30 = ind.Sma30[i - 1]; var prev120 = ind.Sma120[i - 1];
        var s30 = ind.Sma30[i]; var s120 = ind.Sma120[i];
        if (prev30 <= prev120 && s30 > s120) return BarSignal.Buy;
        if (prev30 >= prev120 && s30 < s120) return BarSignal.Sell;
        return BarSignal.None;
    }

    private static BarSignal SignalBollinger(int i, IReadOnlyList<StockQuote> q, Indicators ind)
    {
        if (i < 1 || ind.BbUpper[i] == 0) return BarSignal.None;
        var close = q[i].Close;
        var prevClose = q[i - 1].Close;
        if (prevClose <= ind.BbLower[i - 1] && close > ind.BbLower[i]) return BarSignal.Buy;
        if (close <= ind.BbLower[i]) return BarSignal.Buy;
        if (prevClose >= ind.BbUpper[i - 1] && close < ind.BbUpper[i]) return BarSignal.Sell;
        if (close >= ind.BbUpper[i]) return BarSignal.Sell;
        return BarSignal.None;
    }

    private static BarSignal SignalMaMomentum(int i, IReadOnlyList<StockQuote> q, Indicators ind)
    {
        if (i < 1 || ind.Sma120[i] == 0 || ind.Rsi[i] == 0) return BarSignal.None;
        bool maBullish = ind.Sma30[i] > ind.Sma120[i];
        bool rsiBullish = ind.Rsi[i] > 40 && ind.Rsi[i] < 70;
        bool maBearish = ind.Sma30[i] < ind.Sma120[i];
        bool rsiBearish = ind.Rsi[i] > 60;

        if (maBullish && rsiBullish && ind.Sma30[i - 1] <= ind.Sma120[i - 1]) return BarSignal.Buy;
        if (maBearish && rsiBearish) return BarSignal.Sell;
        return BarSignal.None;
    }

    private static BarSignal SignalAtrBreakout(int i, IReadOnlyList<StockQuote> q, Indicators ind)
    {
        if (i < 21 || ind.Atr[i] == 0) return BarSignal.None;
        decimal atrSum = 0;
        for (int j = i - 20; j < i; j++) atrSum += ind.Atr[j];
        var avgAtr = atrSum / 20;
        if (ind.Atr[i] <= avgAtr * 1.5m) return BarSignal.None;
        if (q[i].Close > q[i - 1].Close) return BarSignal.Buy;
        if (q[i].Close < q[i - 1].Close) return BarSignal.Sell;
        return BarSignal.None;
    }

    private static BarSignal SignalComboTrend(int i, IReadOnlyList<StockQuote> q, Indicators ind)
    {
        var sma = SignalSmaCross(i, q, ind);
        var bb = SignalBollinger(i, q, ind);
        var rsi = SignalRsi(i, q, ind);

        int buy = 0, sell = 0;
        if (sma == BarSignal.Buy) buy++; else if (sma == BarSignal.Sell) sell++;
        if (bb == BarSignal.Buy) buy++; else if (bb == BarSignal.Sell) sell++;
        if (rsi == BarSignal.Buy) buy++; else if (rsi == BarSignal.Sell) sell++;

        if (buy >= 2) return BarSignal.Buy;
        if (sell >= 2) return BarSignal.Sell;
        return BarSignal.None;
    }

    private Func<int, IReadOnlyList<StockQuote>, Indicators, BarSignal> GetSignalFn(StrategyId strategy) => strategy switch
    {
        StrategyId.RsiOversoldOverbought => SignalRsi,
        StrategyId.SmaCross => SignalSmaCross,
        StrategyId.BollingerBands => SignalBollinger,
        StrategyId.MaCrossoverMomentum => SignalMaMomentum,
        StrategyId.AtrBreakout => SignalAtrBreakout,
        StrategyId.ComboTrend => SignalComboTrend,
        _ => (_, _, _) => BarSignal.None,
    };

    // ── Core backtest ──────────────────────────────────────────
    public BacktestResult Run(string symbol, List<StockQuote> quotes, BacktestConfig config)
    {
        var stratDef = StrategyDef.All.First(s => s.Id == config.Strategy);
        var signalFn = GetSignalFn(config.Strategy);
        var ind = Precompute(quotes);

        decimal capital = config.InitialCapital;
        decimal peakCapital = capital;
        decimal maxDrawdown = 0;
        var trades = new List<BacktestTrade>();
        var equityCurve = new List<(string Date, decimal Equity)>();

        int maxHoldBars = config.MaxHoldingDays > 0 ? config.MaxHoldingDays : int.MaxValue;

        bool inPosition = false;
        string posType = "Long";
        decimal entryPrice = 0;
        int entryIdx = 0;
        int shares = 0;
        decimal stopPrice = 0;
        decimal targetPrice = 0;

        for (int i = MinWarmup; i < quotes.Count; i++)
        {
            var bar = quotes[i];
            var close = bar.Close;

            if (inPosition)
            {
                int holdingDays = i - entryIdx;
                string? exitReason = null;
                decimal exitPrice = 0;

                if (posType == "Long")
                {
                    if (bar.Low <= stopPrice) { exitReason = "SL"; exitPrice = stopPrice; }
                    else if (bar.High >= targetPrice) { exitReason = "TP"; exitPrice = targetPrice; }
                }
                else
                {
                    if (bar.High >= stopPrice) { exitReason = "SL"; exitPrice = stopPrice; }
                    else if (bar.Low <= targetPrice) { exitReason = "TP"; exitPrice = targetPrice; }
                }

                if (exitReason == null && holdingDays >= maxHoldBars)
                {
                    exitReason = "MaxHold";
                    exitPrice = close;
                }

                if (exitReason == null)
                {
                    var sig = signalFn(i, quotes, ind);
                    if (posType == "Long" && sig == BarSignal.Sell) { exitReason = "Signal"; exitPrice = close; }
                    if (posType == "Short" && sig == BarSignal.Buy) { exitReason = "Signal"; exitPrice = close; }
                }

                if (exitReason != null)
                {
                    decimal grossPnl = posType == "Long"
                        ? (exitPrice - entryPrice) * shares
                        : (entryPrice - exitPrice) * shares;
                    decimal commission = (entryPrice * shares + exitPrice * shares) * (decimal)(config.CommissionPct / 100);
                    decimal netPnl = grossPnl - commission;
                    capital += netPnl;

                    trades.Add(new BacktestTrade
                    {
                        EntryDate = quotes[entryIdx].Timestamp.ToString("yyyy-MM-dd"),
                        ExitDate = bar.Timestamp.ToString("yyyy-MM-dd"),
                        Type = posType,
                        EntryPrice = Math.Round(entryPrice, 2),
                        ExitPrice = Math.Round(exitPrice, 2),
                        Shares = shares,
                        Pnl = Math.Round(netPnl, 2),
                        PnlPct = entryPrice > 0 ? Math.Round((double)(netPnl / (entryPrice * shares)) * 100, 2) : 0,
                        ExitReason = exitReason,
                        HoldingDays = holdingDays,
                    });

                    inPosition = false;
                }
            }

            // Entry
            if (!inPosition && i < quotes.Count - 1)
            {
                var sig = signalFn(i, quotes, ind);
                if (sig == BarSignal.Buy || sig == BarSignal.Sell)
                {
                    decimal riskAmount = capital * (decimal)(config.RiskPerTradePct / 100);
                    decimal slDist = close * (decimal)(config.StopLossPct / 100);
                    if (slDist <= 0) continue;
                    shares = Math.Max(1, (int)(riskAmount / slDist));
                    decimal positionCost = shares * close;
                    if (positionCost > capital * 0.95m)
                        shares = Math.Max(1, (int)(capital * 0.95m / close));
                    if (shares < 1) continue;

                    posType = sig == BarSignal.Buy ? "Long" : "Short";
                    entryPrice = close;
                    entryIdx = i;
                    inPosition = true;

                    if (posType == "Long")
                    {
                        stopPrice = Math.Round(close * (1 - (decimal)(config.StopLossPct / 100)), 2);
                        targetPrice = Math.Round(close * (1 + (decimal)(config.TakeProfitPct / 100)), 2);
                    }
                    else
                    {
                        stopPrice = Math.Round(close * (1 + (decimal)(config.StopLossPct / 100)), 2);
                        targetPrice = Math.Round(close * (1 - (decimal)(config.TakeProfitPct / 100)), 2);
                    }
                }
            }

            // Equity
            decimal unrealized = 0;
            if (inPosition)
            {
                unrealized = posType == "Long"
                    ? (close - entryPrice) * shares
                    : (entryPrice - close) * shares;
            }
            decimal eq = capital + unrealized;
            equityCurve.Add((bar.Timestamp.ToString("yyyy-MM-dd"), Math.Round(eq, 2)));
            if (eq > peakCapital) peakCapital = eq;
            decimal dd = peakCapital - eq;
            if (dd > maxDrawdown) maxDrawdown = dd;
        }

        // Force close open position
        if (inPosition)
        {
            var lastBar = quotes[^1];
            decimal exitPrice = lastBar.Close;
            decimal grossPnl = posType == "Long"
                ? (exitPrice - entryPrice) * shares
                : (entryPrice - exitPrice) * shares;
            decimal commission = (entryPrice * shares + exitPrice * shares) * (decimal)(config.CommissionPct / 100);
            decimal netPnl = grossPnl - commission;
            capital += netPnl;
            trades.Add(new BacktestTrade
            {
                EntryDate = quotes[entryIdx].Timestamp.ToString("yyyy-MM-dd"),
                ExitDate = lastBar.Timestamp.ToString("yyyy-MM-dd"),
                Type = posType,
                EntryPrice = Math.Round(entryPrice, 2),
                ExitPrice = Math.Round(exitPrice, 2),
                Shares = shares,
                Pnl = Math.Round(netPnl, 2),
                PnlPct = entryPrice > 0 ? Math.Round((double)(netPnl / (entryPrice * shares)) * 100, 2) : 0,
                ExitReason = "End",
                HoldingDays = quotes.Count - 1 - entryIdx,
            });
        }

        // Metrics
        var wins = trades.Where(t => t.Pnl > 0).ToList();
        var losses = trades.Where(t => t.Pnl <= 0).ToList();
        decimal grossProfit = wins.Sum(t => t.Pnl);
        decimal grossLoss = Math.Abs(losses.Sum(t => t.Pnl));

        int curWin = 0, curLose = 0, maxWinStreak = 0, maxLoseStreak = 0;
        foreach (var t in trades)
        {
            if (t.Pnl > 0) { curWin++; curLose = 0; maxWinStreak = Math.Max(maxWinStreak, curWin); }
            else { curLose++; curWin = 0; maxLoseStreak = Math.Max(maxLoseStreak, curLose); }
        }

        // Sharpe
        var dailyReturns = new List<double>();
        for (int i = 1; i < equityCurve.Count; i++)
        {
            var prev = (double)equityCurve[i - 1].Equity;
            if (prev > 0)
                dailyReturns.Add(((double)equityCurve[i].Equity - prev) / prev);
        }
        double avgRet = dailyReturns.Count > 0 ? dailyReturns.Average() : 0;
        double stdRet = dailyReturns.Count > 1
            ? Math.Sqrt(dailyReturns.Sum(r => (r - avgRet) * (r - avgRet)) / (dailyReturns.Count - 1))
            : 0;
        double sharpe = stdRet > 0 ? avgRet / stdRet * Math.Sqrt(252) : 0;

        decimal netProfit = capital - config.InitialCapital;

        return new BacktestResult
        {
            Strategy = stratDef,
            Symbol = symbol,
            DataRange = $"{quotes[MinWarmup].Timestamp:yyyy-MM-dd} → {quotes[^1].Timestamp:yyyy-MM-dd}",
            TotalBars = quotes.Count - MinWarmup,
            InitialCapital = config.InitialCapital,
            FinalCapital = Math.Round(capital, 2),
            NetProfit = Math.Round(netProfit, 2),
            NetProfitPct = Math.Round((double)(netProfit / config.InitialCapital) * 100, 2),
            TotalTrades = trades.Count,
            WinningTrades = wins.Count,
            LosingTrades = losses.Count,
            WinRate = trades.Count > 0 ? Math.Round((double)wins.Count / trades.Count * 100, 1) : 0,
            ProfitFactor = grossLoss > 0 ? Math.Round((double)(grossProfit / grossLoss), 2) : grossProfit > 0 ? 999 : 0,
            MaxDrawdown = Math.Round(maxDrawdown, 2),
            MaxDrawdownPct = peakCapital > 0 ? Math.Round((double)(maxDrawdown / peakCapital) * 100, 2) : 0,
            SharpeRatio = Math.Round(sharpe, 2),
            AvgWin = wins.Count > 0 ? Math.Round(grossProfit / wins.Count, 2) : 0,
            AvgLoss = losses.Count > 0 ? Math.Round(grossLoss / losses.Count, 2) : 0,
            AvgHoldingDays = trades.Count > 0 ? Math.Round((double)trades.Sum(t => t.HoldingDays) / trades.Count, 1) : 0,
            LongestWinStreak = maxWinStreak,
            LongestLoseStreak = maxLoseStreak,
            Trades = trades,
            EquityCurve = equityCurve,
        };
    }

    /// <summary>Run all strategies and return sorted by net profit.</summary>
    public List<BacktestResult> CompareAll(string symbol, List<StockQuote> quotes, BacktestConfig baseConfig)
    {
        var results = new List<BacktestResult>();
        foreach (var strat in StrategyDef.All)
        {
            var config = baseConfig with { Strategy = strat.Id };
            results.Add(Run(symbol, quotes, config));
        }
        return results.OrderByDescending(r => r.NetProfitPct).ToList();
    }
}
