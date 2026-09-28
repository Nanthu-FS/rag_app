using Microsoft.Extensions.DependencyInjection;

namespace ScopeScan.Screenshots;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddScopeScanScreenshots(this IServiceCollection services, Action<ScreenshotOptions>? configure = null)
    {
        var options = new ScreenshotOptions();
        configure?.Invoke(options);
        services.AddSingleton(options);
        services.AddSingleton<IScreenshotService, PlaywrightScreenshotService>();
        services.AddSingleton<EvidenceCapture>();
        return services;
    }
}
