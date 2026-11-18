using System.Data.Common;
using System.Globalization;

namespace NKeeper.Plugins.Databases;

/// <summary>Values as text for the results grid, whatever the database: dates as yyyy-MM-dd HH:mm:ss.fff, binary as 0x… (from 1.x).</summary>
public static class DbValueText
{
    /// <summary>Characters sent per value (SSMS's grid default is 65,535).</summary>
    public const int MaxChars = 65_535;

    public static string Format(object value, int maxChars = MaxChars)
    {
        ArgumentNullException.ThrowIfNull(value);
        var text = value switch
        {
            bool b => b ? "1" : "0",
            byte[] bytes => Hex(bytes, maxChars),
            Guid guid => guid.ToString("D").ToUpperInvariant(),
            DateTime date => date.TimeOfDay == TimeSpan.Zero && date.Millisecond == 0
                ? date.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)
                : date.ToString("yyyy-MM-dd HH:mm:ss.fff", CultureInfo.InvariantCulture),
            DateTimeOffset offset => offset.ToString("yyyy-MM-dd HH:mm:ss.fffffff zzz", CultureInfo.InvariantCulture),
            TimeSpan time => time.ToString("c", CultureInfo.InvariantCulture),
            double d => d.ToString("R", CultureInfo.InvariantCulture),
            float f => f.ToString("R", CultureInfo.InvariantCulture),
            IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
            _ => value.ToString() ?? string.Empty,
        };
        return text.Length > maxChars ? text[..maxChars] : text;
    }

    public static string Hex(byte[] bytes, int maxChars = MaxChars)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        var take = Math.Max(0, Math.Min(bytes.Length, (maxChars - 2) / 2));
        return "0x" + Convert.ToHexString(bytes, 0, take);
    }

    /// <summary>Whether a column of this .NET type holds numbers (shown right-aligned).</summary>
    public static bool IsNumeric(Type? type) =>
        type == typeof(byte) || type == typeof(short) || type == typeof(int) || type == typeof(long) || type == typeof(decimal)
        || type == typeof(double) || type == typeof(float) || type == typeof(ushort) || type == typeof(uint) || type == typeof(ulong) || type == typeof(sbyte);
}

/// <summary>Reads a query's rows, for an engine's explorer and tools (from 1.x).</summary>
public static class DbQuery
{
    /// <summary>Seconds a tool's query may run.</summary>
    public const int Timeout = 30;

    public static async Task<IReadOnlyList<T>> ListAsync<T>(
        DbConnection connection, string sql, IEnumerable<(string Name, object? Value)> parameters, Func<DbDataReader, T> map, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(connection);
        ArgumentNullException.ThrowIfNull(map);
        await using var command = Command(connection, sql, parameters);
        var list = new List<T>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            list.Add(map(reader));
        }

        return list;
    }

    public static async Task ExecuteAsync(DbConnection connection, string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        ArgumentNullException.ThrowIfNull(connection);
        await using var command = Command(connection, sql, parameters);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public static async Task<object?> ScalarAsync(DbConnection connection, string sql, CancellationToken cancellationToken, params (string Name, object? Value)[] parameters)
    {
        ArgumentNullException.ThrowIfNull(connection);
        await using var command = Command(connection, sql, parameters);
        var value = await command.ExecuteScalarAsync(cancellationToken);
        return value is DBNull ? null : value;
    }

    public static string? Text(DbDataReader reader, int ordinal)
    {
        ArgumentNullException.ThrowIfNull(reader);
        return reader.IsDBNull(ordinal) ? null : Convert.ToString(reader.GetValue(ordinal), CultureInfo.InvariantCulture)?.Trim();
    }

    public static int Int(DbDataReader reader, int ordinal)
    {
        ArgumentNullException.ThrowIfNull(reader);
        return reader.IsDBNull(ordinal) ? 0 : Convert.ToInt32(reader.GetValue(ordinal), CultureInfo.InvariantCulture);
    }

    public static long? Long(DbDataReader reader, int ordinal)
    {
        ArgumentNullException.ThrowIfNull(reader);
        return reader.IsDBNull(ordinal) ? null : Convert.ToInt64(reader.GetValue(ordinal), CultureInfo.InvariantCulture);
    }

    private static DbCommand Command(DbConnection connection, string sql, IEnumerable<(string Name, object? Value)> parameters)
    {
        var command = connection.CreateCommand();
#pragma warning disable CA2100 // The engines' own SQL; values are parameters.
        command.CommandText = sql;
#pragma warning restore CA2100
        command.CommandTimeout = Timeout;
        foreach (var (name, value) in parameters)
        {
            var parameter = command.CreateParameter();
            parameter.ParameterName = name;
            parameter.Value = value ?? DBNull.Value;
            command.Parameters.Add(parameter);
        }

        return command;
    }
}
