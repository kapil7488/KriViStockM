namespace StockM.Desktop.Models;

public record RiskParameters
{
    public decimal StopLossPercent { get; init; } = 0.05m;
    public decimal TakeProfitPercent { get; init; } = 0.15m;
    public double MaxPositionSizePct { get; init; } = 10.0;
    public double VolatilityReductionPct { get; init; } = 30.0;
    public double NormalModeThreshold { get; init; } = 0.55;
    public double RiskControlThreshold { get; init; } = 0.65;
    public decimal PortfolioValue { get; init; } = 100_000m;
}

public record RiskAssessment
{
    public decimal StopLossPrice { get; init; }
    public decimal TakeProfitPrice { get; init; }
    public double RecommendedPositionPct { get; init; }
    public int ShareCount { get; init; }
    public decimal MaxLoss { get; init; }
    public decimal MaxGain { get; init; }
    public double RiskRewardRatio { get; init; }
    public bool VolatilityAdjusted { get; init; }
}
