using ScopeScan.Core.Models;

namespace ScopeScan.Core.Scoring;

/// <summary>Aggregates findings into counts and a 0-100 risk score (higher = worse).</summary>
public static class SeverityScorer
{
    public static int Weight(Severity severity) => severity switch
    {
        Severity.Critical => 40,
        Severity.High => 20,
        Severity.Medium => 8,
        Severity.Low => 3,
        _ => 0,
    };

    /// <summary>Low-confidence findings count half, rounded down.</summary>
    public static int Score(IEnumerable<Finding> findings)
    {
        var total = findings.Sum(f => f.Confidence == Confidence.Low ? Weight(f.Severity) / 2 : Weight(f.Severity));
        return Math.Min(100, total);
    }

    public static SeveritySummary Summarize(IEnumerable<Finding> findings)
    {
        var list = findings as IReadOnlyCollection<Finding> ?? findings.ToList();
        int Count(Severity s) => list.Count(f => f.Severity == s);
        return new SeveritySummary(Count(Severity.Critical), Count(Severity.High), Count(Severity.Medium), Count(Severity.Low), Count(Severity.Info));
    }

    public static Severity? Highest(IEnumerable<Finding> findings) =>
        findings.Select(f => (Severity?)f.Severity).DefaultIfEmpty(null).Max();

    public static string Grade(int score) => score switch
    {
        0 => "A",
        <= 10 => "B",
        <= 30 => "C",
        <= 60 => "D",
        _ => "F",
    };

    /// <summary>Most severe first, then by title for stable ordering.</summary>
    public static IReadOnlyList<Finding> Order(IEnumerable<Finding> findings) =>
        findings.OrderByDescending(f => f.Severity).ThenByDescending(f => f.Confidence).ThenBy(f => f.Title, StringComparer.Ordinal).ToList();
}
