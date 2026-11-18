namespace NKeeper.Plugins.Databases;

/// <summary>Blocking chains, whatever the server: engines read who waits on whom, and this arranges them (ported from 1.x's <c>SqlBlocking</c>).</summary>
public static class BlockingChains
{
    /// <summary>
    /// Arranges sessions into chains under their lead blockers (most blocked volume first). A session waiting on one
    /// that isn't listed, or a cycle with no head, is still shown: the missing blocker becomes a placeholder lead, and
    /// a cycle is headed by its lowest session ID. A session blocking itself is listed even when it blocks no one else.
    /// </summary>
    /// <param name="placeholder">The status of a blocker that isn't listed, by its ID: SQL Server's -2 is an orphaned distributed transaction.</param>
    public static IReadOnlyList<BlockingSession> Build(IReadOnlyList<BlockingSession> sessions, Func<int, string?>? placeholder = null)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        var byId = sessions.GroupBy(s => s.SessionId).ToDictionary(
            g => g.Key,
            g => g.First() is var s && s.BlockedBy == s.SessionId ? s with { BlockedBy = null, SelfBlocking = true } : g.First());
        foreach (var missing in sessions.Where(s => s.BlockedBy is { } b && !byId.ContainsKey(b)).Select(s => s.BlockedBy!.Value).Distinct().ToList())
        {
            byId[missing] = new BlockingSession(missing, null, null, null, null, placeholder?.Invoke(missing), 0, null, null, null, null, null, null, 0, 0, [], Placeholder: true);
        }

        var children = byId.Values.Where(s => s.BlockedBy is not null).ToLookup(s => s.BlockedBy!.Value);
        var placed = new HashSet<int>();

        BlockingSession Build(BlockingSession session, int? leadOf)
        {
            placed.Add(session.SessionId);
            var blocked = children[session.SessionId]
                .Where(c => !placed.Contains(c.SessionId))
                .OrderByDescending(c => c.WaitTimeMs ?? 0)
                .Select(c => Build(c, leadOf))
                .ToList();
            return session with
            {
                BlockedBy = session.SessionId == leadOf ? null : session.BlockedBy,
                Blocked = blocked.Count,
                BlockedVolume = blocked.Count + blocked.Sum(b => b.BlockedVolume),
                BlockedSessions = blocked,
            };
        }

        var leads = byId.Values
            .Where(s => s.BlockedBy is null && (s.SelfBlocking || children[s.SessionId].Any()))
            .OrderBy(s => s.SessionId)
            .Select(s => Build(s, s.SessionId))
            .ToList();

        // Sessions blocking each other in a circle (until the deadlock monitor steps in): head each by its lowest ID.
        foreach (var session in byId.Values.Where(s => s.BlockedBy is not null).OrderBy(s => s.SessionId))
        {
            if (!placed.Contains(session.SessionId))
            {
                leads.Add(Build(session, session.SessionId));
            }
        }

        return [.. leads.OrderByDescending(l => l.BlockedVolume).ThenBy(l => l.SessionId)];
    }

    /// <summary>How many sessions are waiting on another (not on themselves).</summary>
    public static int BlockedCount(IReadOnlyList<BlockingSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        return sessions.Count(s => s.BlockedBy is { } by && by != s.SessionId);
    }
}
