using System.Text.Json;
using NKeeper.Abstractions;

namespace NKeeper.Plugins.Databases.Tests;

/// <summary>The database session (docs/architecture.md §7.32), on an in-memory SQLite engine.</summary>
public sealed class DatabaseSessionTests : IAsyncLifetime
{
    private static readonly Guid HostId = Guid.NewGuid();

    private readonly SqliteEngine _engine = new();
    private readonly FakeAudit _audit = new();
    private readonly FakeChannel _channel = new();
    private IDatabaseLogin? _login;
    private DatabaseSession? _session;
    private Task? _running;

    private SqliteDialect Dialect => (SqliteDialect)_engine.Dialect;

    public async ValueTask InitializeAsync()
    {
        _login = await _engine.OpenLoginAsync();
        _session = new DatabaseSession(_engine, _login, await _engine.Dialect.ServerInfoAsync(_login.Connection, default), _audit, TimeProvider.System, HostId);
        _running = _session.RunAsync(_channel, TestContext.Current.CancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        _channel.Close();
        await _running!;
        await _session!.DisposeAsync();
        await _engine.DisposeAsync();
    }

    [Fact]
    public async Task A_window_runs_scripts_on_its_own_connection_and_keeps_its_state()
    {
        var info = await _channel.ReplyAsync("info");
        Assert.Equal(("SQLite", "tester"), (info.GetProperty("product").GetString(), info.GetProperty("server").GetProperty("login").GetString()));

        var window = await OpenWindowAsync();
        var created = await _channel.ReplyAsync("query", new { window, sql = "CREATE TEMP TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2)" });
        Assert.False(created.GetProperty("hasErrors").GetBoolean());

        // The temporary table is the window's own: its connection's, not another window's.
        var result = await _channel.ReplyAsync("query", new { window, sql = "SELECT n FROM t ORDER BY n" });
        var set = result.GetProperty("output")[0];
        Assert.Equal("results", set.GetProperty("kind").GetString());
        Assert.Equal(["1", "2"], set.GetProperty("rows").EnumerateArray().Select(r => r[0].GetString()!));

        var other = await OpenWindowAsync();
        var missing = await _channel.ReplyAsync("query", new { window = other, sql = "SELECT n FROM t", lineOffset = 4 });
        Assert.True(missing.GetProperty("hasErrors").GetBoolean());
        Assert.Equal(5, missing.GetProperty("output")[0].GetProperty("line").GetInt32());
    }

    [Fact]
    public async Task A_running_query_can_be_cancelled_and_a_second_one_waits_its_turn()
    {
        var window = await OpenWindowAsync();
        var waiting = _channel.Send("query", new { window, sql = "WAIT" });

        Assert.Contains("already running", await ErrorUntilAsync("query", new { window, sql = "SELECT 1" }), StringComparison.Ordinal);
        await _channel.ReplyAsync("cancel", new { window });

        var answer = await _channel.AnswerAsync(waiting);
        Assert.True(answer.GetProperty("data").GetProperty("cancelled").GetBoolean());
        Assert.Equal("1", (await _channel.ReplyAsync("query", new { window, sql = "SELECT 1" })).GetProperty("output")[0].GetProperty("rows")[0][0].GetString());
    }

    [Fact]
    public async Task A_window_whose_connection_broke_is_closed_and_the_tools_go_on()
    {
        var window = await OpenWindowAsync();
        var broken = await _channel.ReplyAsync("query", new { window, sql = "BREAK" });
        Assert.True(broken.GetProperty("connectionLost").GetBoolean());

        Assert.Contains("closed", await _channel.ErrorAsync("query", new { window, sql = "SELECT 1" }), StringComparison.Ordinal);
        Assert.Equal(1, (await _channel.ReplyAsync("databases")).GetArrayLength());
        Assert.NotEqual(window, await OpenWindowAsync());
    }

    [Fact]
    public async Task The_tool_connection_is_opened_again_when_it_broke()
    {
        await _login!.Connection.CloseAsync();

        var tables = await _channel.ReplyAsync("explore", new { node = new { kind = SqlObjectNode.Server } });

        Assert.Equal(0, tables.GetArrayLength());
    }

    [Fact]
    public async Task The_explorer_lists_and_scripts_objects_and_refuses_what_it_doesnt_know()
    {
        var window = await OpenWindowAsync();
        await _channel.ReplyAsync("query", new { window, sql = "CREATE TABLE people (name TEXT, age INTEGER)" });

        var table = Assert.Single((await _channel.ReplyAsync("explore", new { node = new { kind = SqlObjectNode.Server } })).EnumerateArray());
        Assert.Equal(("people", "selectTop"), (table.GetProperty("label").GetString(), table.GetProperty("scripts")[0].GetString()));
        var columns = await _channel.ReplyAsync("explore", new { node = table });
        Assert.Equal(["name", "age"], columns.EnumerateArray().Select(c => c.GetProperty("label").GetString()!));

        Assert.Equal("SELECT * FROM \"people\" LIMIT 1000;", (await _channel.ReplyAsync("script", new { node = table, action = "selectTop" })).GetProperty("sql").GetString());
        Assert.Contains("isn't a script", await _channel.ErrorAsync("script", new { node = table, action = "drop" }), StringComparison.Ordinal);
        Assert.Contains("doesn't know", await _channel.ErrorAsync("explore", new { node = new { kind = "galaxy" } }), StringComparison.Ordinal);
        Assert.Contains("isn't a node", await _channel.ErrorAsync("explore", new { node = new { kind = new string('x', 33) } }), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Changing_a_windows_database_and_a_window_opened_in_one_that_isnt_there()
    {
        var window = await OpenWindowAsync();
        Assert.Equal("main", (await _channel.ReplyAsync("use", new { window, name = "main" })).GetProperty("name").GetString());
        Assert.Contains("no such database", await _channel.ErrorAsync("use", new { window, name = "elsewhere" }), StringComparison.Ordinal);

        var opened = await _channel.ReplyAsync("window.open", new { database = "elsewhere" });
        Assert.Contains("no such database", opened.GetProperty("warning").GetString(), StringComparison.Ordinal);
        Assert.Equal("main", opened.GetProperty("database").GetString());
    }

    [Fact]
    public async Task Blocking_is_reported_and_a_kill_is_audited_with_the_engines_name()
    {
        Dialect.Blocking = new BlockingReport(BlockingChains.Build([Session(51, null), Session(52, 51)]), 1, true, DateTimeOffset.UnixEpoch);

        var report = await _channel.ReplyAsync("blocking");
        Assert.Equal(51, report.GetProperty("leads")[0].GetProperty("sessionId").GetInt32());

        await _channel.ReplyAsync("kill", new { sessionId = 51, serial = 7 });
        Assert.Equal((51, (int?)7), Assert.Single(Dialect.Killed));
        var killed = Assert.Single(_audit.Events);
        Assert.Equal(("sqlite.kill", (Guid?)HostId, "KILL 51,7 · tester@memory"), killed);

        Assert.Contains("no such session", await _channel.ErrorAsync("kill", new { sessionId = 999 }), StringComparison.Ordinal);
        Assert.Contains("Choose a session", await _channel.ErrorAsync("kill", new { sessionId = 0 }), StringComparison.Ordinal);
        Assert.Single(_audit.Events);
    }

    [Fact]
    public async Task A_tab_has_at_most_twenty_windows_and_closing_one_frees_its_place()
    {
        var windows = new List<string>();
        for (var i = 0; i < DatabaseSession.MaxWindows; i++)
        {
            windows.Add(await OpenWindowAsync());
        }

        Assert.Contains("already has 20", await _channel.ErrorAsync("window.open"), StringComparison.Ordinal);
        await _channel.ReplyAsync("window.close", new { window = windows[0] });
        await OpenWindowAsync();
    }

    [Fact]
    public async Task Ending_the_session_closes_every_connection_the_login_opened()
    {
        await OpenWindowAsync();
        await OpenWindowAsync();

        _channel.Close();
        await _running!;
        await _session!.DisposeAsync();

        Assert.All(_engine.Opened, c => Assert.Equal(System.Data.ConnectionState.Closed, c.State));
        Assert.Equal(3, _engine.Opened.Count);
    }

    [Fact]
    public async Task An_unknown_request_is_refused_and_the_session_goes_on()
    {
        Assert.Contains("doesn't know", await _channel.ErrorAsync("drop-everything"), StringComparison.Ordinal);
        Assert.Contains("closed", await _channel.ErrorAsync("query", new { window = "w99", sql = "SELECT 1" }), StringComparison.Ordinal);
        Assert.Equal("SQLite", (await _channel.ReplyAsync("info")).GetProperty("product").GetString());
    }

    private async Task<string> OpenWindowAsync() => (await _channel.ReplyAsync("window.open")).GetProperty("window").GetString()!;

    /// <summary>The error to a request that's sent again until it is one (the first query may not have claimed the window yet).</summary>
    private async Task<string> ErrorUntilAsync(string type, object body)
    {
        for (var attempt = 0; attempt < 50; attempt++)
        {
            var answer = await _channel.AnswerAsync(_channel.Send(type, body));
            if (answer.GetProperty("type").GetString() == "error")
            {
                return answer.GetProperty("message").GetString()!;
            }

            await Task.Delay(20, TestContext.Current.CancellationToken);
        }

        Assert.Fail("It was never refused.");
        return string.Empty;
    }

    private static BlockingSession Session(int id, int? blockedBy) =>
        new(id, "sa", "app01", "app", "main", "sleeping", 1, blockedBy, null, null, blockedBy is null ? null : 1000, null, null, 0, 0, []);
}

public sealed class BlockingChainsTests
{
    [Fact]
    public void Chains_are_built_under_their_leads_with_the_most_blocked_first()
    {
        var leads = BlockingChains.Build([S(1, null), S(2, 1), S(3, 2), S(4, null), S(5, 4), S(6, 4), S(7, 4)]);

        Assert.Equal([4, 1], leads.Select(l => l.SessionId));
        Assert.Equal((3, 3), (leads[0].Blocked, leads[0].BlockedVolume));
        Assert.Equal((1, 2), (leads[1].Blocked, leads[1].BlockedVolume));
        Assert.Equal(3, leads[1].BlockedSessions[0].BlockedSessions[0].SessionId);
    }

    [Fact]
    public void A_missing_blocker_becomes_a_placeholder_and_a_cycle_is_headed_by_its_lowest_session()
    {
        var leads = BlockingChains.Build([S(10, -2), S(21, 22), S(22, 21), S(30, 30)], id => id == -2 ? "orphaned distributed transaction" : null);

        var placeholder = leads.Single(l => l.SessionId == -2);
        Assert.True(placeholder.Placeholder);
        Assert.Equal("orphaned distributed transaction", placeholder.Status);
        var cycle = leads.Single(l => l.SessionId == 21);
        Assert.Null(cycle.BlockedBy);
        Assert.Equal(22, Assert.Single(cycle.BlockedSessions).SessionId);
        Assert.True(leads.Single(l => l.SessionId == 30).SelfBlocking);
        Assert.Equal(3, BlockingChains.BlockedCount([S(10, -2), S(21, 22), S(22, 21), S(30, 30)]));
    }

    [Fact]
    public void Values_read_as_SSMS_shows_them()
    {
        Assert.Equal("1", DbValueText.Format(true));
        Assert.Equal("0x0A0B", DbValueText.Format(new byte[] { 10, 11 }));
        Assert.Equal("0x0A", DbValueText.Hex([10, 11, 12], 4));
        Assert.Equal("2026-01-02 00:00:00", DbValueText.Format(new DateTime(2026, 1, 2, 0, 0, 0, DateTimeKind.Unspecified)));
        Assert.Equal("2026-01-02 03:04:05.006", DbValueText.Format(new DateTime(2026, 1, 2, 3, 4, 5, 6, DateTimeKind.Unspecified)));
        Assert.Equal("1.5", DbValueText.Format(1.5m));
        Assert.Equal("abc", DbValueText.Format("abcdef", 3));
        Assert.True(DbValueText.IsNumeric(typeof(decimal)));
        Assert.False(DbValueText.IsNumeric(typeof(string)));
    }

    private static BlockingSession S(int id, int? blockedBy) =>
        new(id, null, null, null, null, null, 0, blockedBy, null, null, null, null, null, 0, 0, []);
}

internal static class JsonAssertions
{
    public static IEnumerable<string> Strings(this JsonElement array) => array.EnumerateArray().Select(e => e.GetString()!);
}
