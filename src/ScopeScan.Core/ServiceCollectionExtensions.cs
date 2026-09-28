using Microsoft.Extensions.DependencyInjection;
using ScopeScan.Core.Scope;
using ScopeScan.Core.Storage;

namespace ScopeScan.Core;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddScopeScanCore(this IServiceCollection services, string dataRoot)
    {
        services.AddSingleton(TimeProvider.System);
        services.AddSingleton<IStorageService>(_ => new FileStorageService(dataRoot));
        services.AddSingleton<IScopeRepository, FileScopeRepository>();
        services.AddSingleton<IScanRepository, FileScanRepository>();
        services.AddSingleton<IScopeGate, ScopeGate>();
        return services;
    }
}
