using System.Globalization;
using System.Windows.Data;
using System.Windows.Media;
using StockM.Desktop.Models;

namespace StockM.Desktop.Converters;

public class ScoreToColorConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is double score)
        {
            return score switch
            {
                >= 0.65 => new SolidColorBrush(Color.FromRgb(34, 197, 94)),   // Green
                >= 0.55 => new SolidColorBrush(Color.FromRgb(132, 204, 22)),  // Lime
                >= 0.45 => new SolidColorBrush(Color.FromRgb(234, 179, 8)),   // Yellow
                >= 0.30 => new SolidColorBrush(Color.FromRgb(249, 115, 22)),  // Orange
                _ => new SolidColorBrush(Color.FromRgb(239, 68, 68))          // Red
            };
        }
        return new SolidColorBrush(Colors.Gray);
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}

public class SignalToColorConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
    {
        if (value is SignalType signal)
        {
            return signal switch
            {
                SignalType.StrongBuy => new SolidColorBrush(Color.FromRgb(34, 197, 94)),
                SignalType.Buy => new SolidColorBrush(Color.FromRgb(132, 204, 22)),
                SignalType.Hold => new SolidColorBrush(Color.FromRgb(234, 179, 8)),
                SignalType.Sell => new SolidColorBrush(Color.FromRgb(249, 115, 22)),
                SignalType.StrongSell => new SolidColorBrush(Color.FromRgb(239, 68, 68)),
                _ => new SolidColorBrush(Colors.Gray)
            };
        }
        return new SolidColorBrush(Colors.Gray);
    }

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}

public class BoolToVisibilityConverter : IValueConverter
{
    public object Convert(object value, Type targetType, object parameter, CultureInfo culture)
        => value is true ? System.Windows.Visibility.Visible : System.Windows.Visibility.Collapsed;

    public object ConvertBack(object value, Type targetType, object parameter, CultureInfo culture)
        => throw new NotImplementedException();
}
