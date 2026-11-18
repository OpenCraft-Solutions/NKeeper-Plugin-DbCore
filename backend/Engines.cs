using System.Data.Common;
using NKeeper.Abstractions;

namespace NKeeper.Plugins.Databases;

/// <summary>
/// A kind of database server, which an engine plugin (mssql, oracle, ase) gives db-core (docs/architecture.md §7.32).
/// The engine opens the login with its own driver, through core (<see cref="IConnectivity.OpenDatabaseAsync"/>), and
/// knows its server's SQL; db-core runs the session, its query windows and tools.
/// </summary>
public interface IDatabaseEngine
{
    /// <summary>The engine plugin's ID, which its audit events start with: <c>mssql.kill</c>.</summary>
    string PluginId { get; }

    /// <summary>The product, for messages: <c>SQL Server</c>.</summary>
    string Product { get; }

    IDatabaseDialect Dialect { get; }

    /// <summary>
    /// Opens the session's login, from the engine plugin's session handler: core signs it in, and the engine checks
    /// the server's identity (<see cref="IConnectivity.CheckIdentityAsync"/>) when its protocol carries one.
    /// </summary>
    /// <exception cref="ConnectException">The server couldn't be reached, refused the login, or isn't trusted yet.</exception>
    Task<IDatabaseLogin> OpenAsync(StreamSessionRequest request, CancellationToken cancellationToken);
}

/// <summary>What differs between database servers once connected: running scripts, the explorer, scripts of objects, blocking.</summary>
public interface IDatabaseDialect
{
    /// <summary>What the server says about itself, and the connection's own session on it.</summary>
    Task<DatabaseServerInfo> ServerInfoAsync(DbConnection connection, CancellationToken cancellationToken);

    /// <param name="lineOffset">Lines before <paramref name="script"/> in the editor (when running a selection), so errors point at the editor's lines.</param>
    Task<SqlQueryResult> RunAsync(DbConnection connection, string script, int lineOffset, CancellationToken cancellationToken);

    /// <summary>The database (Oracle: schema) the connection is in.</summary>
    Task<string> CurrentDatabaseAsync(DbConnection connection, CancellationToken cancellationToken);

    /// <summary>Databases (Oracle: schemas) to choose from, for the toolbar.</summary>
    Task<IReadOnlyList<string>> DatabasesAsync(DbConnection connection, CancellationToken cancellationToken);

    /// <summary>Switches the connection to another database (Oracle: its current schema); returns the one it's in now.</summary>
    Task<string> ChangeDatabaseAsync(DbConnection connection, string name, CancellationToken cancellationToken);

    /// <summary>A node's children in the object explorer; the server's own when <paramref name="node"/> is the root (<see cref="SqlObjectNode.Server"/>).</summary>
    /// <exception cref="DatabaseToolException">The node isn't one the explorer knows.</exception>
    Task<IReadOnlyList<SqlObjectNode>> ChildrenAsync(DbConnection connection, SqlObjectNode node, CancellationToken cancellationToken);

    /// <param name="action">One of <see cref="ScriptActions"/>.</param>
    /// <exception cref="DatabaseToolException">The object can't be scripted that way.</exception>
    Task<string> ScriptAsync(DbConnection connection, SqlObjectNode node, string action, CancellationToken cancellationToken);

    Task<BlockingReport> BlockingAsync(DbConnection connection, DateTimeOffset now, CancellationToken cancellationToken);

    /// <param name="serial">Oracle's SERIAL# of the session (a SID alone can be reused).</param>
    Task KillAsync(DbConnection connection, int sessionId, int? serial, CancellationToken cancellationToken);

    /// <summary>
    /// Whether an exception is the server's error (to show the user), not a bug. Most drivers' are
    /// <see cref="DbException"/>s; a driver whose aren't (AdoNetCore.AseClient's) says so here.
    /// </summary>
    bool IsServerError(Exception exception) => exception is DbException;
}

/// <summary>A request the explorer or a script can't serve, such as a node of a kind it doesn't know: shown to the user.</summary>
public sealed class DatabaseToolException(string message) : Exception(message);

/// <summary>What a database server says about itself, for a connection.</summary>
/// <param name="ServerName">SQL Server's @@SERVERNAME, Oracle's instance (and database), ASE's @@servername.</param>
/// <param name="SessionId">The connection's own session on the server: SQL Server's and ASE's SPID, Oracle's SID.</param>
public sealed record DatabaseServerInfo(string ServerName, string ProductVersion, string? ProductLevel, string? Edition, string Login, int SessionId);

/// <summary>The scripts the explorer offers for an object.</summary>
public static class ScriptActions
{
    public const string SelectTop = "selectTop";
    public const string Create = "create";
    public const string Execute = "execute";

    public static bool IsKnown(string action) => action is SelectTop or Create or Execute;
}

/// <summary>A result set's column: its name and the server's type, and whether it holds numbers (shown right-aligned).</summary>
public sealed record SqlColumn(string Name, string Type, bool Numeric);

/// <summary>
/// One thing a query produced, in the order it happened, as SSMS lists them:
/// <list type="bullet">
/// <item><c>results</c>: a result set (<see cref="Columns"/>, <see cref="Rows"/>; <see cref="RowCount"/> is every row, even past the ones sent).</item>
/// <item><c>rows</c>: "(n rows affected)" after a statement.</item>
/// <item><c>message</c>: PRINT, or an informational message (<see cref="Text"/>).</item>
/// <item><c>error</c>: an error, with its number, severity, state, procedure and line in the script.</item>
/// </list>
/// </summary>
public sealed record SqlOutput(
    string Kind,
    string? Text = null,
    IReadOnlyList<SqlColumn>? Columns = null,
    IReadOnlyList<string?[]>? Rows = null,
    long? RowCount = null,
    bool Truncated = false,
    int? Number = null,
    int? Severity = null,
    int? State = null,
    string? Procedure = null,
    int? Line = null);

/// <param name="Database">The connection's database afterwards (<c>USE</c> changes it).</param>
/// <param name="Cancelled">The user cancelled it.</param>
/// <param name="ConnectionLost">The connection broke (a severe error, or the server went away): the window must reconnect.</param>
public sealed record SqlQueryResult(IReadOnlyList<SqlOutput> Output, string Database, long ElapsedMs, bool Cancelled, bool ConnectionLost, bool HasErrors);

/// <summary>
/// A node of the object explorer. The browser sends a node back to list its children, so a node carries what
/// identifies it: its <see cref="Kind"/>, database, and object (schema, name, ID). Kinds are the engine's own, except
/// the root, <see cref="Server"/>.
/// </summary>
public sealed record SqlObjectNode
{
    /// <summary>The root's kind: its children are the server's top folders.</summary>
    public const string Server = "server";

    public string Kind { get; init; } = string.Empty;

    public string Label { get; init; } = string.Empty;

    /// <summary>Shown dimmed beside the label, e.g. a column's type or a database's state.</summary>
    public string? Detail { get; init; }

    public bool Expandable { get; init; }

    public string? Database { get; init; }

    public string? Schema { get; init; }

    public string? Name { get; init; }

    public long? ObjectId { get; init; }

    /// <summary>The scripts it offers (<see cref="ScriptActions"/>), in the order the menu shows them.</summary>
    public IReadOnlyList<string> Scripts { get; init; } = [];

    /// <summary>For a tool's node, such as the blocking manager under Management: the tool it opens.</summary>
    public string? Tool { get; init; }
}

/// <summary>
/// A session in a blocking chain. A lead blocker heads its chain: it blocks others but isn't itself waiting on
/// anyone. <see cref="Blocked"/> counts the sessions it blocks directly, <see cref="BlockedVolume"/> every session
/// waiting behind it down the chain. A session blocking only itself is listed like a lead, with nothing under it.
/// </summary>
/// <param name="Database">Null when the session isn't in a database (shown as N/A).</param>
/// <param name="BlockedBy">The session it waits on; null for a lead blocker.</param>
/// <param name="WaitTimeMs">How long it has been waiting, for a blocked session.</param>
/// <param name="Sql">The batch it is running, or last ran (a sleeping lead blocker's open transaction began somewhere in it).</param>
/// <param name="Placeholder">A blocker the server reports but that isn't a session (e.g. SQL Server's -2, an orphaned distributed transaction).</param>
/// <param name="Serial">Oracle's SERIAL# of the session: killing one takes it with the SID.</param>
/// <param name="SelfBlocking">It's waiting on itself: usually one of its own parallel threads, or its own I/O.</param>
public sealed record BlockingSession(
    int SessionId,
    string? Login,
    string? Host,
    string? Program,
    string? Database,
    string? Status,
    int OpenTransactions,
    int? BlockedBy,
    string? Command,
    string? WaitType,
    long? WaitTimeMs,
    string? WaitResource,
    string? Sql,
    int Blocked,
    int BlockedVolume,
    IReadOnlyList<BlockingSession> BlockedSessions,
    bool Placeholder = false,
    int? Serial = null,
    bool SelfBlocking = false);

/// <param name="Leads">The lead blockers, each with the sessions it blocks under it.</param>
/// <param name="CanSeeAllSessions">Whether the login can see every session; without it, only its own are visible.</param>
public sealed record BlockingReport(IReadOnlyList<BlockingSession> Leads, int BlockedCount, bool CanSeeAllSessions, DateTimeOffset AtUtc);
