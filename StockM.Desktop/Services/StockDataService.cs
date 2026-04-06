using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using StockM.Desktop.Models;

namespace StockM.Desktop.Services;

public class StockDataService
{
    private readonly HttpClient _httpClient;
    private readonly string _apiKey;
    private const string BaseUrl = "https://www.alphavantage.co/query";

    public StockDataService(HttpClient httpClient, string apiKey)
    {
        _httpClient = httpClient;
        _apiKey = apiKey;
    }

    public async Task<StockBar> GetDailyDataAsync(string symbol, CancellationToken ct = default)
    {
        var url = $"{BaseUrl}?function=TIME_SERIES_DAILY&symbol={Uri.EscapeDataString(symbol)}&outputsize=full&apikey={_apiKey}";
        var response = await _httpClient.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var root = doc.RootElement;

        var quotes = new List<StockQuote>();

        if (root.TryGetProperty("Time Series (Daily)", out var timeSeries))
        {
            foreach (var day in timeSeries.EnumerateObject())
            {
                if (DateTime.TryParse(day.Name, out var date))
                {
                    quotes.Add(new StockQuote
                    {
                        Timestamp = date,
                        Open = decimal.Parse(day.Value.GetProperty("1. open").GetString()!),
                        High = decimal.Parse(day.Value.GetProperty("2. high").GetString()!),
                        Low = decimal.Parse(day.Value.GetProperty("3. low").GetString()!),
                        Close = decimal.Parse(day.Value.GetProperty("4. close").GetString()!),
                        Volume = long.Parse(day.Value.GetProperty("5. volume").GetString()!)
                    });
                }
            }
        }

        return new StockBar
        {
            Symbol = symbol,
            Quotes = quotes.OrderBy(q => q.Timestamp).ToList()
        };
    }

    public async Task<TickData?> GetLatestQuoteAsync(string symbol, CancellationToken ct = default)
    {
        var url = $"{BaseUrl}?function=GLOBAL_QUOTE&symbol={Uri.EscapeDataString(symbol)}&apikey={_apiKey}";
        var response = await _httpClient.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        using var doc = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var root = doc.RootElement;

        if (root.TryGetProperty("Global Quote", out var quote))
        {
            return new TickData
            {
                Symbol = symbol,
                Price = decimal.Parse(quote.GetProperty("05. price").GetString()!),
                Volume = long.Parse(quote.GetProperty("06. volume").GetString()!),
                Timestamp = DateTime.UtcNow
            };
        }

        return null;
    }

    /// <summary>
    /// Generates simulated real-time data for demo/testing when no API key is available.
    /// </summary>
    public static StockBar GenerateSampleData(string symbol, int days = 500)
    {
        var rng = new Random(symbol.GetHashCode());
        var quotes = new List<StockQuote>();
        var basePrice = 100m + rng.Next(50, 400);
        var date = DateTime.Today.AddDays(-days);

        for (int i = 0; i < days; i++)
        {
            if (date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday)
            {
                date = date.AddDays(1);
                continue;
            }

            var change = (decimal)(rng.NextDouble() * 6 - 3);
            var open = basePrice + change * 0.3m;
            var close = basePrice + change;
            var high = Math.Max(open, close) + (decimal)(rng.NextDouble() * 2);
            var low = Math.Min(open, close) - (decimal)(rng.NextDouble() * 2);

            quotes.Add(new StockQuote
            {
                Timestamp = date,
                Open = Math.Round(open, 2),
                High = Math.Round(high, 2),
                Low = Math.Round(low, 2),
                Close = Math.Round(close, 2),
                Volume = rng.Next(500_000, 50_000_000)
            });

            basePrice = close;
            date = date.AddDays(1);
        }

        return new StockBar { Symbol = symbol, Quotes = quotes };
    }
}
