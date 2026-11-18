using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using NKeeper.Abstractions;

namespace NKeeper.Plugins.Databases;

/// <summary>
/// The db-core plugin (docs/architecture.md §7.32): what the database engine plugins share. It contributes nothing of
/// its own: each engine contributes its service and session types, and uses this assembly, which db-core exports, for
/// the session; its frontend exports the views.
/// </summary>
public sealed class DbCorePlugin : IPlugin
{
    public void ConfigureServices(IServiceCollection services, PluginContext context)
    {
    }

    public void MapEndpoints(IEndpointRouteBuilder endpoints, PluginContext context)
    {
    }
}

/// <summary>How an engine plugin registers itself, from its <see cref="IPlugin.ConfigureServices"/>.</summary>
public static class DatabaseServiceCollectionExtensions
{
    /// <summary>The engine, and the handler of its database session type, <see cref="DatabaseSessionHandler{TEngine}"/>.</summary>
    public static IServiceCollection AddDatabaseEngine<TEngine>(this IServiceCollection services)
        where TEngine : class, IDatabaseEngine
    {
        services.TryAddScoped<TEngine>();
        services.TryAddSingleton(TimeProvider.System);
        services.AddScoped<DatabaseSessionHandler<TEngine>>();
        return services;
    }
}
