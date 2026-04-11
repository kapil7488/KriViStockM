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
    private readonly BacktestEngine _backtestEngine = new();

    private string _symbolInput = "AAPL";
    private string _apiKey = "";
    private bool _isLoading;
    private string _statusMessage = "Ready — Enter a symbol and click Analyze";
    private StockSignal? _currentSignal;
    private RiskAssessment? _currentRisk;
    private RiskParameters _riskParameters = new();
    private TradingMode _selectedMode = TradingMode.Normal;
    private List<StockQuote> _currentQuotes = [];

    // Backtest state
    private StrategyId _selectedStrategy = StrategyId.SmaCross;
    private BacktestResult? _backtestResult;
    private ObservableCollection<BacktestResult> _compareResults = [];
    private bool _isBacktesting;

    public MainViewModel()
    {
        AnalyzeCommand = new RelayCommand(_ => _ = AnalyzeAsync(), _ => !IsLoading);
        AddToWatchlistCommand = new RelayCommand(_ => AddToWatchlist(), _ => CurrentSignal != null);
        RunBacktestCommand = new RelayCommand(_ => _ = RunBacktestAsync(), _ => _currentQuotes.Count > 121 && !IsBacktesting);
        CompareAllCommand = new RelayCommand(_ => _ = CompareAllAsync(), _ => _currentQuotes.Count > 121 && !IsBacktesting);
        Signals = new ObservableCollection<StockSignal>();
        WatchlistSymbols = new ObservableCollection<string> { "AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "NVDA", "META", "JPM" };
        ChartPrices = new ObservableCollection<decimal>();
        ChartDates = new ObservableCollection<string>();
        BacktestTrades = new ObservableCollection<BacktestTrade>();
        AvailableStrategies = new ObservableCollection<StrategyDef>(StrategyDef.All);
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
    public ICommand RunBacktestCommand { get; }
    public ICommand CompareAllCommand { get; }

    public ObservableCollection<StrategyDef> AvailableStrategies { get; }
    public ObservableCollection<BacktestTrade> BacktestTrades { get; }

    public StrategyId SelectedStrategy
    {
        get => _selectedStrategy;
        set { _selectedStrategy = value; OnPropertyChanged(); }
    }

    public BacktestResult? BacktestResult
    {
        get => _backtestResult;
        set { _backtestResult = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasBacktestResult)); }
    }

    public bool HasBacktestResult => _backtestResult != null;

    public ObservableCollection<BacktestResult> CompareResults
    {
        get => _compareResults;
        set { _compareResults = value; OnPropertyChanged(); OnPropertyChanged(nameof(HasCompareResults)); }
    }

    public bool HasCompareResults => _compareResults.Count > 0;

    public bool IsBacktesting
    {
        get => _isBacktesting;
        set { _isBacktesting = value; OnPropertyChanged(); }
    }

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
            _currentQuotes = data.Quotes;

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

    public async Task RunBacktestAsync()
    {
        if (_currentQuotes.Count < 121 || CurrentSignal == null) return;
        IsBacktesting = true;
        StatusMessage = $"Running {StrategyDef.All.First(s => s.Id == SelectedStrategy).Label} backtest on {CurrentSignal.Symbol}...";

        try
        {
            var config = new BacktestConfig
            {
                Strategy = SelectedStrategy,
                MaxHoldingDays = 20,
                InitialCapital = RiskParameters.PortfolioValue,
                RiskPerTradePct = 2.0,
                StopLossPct = (double)RiskParameters.StopLossPercent * 100,
                TakeProfitPct = (double)RiskParameters.TakeProfitPercent * 100,
                CommissionPct = 0.1,
            };

            var result = await Task.Run(() => _backtestEngine.Run(CurrentSignal.Symbol, _currentQuotes, config));
            BacktestResult = result;

            BacktestTrades.Clear();
            foreach (var t in result.Trades.Take(50))
                BacktestTrades.Add(t);

            CompareResults.Clear();
            OnPropertyChanged(nameof(HasCompareResults));

            StatusMessage = $"Backtest: {result.Strategy.Label} — {result.TotalTrades} trades, " +
                           $"Win {result.WinRate}%, Net {result.NetProfitPct:+0.0;-0.0}%, Sharpe {result.SharpeRatio:F2}";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Backtest error: {ex.Message}";
        }
        finally
        {
            IsBacktesting = false;
        }
    }

    public async Task CompareAllAsync()
    {
        if (_currentQuotes.Count < 121 || CurrentSignal == null) return;
        IsBacktesting = true;
        StatusMessage = "Comparing all strategies...";

        try
        {
            var config = new BacktestConfig
            {
                MaxHoldingDays = 20,
                InitialCapital = RiskParameters.PortfolioValue,
                RiskPerTradePct = 2.0,
                StopLossPct = (double)RiskParameters.StopLossPercent * 100,
                TakeProfitPct = (double)RiskParameters.TakeProfitPercent * 100,
                CommissionPct = 0.1,
            };

            var results = await Task.Run(() => _backtestEngine.CompareAll(CurrentSignal.Symbol, _currentQuotes, config));

            CompareResults.Clear();
            foreach (var r in results) CompareResults.Add(r);
            OnPropertyChanged(nameof(HasCompareResults));

            if (results.Count > 0)
            {
                BacktestResult = results[0]; // Show best result
                BacktestTrades.Clear();
                foreach (var t in results[0].Trades.Take(50)) BacktestTrades.Add(t);
            }

            StatusMessage = $"Compared {results.Count} strategies — Best: {results[0].Strategy.Label} ({results[0].NetProfitPct:+0.0;-0.0}%)";
        }
        catch (Exception ex)
        {
            StatusMessage = $"Compare error: {ex.Message}";
        }
        finally
        {
            IsBacktesting = false;
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
    protected void OnPropertyChanged([CallerMemberName] string? name = null)
        => PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
