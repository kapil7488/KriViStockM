namespace StockM.Desktop.Models;

public enum StrategyId
{
    RsiOversoldOverbought,
    SmaCross,
    BollingerBands,
    MaCrossoverMomentum,
    AtrBreakout,
    ComboTrend
}

public record StrategyDef(StrategyId Id, string Label, string Emoji, string Description)
{
    public static readonly StrategyDef[] All =
    [
        new(StrategyId.RsiOversoldOverbought, "RSI (14)", "📈", "Buy on oversold (<30), sell on overbought (>70)"),
        new(StrategyId.SmaCross, "SMA Cross (30/120)", "✂️", "Buy on golden cross, sell on death cross"),
        new(StrategyId.BollingerBands, "Bollinger Bands", "🎯", "Buy at lower band, sell at upper band"),
        new(StrategyId.MaCrossoverMomentum, "MA + RSI Momentum", "🚀", "MA crossover confirmed by RSI momentum"),
        new(StrategyId.AtrBreakout, "ATR Breakout", "🌊", "Buy on volatility expansion breakout"),
        new(StrategyId.ComboTrend, "Combo Trend (SMA+BB+RSI)", "📊", "Triple indicator confluence"),
    ];
}

public record BacktestConfig
{
    public StrategyId Strategy { get; init; } = StrategyId.SmaCross;
    public int MaxHoldingDays { get; init; } = 20;
    public decimal InitialCapital { get; init; } = 100_000m;
    public double RiskPerTradePct { get; init; } = 2.0;
    public double StopLossPct { get; init; } = 5.0;
    public double TakeProfitPct { get; init; } = 10.0;
    public double CommissionPct { get; init; } = 0.1;
}

public record BacktestTrade
{
    public string EntryDate { get; init; } = "";
    public string ExitDate { get; init; } = "";
    public string Type { get; init; } = "Long";
    public decimal EntryPrice { get; init; }
    public decimal ExitPrice { get; init; }
    public int Shares { get; init; }
    public decimal Pnl { get; init; }
    public double PnlPct { get; init; }
    public string ExitReason { get; init; } = "";
    public int HoldingDays { get; init; }

    public bool IsWin => Pnl > 0;
}

public record BacktestResult
{
    public StrategyDef Strategy { get; init; } = StrategyDef.All[0];
    public string Symbol { get; init; } = "";
    public string DataRange { get; init; } = "";
    public int TotalBars { get; init; }
    public decimal InitialCapital { get; init; }
    public decimal FinalCapital { get; init; }
    public decimal NetProfit { get; init; }
    public double NetProfitPct { get; init; }
    public int TotalTrades { get; init; }
    public int WinningTrades { get; init; }
    public int LosingTrades { get; init; }
    public double WinRate { get; init; }
    public double ProfitFactor { get; init; }
    public decimal MaxDrawdown { get; init; }
    public double MaxDrawdownPct { get; init; }
    public double SharpeRatio { get; init; }
    public decimal AvgWin { get; init; }
    public decimal AvgLoss { get; init; }
    public double AvgHoldingDays { get; init; }
    public int LongestWinStreak { get; init; }
    public int LongestLoseStreak { get; init; }
    public List<BacktestTrade> Trades { get; init; } = [];
    public List<(string Date, decimal Equity)> EquityCurve { get; init; } = [];
}
