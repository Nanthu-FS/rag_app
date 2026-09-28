namespace ScopeScan.Scanner;

/// <summary>
/// Minimal robots.txt evaluator for the "*" and "ScopeScan" groups. Longest match wins; Allow wins ties.
/// Used for any crawling; the fixed exposed-file list is exempt by design.
/// </summary>
public sealed class RobotsPolicy
{
    public static readonly RobotsPolicy AllowAll = new([]);

    private readonly IReadOnlyList<(bool Allow, string Prefix)> _rules;

    private RobotsPolicy(IReadOnlyList<(bool, string)> rules) => _rules = rules;

    public int DisallowCount => _rules.Count(r => !r.Allow);

    public static RobotsPolicy Parse(string text)
    {
        var groups = new Dictionary<string, List<(bool, string)>>(StringComparer.OrdinalIgnoreCase);
        var agents = new List<string>();
        var lastWasAgent = false;
        foreach (var rawLine in text.Split('\n'))
        {
            var line = rawLine.Split('#')[0].Trim();
            var colon = line.IndexOf(':');
            if (colon <= 0) continue;
            var key = line[..colon].Trim().ToLowerInvariant();
            var value = line[(colon + 1)..].Trim();
            if (key == "user-agent")
            {
                if (!lastWasAgent) agents.Clear();
                agents.Add(value);
                lastWasAgent = true;
                continue;
            }
            lastWasAgent = false;
            if (key is not ("allow" or "disallow")) continue;
            foreach (var agent in agents)
            {
                if (!groups.TryGetValue(agent, out var list)) groups[agent] = list = [];
                if (value.Length > 0) list.Add((key == "allow", value));
            }
        }

        var chosen = groups.FirstOrDefault(g => g.Key.Contains("scopescan", StringComparison.OrdinalIgnoreCase)).Value
            ?? (groups.TryGetValue("*", out var star) ? star : []);
        return new RobotsPolicy(chosen);
    }

    public bool IsAllowed(string pathAndQuery)
    {
        var best = (Allow: true, Length: -1);
        foreach (var (allow, prefix) in _rules)
        {
            if (!Matches(pathAndQuery, prefix)) continue;
            var len = prefix.Length;
            if (len > best.Length || (len == best.Length && allow)) best = (allow, len);
        }
        return best.Allow;
    }

    private static bool Matches(string path, string pattern)
    {
        var anchored = pattern.EndsWith('$');
        var p = anchored ? pattern[..^1] : pattern;
        var parts = p.Split('*');
        var pos = 0;
        for (var i = 0; i < parts.Length; i++)
        {
            if (i == 0)
            {
                if (!path.StartsWith(parts[0], StringComparison.Ordinal)) return false;
                pos = parts[0].Length;
                continue;
            }
            var idx = path.IndexOf(parts[i], pos, StringComparison.Ordinal);
            if (idx < 0) return false;
            pos = idx + parts[i].Length;
        }
        return !anchored || pos == path.Length || (parts.Length > 1 && path.EndsWith(parts[^1], StringComparison.Ordinal));
    }
}
