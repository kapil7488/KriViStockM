using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Windows.Input;
using StockM.Desktop.Models;
using StockM.Desktop.Services;

namespace StockM.Desktop.ViewModels;

public class RelayCommand : ICommand
{
    private readonly Action<object?> _execute;
    private readonly Func<object?, bool>? _canExecute;

    public RelayCommand(Action<object?> execute, Func<object?, bool>? canExecute = null)
    {
        _execute = execute;
        _canExecute = canExecute;
    }

    public event EventHandler? CanExecuteChanged
    {
        add => CommandManager.RequerySuggested += value;
        remove => CommandManager.RequerySuggested -= value;
    }

    public bool CanExecute(object? parameter) => _canExecute?.Invoke(parameter) ?? true;
    public void Execute(object? parameter) => _execute(parameter);
}

public class MainViewModel : INotifyPropertyChanged
{
    private readonly ScoringEngine _scoringEngine = new();
    private readonly RiskManager _riskManager = new();

    private string _symbolInput = "AAPL";
    private string _apiKey = "";
    private bool _isLoading;
    private string _statusMessage = "Ready — Enter a symbol and click Analyze";
    private StockSignal? _currentSignal;
    private RiskAssessment? _currentRisk;
    private RiskParameters _riskParameters = new();
    private TradingMode _selectedMode = TradingMode.Normal;

    public MainViewModel()
    {
        AnalyzeCommand = new RelayCommand(_ => _ = AnalyzeAsync(), _ => !IsLoading);
        AddToWatchlistCommand = new RelayCommand(_ => AddToWatchlist(), _ => CurrentSignal != null);
        Signals = new ObservableCollection<StockSignal>();
        WatchlistSymbols = new ObservableCollection<string> { "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM" };
        ChartPrices = new ObservableCollection<decimal>();
        ChartDates = new ObservableCollection<string>();
    }

    public string SymbolInput
    {
        get => _symbolInput;
        set { _symbolInput = value?.ToUpperInvariant() ?? ""; OnPropertyChanged(); }
    }

    public string ApiKey
    {
        get => _apiKey;
        set { _apiKey = value ?? ""; OnPropertyChanged(); }
    }

    public bool IsLoading
    {
        get => _isLoading;
        set { _isLoading = value; OnPropertyChanged(); }
    }

    public string StatusMessage
    {
        get => _statusMessage;
        set { _statusMessage = value; OnPropertyChanged(); }
    }

    public StockSignal? CurrentSignal
    {
        get => _currentSignal;
        set { _currentSignal = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasSignal)); }
    }

    public RiskAssessment? CurrentRisk
    {
        get => _currentRisk;
        set { _currentRisk = value; OnPropertyChanged(); }
    }

    public bool HasSignal => CurrentSignal != null;

    public TradingMode SelectedMode
    {
        get => _selectedMode;
        set { _selectedMode = value; OnPropertyChanged(); }
    }

    public RiskParameters RiskParameters
    {
        get => _riskParameters;
        set { _riskParameters = value; OnPropertyChanged(); }
    }

    public ObservableCollection<StockSignal> Signals { get; }
    public ObservableCollection<string> WatchlistSymbols { get; }
    public ObservableCollection<decimal> ChartPrices { get; }
    public ObservableCollection<string> ChartDates { get; }

    public ICommand AnalyzeCommand { get; }
    public ICommand AddToWatchlistCommand { get; }

    public async Task AnalyzeAsync()
    {
        if (string.IsNullOrWhiteSpace(SymbolInput)) return;

        IsLoading = true;
        StatusMessage = $"Analyzing {SymbolInput}...";

        try
        {
            StockBar data;

            if (!string.IsNullOrWhiteSpace(ApiKey))
            {
                using var httpClient = new HttpClient();
                var service = new StockDataService(httpClient, ApiKey);
                data = await service.GetDailyDataAsync(SymbolInput);
            }
            else
            {
                // Demo mode with simulated data
                await Task.Delay(500); // Simulate API latency
                data = StockDataService.GenerateSampleData(SymbolInput);
                StatusMessage = $"Using simulated data for {SymbolInput} (set API key for live data)";
            }

            if (data.Quotes.Count < 121)
            {
                StatusMessage = $"Insufficient data for {SymbolInput} (need 121+ trading days)";
                IsLoading = false;
                return;
            }

            // Generate signal
            var signal = _scoringEngine.GenerateSignal(SymbolInput, data.Quotes, RiskParameters);
            CurrentSignal = signal;

            // Risk assessment
            CurrentRisk = _riskManager.Evaluate(signal, RiskParameters);

            // Update chart data
            UpdateChartData(data.Quotes);

            // Add to signal history
            Signals.Insert(0, signal);
            if (Signals.Count > 50) Signals.RemoveAt(Signals.Count - 1);

            StatusMessage = $"{SymbolInput}: Score {signal.ModelScore:P1} — {signal.Signal} | " +
                           $"SL: ${signal.StopLoss:F2} | TP: ${signal.TakeProfit:F2}";
        }
        catch (HttpRequestException ex)
        {
            StatusMessage = $"API Error: {ex.Message}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Error: {ex.Message}";
        }
        finally
        {
            IsLoading = false;
        }
    }

    private void UpdateChartData(List<StockQuote> quotes)
    {
        ChartPrices.Clear();
        ChartDates.Clear();

        var recent = quotes.Skip(Math.Max(0, quotes.Count - 90)).ToList();
        foreach (var q in recent)
        {
            ChartPrices.Add(q.Close);
            ChartDates.Add(q.Timestamp.ToString("MM/dd"));
        }
    }

    private void AddToWatchlist()
    {
        if (CurrentSignal != null && !WatchlistSymbols.Contains(CurrentSignal.Symbol))
        {
            WatchlistSymbols.Add(CurrentSignal.Symbol);
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
