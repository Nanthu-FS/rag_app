using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using ScopeScan.Scanner.Checks;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddScopeScanScanner(this IServiceCollection services, Action<ScannerOptions>? configure = null)
    {
        var options = new ScannerOptions();
        configure?.Invoke(options);
        services.AddSingleton(options);
        services.TryAddSingleton(TimeProvider.System);
        services.TryAddSingleton<IDnsResolver, SystemDnsResolver>();
        services.TryAddSingleton<ITlsHandshaker, SocketTlsHandshaker>();
        services.AddSingleton<HostRateLimiter>(sp => new HostRateLimiter(options, sp.GetRequiredService<TimeProvider>()));
        services.AddSingleton<HostScanGuard>();
        services.AddSingleton<IScanHttpClientFactory, ScanHttpClientFactory>();

        services.AddSingleton<IScanCheck, SecurityHeadersCheck>();
        services.AddSingleton<IScanCheck, InformationLeakHeadersCheck>();
        services.AddSingleton<IScanCheck, CookieFlagsCheck>();
        services.AddSingleton<IScanCheck, CorsCheck>();
        services.AddSingleton<IScanCheck>(sp => new TlsCheck(sp.GetRequiredService<TimeProvider>()));
        services.AddSingleton(_ => JsVulnerabilityDatabase.LoadEmbedded());
        services.AddSingleton<IScanCheck, ExposedFilesCheck>();
        services.AddSingleton<IScanCheck, JsLibraryCheck>();
        services.AddSingleton<IScanCheck, ReflectedParameterCheck>();
        services.AddSingleton<IScanCheck, OpenRedirectCheck>();
        services.AddSingleton<IScanCheck, FingerprintCheck>();
        return services;
    }
}
