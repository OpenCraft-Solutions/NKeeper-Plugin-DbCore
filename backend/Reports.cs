using System.Data.Common;
using System.Globalization;

namespace NKeeper.Plugins.Databases;

/// <summary>A Management report an engine offers (docs/architecture.md §7.32, from 1.x): its name, the label and what it covers.</summary>
public sealed record DatabaseReportInfo(string Name, string Label, string Detail);

/// <summary>A script a report offers: SQL to open in a query window, or text to copy and run elsewhere (e.g. in RMAN). It's never run by the report.</summary>
/// <param name="Kind"><c>sql</c> (opens in a query window) or <c>copy</c> (copied: RMAN, say, runs on the database server, not over SQL).</param>
public sealed record ToolScript(string Label, string Text, string Kind = "sql");

/// <summary>What one query of a report said: its result sets, or why it couldn't be read; and scripts to act on it.</summary>
/// <param name="Command">What it reads, such as <c>dba_tablespaces</c>, for the reader.</param>
public sealed record ToolSection(string Title, string Command, IReadOnlyList<SqlOutput> Results, string? Error, IReadOnlyList<ToolScript>? Scripts = null, string? Note = null);

/// <summary>A Management report, as 1.x's: what needs looking at, worst first (empty when all is well), then its sections.</summary>
public sealed record ToolReport(IReadOnlyList<string> Warnings, IReadOnlyList<ToolSection> Sections, DateTimeOffset AtUtc);

/// <summary>Helpers for an engine's reports, ported from 1.x's <c>ToolReports</c>.</summary>
public static class ToolReports
{
    /// <summary>Every row of a section's result sets, with the columns it has.</summary>
    public static IEnumerable<(IReadOnlyList<SqlColumn> Columns, string?[] Row)> Rows(ToolSection section) =>
        section.Results.Where(r => r.Kind == "results" && r.Columns is not null && r.Rows is not null).SelectMany(r => r.Rows!.Select(row => (r.Columns!, row)));

    /// <summary>A row's value in the column of that name (any case), or null.</summary>
    public static string? Cell(IReadOnlyList<SqlColumn> columns, string?[] row, string name)
    {
        for (var i = 0; i < columns.Count && i < row.Length; i++)
        {
            if (string.Equals(columns[i].Name.Trim(), name, StringComparison.OrdinalIgnoreCase))
            {
                return row[i]?.Trim();
            }
        }

        return null;
    }

    public static double? Number(IReadOnlyList<SqlColumn> columns, string?[] row, string name) =>
        double.TryParse(Cell(columns, row, name), NumberStyles.Float, CultureInfo.InvariantCulture, out var value) ? value : null;

    /// <summary>
    /// A section from one query, read with <paramref name="read"/> (the engine's own result reader). A query the server refuses
    /// becomes the section's error, so a login that can't read one view still gets the rest; <paramref name="fallbackSql"/>
    /// is tried first, for an older server's views.
    /// </summary>
    public static async Task<ToolSection> SectionAsync(
        DbConnection connection,
        string title,
        string source,
        string sql,
        Func<DbDataReader, CancellationToken, Task<SqlOutput>> read,
        Func<Exception, bool> isServerError,
        CancellationToken cancellationToken,
        string? fallbackSql = null,
        string? note = null,
        IReadOnlyList<ToolScript>? scripts = null)
    {
        ArgumentNullException.ThrowIfNull(connection);
        ArgumentNullException.ThrowIfNull(read);
        ArgumentNullException.ThrowIfNull(isServerError);
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.CommandTimeout = 60;
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            return new ToolSection(title, source, [await read(reader, cancellationToken)], null, scripts, note);
        }
        catch (Exception ex) when (fallbackSql is not null && isServerError(ex))
        {
            return await SectionAsync(connection, title, source, fallbackSql, read, isServerError, cancellationToken, null, note, scripts);
        }
        catch (Exception ex) when (isServerError(ex))
        {
            return new ToolSection(title, source, [], ex.Message, null, note);
        }
    }
}
