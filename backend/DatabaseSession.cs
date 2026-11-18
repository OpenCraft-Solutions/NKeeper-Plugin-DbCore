using System.Data;
using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using NKeeper.Abstractions;

namespace NKeeper.Plugins.Databases;

/// <summary>
/// The stream session handler of an engine's database session type (docs/architecture.md §7.32): the engine plugin
/// contributes <c>new SessionType(id, label, typeof(DatabaseSessionHandler&lt;TEngine&gt;))</c> and registers it with
/// <see cref="DatabaseServiceCollectionExtensions.AddDatabaseEngine{TEngine}"/>.
/// </summary>
public sealed class DatabaseSessionHandler<TEngine>(TEngine engine, IPluginAudit audit, TimeProvider time) : IStreamSessionHandler
    where TEngine : class, IDatabaseEngine
{
    public async Task<IStreamSession> OpenAsync(StreamSessionRequest request, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.Credential is null)
        {
            throw new ConnectException(ConnectFailure.NoSecret, $"Choose a credential, or type one, to sign in to {engine.Product}.");
        }

        var login = await engine.OpenAsync(request, cancellationToken);
        try
        {
            var server = await engine.Dialect.ServerInfoAsync(login.Connection, cancellationToken);
            return new DatabaseSession(engine, login, server, audit, time, request.Host.Id);
        }
        catch (Exception ex) when (engine.Dialect.IsServerError(ex))
        {
            await login.DisposeAsync();
            throw new ConnectException(ConnectFailure.AuthenticationFailed, $"{engine.Product} signed the login in, but wouldn't say what it is: {ex.Message}");
        }
        catch
        {
            await login.DisposeAsync();
            throw;
        }
    }
}

/// <summary>
/// A database tab, like a small SSMS (ported from 1.x's <c>DatabaseController</c>), on one login core opened:
/// <list type="bullet">
/// <item>query windows, each on a connection of its own (its own session on the server, current database, temporary
/// tables and transactions, as in SSMS): <c>window.open</c>, <c>window.close</c>, <c>query</c>, <c>cancel</c>, <c>use</c>;</item>
/// <item>the explorer and tools on one more connection, so they work while a query runs: <c>databases</c>,
/// <c>explore</c>, <c>script</c>, <c>blocking</c>, <c>kill</c>.</item>
/// </list>
/// Queries and tools run beside the requests, so a query can be cancelled while it runs.
/// </summary>
internal sealed class DatabaseSession : ToolSession
{
    /// <summary>Query windows a tab may have open at once.</summary>
    public const int MaxWindows = 20;

    /// <summary>The longest script a window may run.</summary>
    public const int MaxScriptLength = 1_000_000;

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    private readonly IDatabaseEngine _engine;
    private readonly IDatabaseLogin _login;
    private readonly DatabaseServerInfo _server;
    private readonly IPluginAudit _audit;
    private readonly TimeProvider _time;
    private readonly Guid _hostId;
    private readonly Dictionary<string, QueryWindow> _windows = new(StringComparer.Ordinal);
    private readonly SemaphoreSlim _tool = new(1, 1);
    private DbConnection _toolConnection;
    private int _nextWindow;

    public DatabaseSession(IDatabaseEngine engine, IDatabaseLogin login, DatabaseServerInfo server, IPluginAudit audit, TimeProvider time, Guid hostId)
    {
        _engine = engine;
        _login = login;
        _server = server;
        _audit = audit;
        _time = time;
        _hostId = hostId;
        _toolConnection = login.Connection;
    }

    private IDatabaseDialect Dialect => _engine.Dialect;

    /// <summary>The login and server, for messages and the audit trail: <c>sa@SQL01</c>.</summary>
    private string Display => $"{_server.Login}@{_server.ServerName}";

    protected override async Task HandleAsync(ToolRequest request, CancellationToken cancellationToken)
    {
        switch (request.Type)
        {
            case "info":
                await ReplyAsync(request.Id, new { server = _server, product = _engine.Product }, cancellationToken);
                break;

            case "window.open":
                Background(request.Id, () => OpenWindowAsync(request, cancellationToken), cancellationToken);
                break;

            case "window.close":
                {
                    var window = Take(request.RequiredText("window", 32));
                    if (window is not null)
                    {
                        await window.DisposeAsync();
                    }

                    await ReplyAsync(request.Id, null, cancellationToken);
                    break;
                }

            case "query":
                {
                    var window = Window(request);
                    var sql = request.Text("sql", MaxScriptLength) ?? string.Empty;
                    var lineOffset = request.Number("lineOffset") is { } offset and >= 0 and <= MaxScriptLength ? (int)offset : 0;
                    var lease = window.TryBegin(cancellationToken) ?? throw new ToolException("A query is already running in this window. Wait for it, or cancel it.");
                    Background(request.Id, () => QueryAsync(request.Id, window, lease, sql, lineOffset, cancellationToken), cancellationToken);
                    break;
                }

            case "cancel":
                Window(request).Cancel();
                await ReplyAsync(request.Id, null, cancellationToken);
                break;

            case "use":
                {
                    var window = Window(request);
                    var name = request.RequiredText("name", 128);
                    var lease = window.TryBegin(cancellationToken) ?? throw new ToolException("A query is running in this window. Change the database when it's done.");
                    Background(request.Id, () => UseAsync(request.Id, window, lease, name), cancellationToken);
                    break;
                }

            case "databases":
                Tool(request.Id, connection => Dialect.DatabasesAsync(connection, cancellationToken), cancellationToken);
                break;

            case "explore":
                {
                    var node = Node(request);
                    Tool(request.Id, connection => Dialect.ChildrenAsync(connection, node, cancellationToken), cancellationToken);
                    break;
                }

            case "script":
                {
                    var node = Node(request);
                    var action = request.RequiredText("action", 32);
                    if (!ScriptActions.IsKnown(action))
                    {
                        throw new ToolException($"“{action}” isn't a script the explorer offers.");
                    }

                    Tool(request.Id, async connection => new { sql = await Dialect.ScriptAsync(connection, node, action, cancellationToken) }, cancellationToken);
                    break;
                }

            case "blocking":
                Tool(request.Id, connection => Dialect.BlockingAsync(connection, _time.GetUtcNow(), cancellationToken), cancellationToken);
                break;

            case "kill":
                {
                    var sessionId = request.Number("sessionId") is { } id and >= 1 and <= int.MaxValue ? (int)id : throw new ToolException("Choose a session.");
                    var serial = request.Number("serial") is { } s ? s is >= 0 and <= int.MaxValue ? (int)s : throw new ToolException("That isn't a serial number.") : (int?)null;
                    Tool(
                        request.Id,
                        async connection =>
                        {
                            await Dialect.KillAsync(connection, sessionId, serial, cancellationToken);
                            var what = serial is { } n ? $"{sessionId.ToString(CultureInfo.InvariantCulture)},{n.ToString(CultureInfo.InvariantCulture)}" : sessionId.ToString(CultureInfo.InvariantCulture);
                            await _audit.RecordAsync($"{_engine.PluginId}.kill", _hostId, $"KILL {what} · {Display}", CancellationToken.None);
                            return (object?)null;
                        },
                        cancellationToken);
                    break;
                }

            default:
                throw new ToolException($"The database session doesn't know “{request.Type}”.");
        }
    }

    private async Task OpenWindowAsync(ToolRequest request, CancellationToken cancellationToken)
    {
        var database = request.Text("database", 128);
        lock (_windows)
        {
            if (_windows.Count >= MaxWindows)
            {
                throw new ToolException($"This tab already has {MaxWindows} query windows open. Close one and try again.");
            }
        }

        DbConnection connection;
        try
        {
            connection = await _login.OpenAnotherAsync(cancellationToken);
        }
        catch (ConnectException ex)
        {
            throw new ToolException($"Couldn't open a connection for the window: {ex.Message}");
        }

        try
        {
            var info = await Dialect.ServerInfoAsync(connection, cancellationToken);
            string? warning = null;
            if (database is { Length: > 0 })
            {
                try
                {
                    await Dialect.ChangeDatabaseAsync(connection, database, cancellationToken);
                }
                catch (Exception ex) when (Dialect.IsServerError(ex))
                {
                    // The window still opens, in the login's own database.
                    warning = ex.Message;
                }
            }

            var current = await Dialect.CurrentDatabaseAsync(connection, cancellationToken);
            string id;
            lock (_windows)
            {
                if (_windows.Count >= MaxWindows)
                {
                    throw new ToolException($"This tab already has {MaxWindows} query windows open. Close one and try again.");
                }

                _nextWindow++;
                id = $"w{_nextWindow.ToString(CultureInfo.InvariantCulture)}";
                _windows[id] = new QueryWindow(connection);
            }

            await ReplyAsync(request.Id, new { window = id, sessionId = info.SessionId, login = info.Login, database = current, warning }, cancellationToken);
        }
        catch (Exception ex) when (Dialect.IsServerError(ex))
        {
            await connection.DisposeAsync();
            throw new ToolException(ex.Message);
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }

    private async Task QueryAsync(string id, QueryWindow window, QueryWindow.Lease lease, string sql, int lineOffset, CancellationToken cancellationToken)
    {
        SqlQueryResult result;
        using (lease)
        {
            try
            {
                result = await Dialect.RunAsync(window.Connection, sql, lineOffset, lease.Token);
            }
            catch (Exception ex) when (Dialect.IsServerError(ex))
            {
                // The runner reports the server's errors itself; one that escapes it means the connection is unusable.
                result = new SqlQueryResult([new SqlOutput("error", ex.Message)], string.Empty, 0, false, window.Connection.State != ConnectionState.Open, true);
            }
        }

        if (result.ConnectionLost)
        {
            // The window's connection broke: it's dropped, and the window opens another when it runs again.
            if (Take(window) is { } lost)
            {
                await lost.DisposeAsync();
            }
        }

        await ReplyAsync(id, result, cancellationToken);
    }

    private async Task UseAsync(string id, QueryWindow window, QueryWindow.Lease lease, string name)
    {
        using (lease)
        {
            try
            {
                await ReplyAsync(id, new { name = await Dialect.ChangeDatabaseAsync(window.Connection, name, lease.Token) }, lease.Token);
            }
            catch (Exception ex) when (Dialect.IsServerError(ex))
            {
                throw new ToolException(ex.Message);
            }
        }
    }

    /// <summary>
    /// Runs work on the tool connection, one at a time, beside the requests. A tool connection that broke is opened
    /// again first, once; the server's errors answer the request.
    /// </summary>
    private void Tool<T>(string id, Func<DbConnection, Task<T>> work, CancellationToken cancellationToken) =>
        Background(
            id,
            async () =>
            {
                await _tool.WaitAsync(cancellationToken);
                try
                {
                    if (_toolConnection.State != ConnectionState.Open)
                    {
                        try
                        {
                            _toolConnection = await _login.OpenAnotherAsync(cancellationToken);
                        }
                        catch (ConnectException ex)
                        {
                            throw new ConnectionLostException($"The connection to {_engine.Product} was lost, and couldn't be opened again: {ex.Message}");
                        }
                    }

                    T data;
                    try
                    {
                        data = await work(_toolConnection);
                    }
                    catch (DatabaseToolException ex)
                    {
                        throw new ToolException(ex.Message);
                    }
                    catch (Exception ex) when (Dialect.IsServerError(ex))
                    {
                        throw new ToolException(ex.Message);
                    }

                    await ReplyAsync(id, data, cancellationToken);
                }
                finally
                {
                    _tool.Release();
                }
            },
            cancellationToken);

    private QueryWindow Window(ToolRequest request)
    {
        var id = request.RequiredText("window", 32);
        lock (_windows)
        {
            return _windows.TryGetValue(id, out var window) ? window : throw new ToolException("That query window's connection has closed. Run the query again to reconnect.");
        }
    }

    private QueryWindow? Take(string id)
    {
        lock (_windows)
        {
            return _windows.Remove(id, out var window) ? window : null;
        }
    }

    private QueryWindow? Take(QueryWindow window)
    {
        lock (_windows)
        {
            var id = _windows.FirstOrDefault(w => ReferenceEquals(w.Value, window)).Key;
            return id is not null && _windows.Remove(id) ? window : null;
        }
    }

    private static SqlObjectNode Node(ToolRequest request)
    {
        if (!request.Body.TryGetProperty("node", out var value) || value.ValueKind != JsonValueKind.Object)
        {
            throw new ToolException("“node” is required.");
        }

        SqlObjectNode? node;
        try
        {
            node = value.Deserialize<SqlObjectNode>(Json);
        }
        catch (JsonException)
        {
            throw new ToolException("That isn't a node of the explorer.");
        }

        if (node is null
            || node.Kind is not { Length: > 0 and <= 32 }
            || node.Label.Length > 256
            || node.Detail?.Length > 256
            || node.Database?.Length > 128
            || node.Schema?.Length > 128
            || node.Name?.Length > 256
            || node.Tool?.Length > 32
            || node.Scripts.Count > 8)
        {
            throw new ToolException("That isn't a node of the explorer.");
        }

        return node;
    }

    protected override async Task EndAsync()
    {
        List<QueryWindow> windows;
        lock (_windows)
        {
            windows = [.. _windows.Values];
            _windows.Clear();
        }

        foreach (var window in windows)
        {
            window.Cancel();
        }

        await Task.CompletedTask;
    }

    public override async ValueTask DisposeAsync()
    {
        // The login closes every connection it opened: the windows', the tools', and the first.
        await _login.DisposeAsync();
        _tool.Dispose();
    }

    /// <summary>A query window's connection, which runs one thing at a time.</summary>
    internal sealed class QueryWindow(DbConnection connection) : IAsyncDisposable
    {
        private readonly SemaphoreSlim _busy = new(1, 1);
        private CancellationTokenSource? _running;

        public DbConnection Connection { get; } = connection;

        /// <summary>Claims the connection, with a token that <see cref="Cancel"/> trips; null when it's busy.</summary>
        public Lease? TryBegin(CancellationToken sessionEnding)
        {
            if (!_busy.Wait(0, CancellationToken.None))
            {
                return null;
            }

            var cancel = CancellationTokenSource.CreateLinkedTokenSource(sessionEnding);
            Volatile.Write(ref _running, cancel);
            return new Lease(this, cancel);
        }

        public void Cancel()
        {
            try
            {
                Volatile.Read(ref _running)?.Cancel();
            }
            catch (ObjectDisposedException)
            {
                // It finished meanwhile.
            }
        }

        public async ValueTask DisposeAsync()
        {
            Cancel();
            await Connection.DisposeAsync();
        }

        internal sealed class Lease(QueryWindow window, CancellationTokenSource cancel) : IDisposable
        {
            public CancellationToken Token => cancel.Token;

            public void Dispose()
            {
                Volatile.Write(ref window._running, null);
                cancel.Dispose();
                window._busy.Release();
            }
        }
    }
}
