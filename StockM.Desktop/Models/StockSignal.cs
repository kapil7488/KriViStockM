namespace StockM.Desktop.Models;

public enum SignalType
{
    StrongBuy,
    Buy,
    Hold,
    Sell,
    StrongSell
}

public enum TradingMode
{
    Normal,
    RiskControl
}

public record StockSignal
{
    public string Symbol { get; init; } = string.Empty;
    public SignalType Signal { get; init; }
    public double ModelScore { get; init; }
    public decimal EntryPrice { get; init; }
    public decimal StopLoss { get; init; }
    public decimal TakeProfit { get; init; }
    public double PositionSizePct { get; init; }
    public string Reasoning { get; init; } = string.Empty;
    public DateTime GeneratedAt { get; init; } = DateTime.UtcNow;
    public TradingMode Mode { get; init; }
    public IndicatorSnapshot Indicators { get; init; } = new();
}

public record IndicatorSnapshot
{
    public decimal MA30 { get; init; }
    public decimal MA120 { get; init; }
    public double RSI { get; init; }
    public decimal BollingerUpper { get; init; }
    public decimal BollingerMiddle { get; init; }
    public decimal BollingerLower { get; init; }
    public decimal ATR { get; init; }
    public bool MACrossoverBullish { get; init; }
    public bool IsOversold { get; init; }
    public bool IsOverbought { get; init; }
}
