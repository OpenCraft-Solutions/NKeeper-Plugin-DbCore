using System.Data;
using System.Data.Common;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Microsoft.Data.Sqlite;
using NKeeper.Abstractions;

namespace NKeeper.Plugins.Databases.Tests;

/// <summary>An engine on an in-memory SQLite database, as an engine plugin's would be on its server.</summary>
internal sealed class SqliteEngine : IDatabaseEngine, IAsyncDisposable
{
    private readonly SqliteConnection _anchor;

    public SqliteEngine()
    {
        ConnectionString = $"Data Source=file:db{Guid.NewGuid():N}?mode=memory&cache=shared";
        _anchor = new SqliteConnection(ConnectionString);
        _anchor.Open();
    }

    public string ConnectionString { get; }

    public string PluginId => "sqlite";

    public string Product => "SQLite";

    public IDatabaseDialect Dialect { get; } = new SqliteDialect();

    /// <summary>Connections the login opened.</summary>
    public List<SqliteConnection> Opened { get; } = [];

    public Task<IDatabaseLogin> OpenAsync(StreamSessionRequest request, CancellationToken cancellationToken) =>
        Task.FromResult<IDatabaseLogin>(new Login(this));

    public async Task<IDatabaseLogin> OpenLoginAsync() => await OpenAsync(null!, CancellationToken.None);

    public async ValueTask DisposeAsync() => await _anchor.DisposeAsync();

    private sealed class Login : IDatabaseLogin
    {
        private readonly SqliteEngine _engine;

        public Login(SqliteEngine engine)
        {
            _engine = engine;
            Connection = Open();
        }

        public DbConnection Connection { get; }

        public bool Disposed { get; private set; }

        public Task<DbConnection> OpenAnotherAsync(CancellationToken cancellationToken = default) => Task.FromResult<DbConnection>(Open());

        private SqliteConnection Open()
        {
            var connection = new SqliteConnection(_engine.ConnectionString);
            connection.Open();
            lock (_engine.Opened)
            {
                _engine.Opened.Add(connection);
            }

            return connection;
        }

        public async ValueTask DisposeAsync()
        {
            Disposed = true;
            List<SqliteConnection> opened;
            lock (_engine.Opened)
            {
                opened = [.. _engine.Opened];
            }

            foreach (var connection in opened)
            {
                await connection.DisposeAsync();
            }
        }
    }
}

/// <summary>
/// SQLite as a dialect: scripts run statement by statement, the explorer lists tables and their columns, and the
/// blocking manager reports what the test sets. <c>WAIT</c> runs until cancelled; <c>BREAK</c> closes the connection.
/// </summary>
internal sealed class SqliteDialect : IDatabaseDialect
{
    public BlockingReport Blocking { get; set; } = new([], 0, true, DateTimeOffset.UnixEpoch);

    public List<(int SessionId, int? Serial)> Killed { get; } = [];

    public IReadOnlyList<DatabaseReportInfo> Reports => [new("tables", "Tables", "What the database holds")];

    /// <summary>A report as an engine writes one: a section that reads, one the server refuses, and a warning from what it read.</summary>
    public async Task<ToolReport> ReportAsync(DbConnection connection, string name, DateTimeOffset now, CancellationToken cancellationToken)
    {
        static async Task<SqlOutput> Read(DbDataReader reader, CancellationToken ct)
        {
            var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new SqlColumn(reader.GetName(i), reader.GetDataTypeName(i), false)).ToList();
            var rows = new List<string?[]>();
            while (await reader.ReadAsync(ct))
            {
                rows.Add([.. Enumerable.Range(0, reader.FieldCount).Select(i => reader.IsDBNull(i) ? null : Convert.ToString(reader.GetValue(i), System.Globalization.CultureInfo.InvariantCulture))]);
            }

            return new SqlOutput("results", Columns: columns, Rows: rows, RowCount: rows.Count);
        }

        var good = await ToolReports.SectionAsync(connection, "Answer", "select", "SELECT 42 AS \"Value\"", Read, e => e is DbException, cancellationToken, scripts: [new ToolScript("Again", "SELECT 42")]);
        var bad = await ToolReports.SectionAsync(connection, "Missing", "nowhere", "SELECT * FROM nowhere", Read, e => e is DbException, cancellationToken);
        var warnings = ToolReports.Rows(good).Select(r => ToolReports.Number(r.Columns, r.Row, "value")).Where(v => v > 40).Select(v => $"The answer is {v}.").ToList();
        return new ToolReport(warnings, [good, bad], now);
    }

    /// <summary>Connections readied for a query window.</summary>
    public int Prepared { get; private set; }

    public Task PrepareWindowAsync(DbConnection connection, CancellationToken cancellationToken)
    {
        Prepared++;
        return Task.CompletedTask;
    }

    public Task<DatabaseServerInfo> ServerInfoAsync(DbConnection connection, CancellationToken cancellationToken) =>
        Task.FromResult(new DatabaseServerInfo("memory", connection.ServerVersion, null, null, "tester", connection.GetHashCode() & 0x7fff));

    public async Task<SqlQueryResult> RunAsync(DbConnection connection, string script, int lineOffset, CancellationToken cancellationToken)
    {
        var watch = Stopwatch.StartNew();
        if (script.Trim() == "WAIT")
        {
            try
            {
                await Task.Delay(Timeout.Infinite, cancellationToken);
            }
            catch (OperationCanceledException)
            {
                return new SqlQueryResult([new SqlOutput("error", "Query was cancelled by user.")], "main", watch.ElapsedMilliseconds, true, false, false);
            }
        }

        if (script.Trim() == "BREAK")
        {
            await connection.CloseAsync();
            return new SqlQueryResult([new SqlOutput("error", "The connection broke.")], string.Empty, watch.ElapsedMilliseconds, false, true, true);
        }

        var output = new List<SqlOutput>();
        var hasErrors = false;
        var line = 1;
        foreach (var statement in script.Split(';', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                await using var command = connection.CreateCommand();
                command.CommandText = statement;
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                if (reader.FieldCount > 0)
                {
                    var columns = Enumerable.Range(0, reader.FieldCount).Select(i => new SqlColumn(reader.GetName(i), reader.GetDataTypeName(i), false)).ToList();
                    var rows = new List<string?[]>();
                    while (await reader.ReadAsync(cancellationToken))
                    {
                        rows.Add([.. Enumerable.Range(0, reader.FieldCount).Select(i => reader.IsDBNull(i) ? null : DbValueText.Format(reader.GetValue(i)))]);
                    }

                    output.Add(new SqlOutput("results", Columns: columns, Rows: rows, RowCount: rows.Count));
                }
                else
                {
                    output.Add(new SqlOutput("rows", $"({reader.RecordsAffected} rows affected)", RowCount: reader.RecordsAffected));
                }
            }
            catch (SqliteException ex)
            {
                hasErrors = true;
                output.Add(new SqlOutput("error", ex.Message, Number: ex.SqliteErrorCode, Line: lineOffset + line));
            }

            line++;
        }

        return new SqlQueryResult(output, "main", watch.ElapsedMilliseconds, false, connection.State != ConnectionState.Open, hasErrors);
    }

    public Task<string> CurrentDatabaseAsync(DbConnection connection, CancellationToken cancellationToken) => Task.FromResult(connection.Database);

    public Task<IReadOnlyList<string>> DatabasesAsync(DbConnection connection, CancellationToken cancellationToken) =>
        DbQuery.ListAsync(connection, "SELECT name FROM pragma_database_list ORDER BY seq", [], r => r.GetString(0), cancellationToken);

    public async Task<string> ChangeDatabaseAsync(DbConnection connection, string name, CancellationToken cancellationToken)
    {
        if (name != "main")
        {
            throw new SqliteException($"no such database: {name}", 1);
        }

        await Task.CompletedTask;
        return name;
    }

    public async Task<IReadOnlyList<SqlObjectNode>> ChildrenAsync(DbConnection connection, SqlObjectNode node, CancellationToken cancellationToken) =>
        node.Kind switch
        {
            SqlObjectNode.Server => await DbQuery.ListAsync(
                connection,
                "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
                [],
                r => new SqlObjectNode { Kind = "table", Label = r.GetString(0), Name = r.GetString(0), Expandable = true, Scripts = [ScriptActions.SelectTop] },
                cancellationToken),
            "table" => await DbQuery.ListAsync(
                connection,
                "SELECT name, type FROM pragma_table_info(@table) ORDER BY cid",
                [("@table", node.Name)],
                r => new SqlObjectNode { Kind = "column", Label = r.GetString(0), Detail = r.GetString(1), Name = r.GetString(0) },
                cancellationToken),
            _ => throw new DatabaseToolException($"The explorer doesn't know “{node.Kind}”."),
        };

    public Task<string> ScriptAsync(DbConnection connection, SqlObjectNode node, string action, CancellationToken cancellationToken) =>
        action == ScriptActions.SelectTop && node.Kind == "table"
            ? Task.FromResult($"SELECT * FROM \"{node.Name!.Replace("\"", "\"\"", StringComparison.Ordinal)}\" LIMIT 1000;")
            : throw new DatabaseToolException("That can't be scripted.");

    public Task<BlockingReport> BlockingAsync(DbConnection connection, DateTimeOffset now, CancellationToken cancellationToken) =>
        Task.FromResult(Blocking with { AtUtc = now });

    public Task KillAsync(DbConnection connection, int sessionId, int? serial, CancellationToken cancellationToken)
    {
        if (sessionId == 999)
        {
            throw new SqliteException("no such session", 1);
        }

        Killed.Add((sessionId, serial));
        return Task.CompletedTask;
    }
}

internal sealed class FakeAudit : IPluginAudit
{
    public List<(string Action, Guid? HostId, string Detail)> Events { get; } = [];

    public Task RecordAsync(string action, Guid? hostId, string detail, CancellationToken cancellationToken = default)
    {
        lock (Events)
        {
            Events.Add((action, hostId, detail));
        }

        return Task.CompletedTask;
    }
}

/// <summary>The browser's end of a session, without a server: requests in, replies out.</summary>
internal sealed class FakeChannel : IStreamChannel
{
    private readonly Channel<StreamFrame?> _in = Channel.CreateUnbounded<StreamFrame?>();
    private readonly Channel<JsonElement> _out = Channel.CreateUnbounded<JsonElement>();
    private int _next;

    private static CancellationToken Token => TestContext.Current.CancellationToken;

    public async Task<StreamFrame?> ReceiveAsync(CancellationToken cancellationToken) => await _in.Reader.ReadAsync(cancellationToken);

    public Task SendAsync(ReadOnlyMemory<byte> data, CancellationToken cancellationToken) => Task.CompletedTask;

    public Task SendTextAsync(string json, CancellationToken cancellationToken)
    {
        _out.Writer.TryWrite(JsonDocument.Parse(json).RootElement.Clone());
        return Task.CompletedTask;
    }

    /// <summary>Sends a request, returning its ID.</summary>
    public string Send(string type, object? body = null)
    {
        var id = $"r{Interlocked.Increment(ref _next)}";
        var message = JsonSerializer.SerializeToNode(body ?? new { }, JsonSerializerOptions.Web)!.AsObject();
        message["type"] = type;
        message["id"] = id;
        _in.Writer.TryWrite(new StreamFrame(true, Encoding.UTF8.GetBytes(message.ToJsonString())));
        return id;
    }

    public void Close() => _in.Writer.TryWrite(null);

    /// <summary>The reply or error to a request, skipping others' (they come back in any order).</summary>
    public async Task<JsonElement> AnswerAsync(string id)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        var skipped = new List<JsonElement>();
        try
        {
            while (true)
            {
                var message = await _out.Reader.ReadAsync(timeout.Token);
                if (message.TryGetProperty("id", out var answered) && answered.GetString() == id)
                {
                    return message;
                }

                skipped.Add(message);
            }
        }
        finally
        {
            foreach (var message in skipped)
            {
                _out.Writer.TryWrite(message);
            }
        }
    }

    /// <summary>A request's reply data, failing on an error.</summary>
    public async Task<JsonElement> ReplyAsync(string type, object? body = null)
    {
        var answer = await AnswerAsync(Send(type, body));
        Assert.True(answer.GetProperty("type").GetString() == "reply", answer.ToString());
        return answer.GetProperty("data");
    }

    /// <summary>A request's error message, failing on a reply.</summary>
    public async Task<string> ErrorAsync(string type, object? body = null)
    {
        var answer = await AnswerAsync(Send(type, body));
        Assert.True(answer.GetProperty("type").GetString() == "error", answer.ToString());
        return answer.GetProperty("message").GetString()!;
    }
}
