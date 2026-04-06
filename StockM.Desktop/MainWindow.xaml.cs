using System.Windows;
using System.Windows.Media;
using System.Windows.Shapes;
using StockM.Desktop.ViewModels;

namespace StockM.Desktop;

public partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        if (DataContext is MainViewModel vm)
        {
            vm.PropertyChanged += (s, e) =>
            {
                if (e.PropertyName == nameof(vm.CurrentSignal))
                    DrawChart();
            };
        }
    }

    private void ChartCanvas_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        DrawChart();
    }

    private void DrawChart()
    {
        ChartCanvas.Children.Clear();

        if (DataContext is not MainViewModel vm || vm.ChartPrices.Count < 2)
            return;

        var width = ChartCanvas.ActualWidth;
        var height = ChartCanvas.ActualHeight;
        if (width <= 0 || height <= 0) return;

        var prices = vm.ChartPrices.ToList();
        var min = prices.Min();
        var max = prices.Max();
        var range = max - min;
        if (range == 0) range = 1;

        var padding = 10;
        var chartWidth = width - padding * 2;
        var chartHeight = height - padding * 2;

        // Draw grid lines
        for (int i = 0; i <= 4; i++)
        {
            var y = padding + chartHeight * i / 4;
            var gridLine = new Line
            {
                X1 = padding, Y1 = y,
                X2 = width - padding, Y2 = y,
                Stroke = new SolidColorBrush(Color.FromArgb(30, 255, 255, 255)),
                StrokeThickness = 1
            };
            ChartCanvas.Children.Add(gridLine);

            var priceLabel = max - (range * i / 4);
            var label = new System.Windows.Controls.TextBlock
            {
                Text = $"${priceLabel:F0}",
                Foreground = new SolidColorBrush(Color.FromRgb(148, 163, 184)),
                FontSize = 10
            };
            System.Windows.Controls.Canvas.SetLeft(label, padding + 4);
            System.Windows.Controls.Canvas.SetTop(label, y - 14);
            ChartCanvas.Children.Add(label);
        }

        // Draw price line
        var polyline = new Polyline
        {
            Stroke = new SolidColorBrush(Color.FromRgb(59, 130, 246)),
            StrokeThickness = 2,
            StrokeLineJoin = PenLineJoin.Round
        };

        // Draw area fill
        var polygon = new Polygon
        {
            Fill = new LinearGradientBrush(
                Color.FromArgb(60, 59, 130, 246),
                Color.FromArgb(5, 59, 130, 246),
                90),
            StrokeThickness = 0
        };

        for (int i = 0; i < prices.Count; i++)
        {
            var x = padding + chartWidth * i / (prices.Count - 1);
            var y = padding + chartHeight * (double)(1 - (prices[i] - min) / range);
            polyline.Points.Add(new Point(x, y));
            polygon.Points.Add(new Point(x, y));
        }

        // Close polygon for fill
        polygon.Points.Add(new Point(padding + chartWidth, padding + chartHeight));
        polygon.Points.Add(new Point(padding, padding + chartHeight));

        ChartCanvas.Children.Add(polygon);
        ChartCanvas.Children.Add(polyline);

        // Draw SL and TP lines if signal exists
        if (vm.CurrentSignal != null)
        {
            DrawHorizontalLine(vm.CurrentSignal.StopLoss, min, range, chartHeight, chartWidth, padding,
                Color.FromRgb(239, 68, 68), "SL");
            DrawHorizontalLine(vm.CurrentSignal.TakeProfit, min, range, chartHeight, chartWidth, padding,
                Color.FromRgb(34, 197, 94), "TP");
            DrawHorizontalLine(vm.CurrentSignal.EntryPrice, min, range, chartHeight, chartWidth, padding,
                Color.FromRgb(234, 179, 8), "Entry");
        }
    }

    private void DrawHorizontalLine(decimal price, decimal min, decimal range, double chartHeight,
        double chartWidth, double padding, Color color, string label)
    {
        if (range == 0) return;
        var y = padding + chartHeight * (double)(1 - (price - min) / range);

        if (y < padding || y > padding + chartHeight) return;

        var line = new Line
        {
            X1 = padding, Y1 = y,
            X2 = padding + chartWidth, Y2 = y,
            Stroke = new SolidColorBrush(color),
            StrokeThickness = 1,
            StrokeDashArray = new DoubleCollection { 6, 3 }
        };
        ChartCanvas.Children.Add(line);

        var text = new System.Windows.Controls.TextBlock
        {
            Text = $"{label}: ${price:F2}",
            Foreground = new SolidColorBrush(color),
            FontSize = 11,
            FontWeight = FontWeights.SemiBold
        };
        System.Windows.Controls.Canvas.SetRight(text, padding + 4);
        System.Windows.Controls.Canvas.SetTop(text, y - 16);
        ChartCanvas.Children.Add(text);
    }
}
