namespace NKeeper.Plugins.Databases;

/// <summary>
/// The object explorer's kinds of node that the engines share (from 1.x's <c>SqlObjectExplorer.Kinds</c>). An engine
/// may add its own, such as Oracle's packages. The tab knows <see cref="Server"/> and <see cref="Database"/>, which
/// offer New Query.
/// </summary>
public static class NodeKinds
{
    public const string Server = SqlObjectNode.Server;
    public const string Databases = "databases";
    public const string SystemDatabases = "systemDatabases";
    public const string Database = "database";
    public const string Tables = "tables";
    public const string SystemTables = "systemTables";
    public const string Table = "table";
    public const string Views = "views";
    public const string SystemViews = "systemViews";
    public const string View = "view";
    public const string Synonyms = "synonyms";
    public const string Synonym = "synonym";
    public const string Programmability = "programmability";
    public const string Procedures = "procedures";
    public const string Procedure = "procedure";
    public const string Functions = "functions";
    public const string Function = "function";
    public const string Columns = "columns";
    public const string Column = "column";
    public const string Keys = "keys";
    public const string Key = "key";
    public const string Indexes = "indexes";
    public const string Index = "index";
    public const string Triggers = "triggers";
    public const string Trigger = "trigger";
    public const string Parameter = "parameter";
    public const string DatabaseSecurity = "databaseSecurity";
    public const string Users = "users";
    public const string User = "user";
    public const string Roles = "roles";
    public const string Role = "role";
    public const string Schemas = "schemas";
    public const string SchemaNode = "schema";
    public const string ServerSecurity = "serverSecurity";
    public const string Logins = "logins";
    public const string Login = "login";
    public const string ServerRoles = "serverRoles";
    public const string ServerRole = "serverRole";
    public const string Management = "management";

    /// <summary>A tool that opens in its own document tab; its <see cref="SqlObjectNode.Tool"/> names it.</summary>
    public const string Tool = "tool";

    /// <summary>A folder of Management tools.</summary>
    public const string ToolFolder = "toolFolder";

    /// <summary>The blocking manager's tool name.</summary>
    public const string BlockingManagerTool = "blocking";
}

/// <summary>How much of a query's results is sent, whatever the engine (from 1.x's <c>SqlQueryRunner</c>).</summary>
public static class QueryLimits
{
    /// <summary>Rows sent per result set; the rest are counted, not sent.</summary>
    public const int MaxRowsPerResult = 10_000;

    /// <summary>Rows sent in all, across a script's result sets.</summary>
    public const int MaxRowsTotal = 50_000;

    /// <summary>Characters sent per value (SSMS's grid default is 65,535).</summary>
    public const int MaxCharsPerValue = DbValueText.MaxChars;
}
