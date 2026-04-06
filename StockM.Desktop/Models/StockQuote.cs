namespace StockM.Desktop.Models;

public record StockQuote
{
    public DateTime Timestamp { get; init; }
    public decimal Open { get; init; }
    public decimal High { get; init; }
    public decimal Low { get; init; }
    public decimal Close { get; init; }
    public long Volume { get; init; }
}

public record StockBar
{
    public string Symbol { get; init; } = string.Empty;
    public List<StockQuote> Quotes { get; init; } = new();
}

public record TickData
{
    public string Symbol { get; init; } = string.Empty;
    public decimal Price { get; init; }
    public long Volume { get; init; }
    public DateTime Timestamp { get; init; }
}
