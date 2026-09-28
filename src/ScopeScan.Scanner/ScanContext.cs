using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner;

public interface IScanCheck
{
    /// <summary>Stable identifier, used in finding ids and the report appendix.</summary>
    string Id { get; }
    string Name { get; }
    Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct);
}

/// <summary>Shared per-scan state. Common responses are fetched once and reused by all checks.</summary>
public sealed class ScanContext(string scanId, Uri target, IScanHttpClient http)
{
    /// <summary>Inert marker used for reflection/redirect probes. Contains no markup or SQL metacharacters.</summary>
    public const string MarkerPrefix = "scopescan123";

    private readonly Lazy<Task<ScanResponse>> _baseline = new(() =>
        http.SendAsync(new ScanHttpRequest(target, "baseline")));
    private readonly Lazy<Task<ScanResponse?>> _robotsResponse = new(() => LoadRobotsAsync(target, http));

    public string ScanId { get; } = scanId;
    public Uri Target { get; } = target;
    public IScanHttpClient Http { get; } = http;

    /// <summary>A unique marker for this scan, e.g. "scopescan123a1b2c3".</summary>
    public string Marker { get; } = MarkerPrefix + Guid.NewGuid().ToString("N")[..6];

    /// <summary>GET of the target (redirects followed in scope). Throws if the target is unreachable.</summary>
    public Task<ScanResponse> GetBaselineAsync() => _baseline.Value;

    /// <summary>The /robots.txt response (fetched once, not following redirects), or null if unreachable.</summary>
    public Task<ScanResponse?> GetRobotsResponseAsync() => _robotsResponse.Value;

    /// <summary>robots.txt rules applied to any crawling (discovered links). Missing robots.txt allows all.</summary>
    public async Task<RobotsPolicy> GetRobotsAsync()
    {
        var r = await GetRobotsResponseAsync();
        return r is { StatusCode: 200, IsHtml: false } ? RobotsPolicy.Parse(r.BodyText) : RobotsPolicy.AllowAll;
    }

    /// <summary>
    /// Target plus up to <paramref name="max"/> same-host links from the baseline page that carry a query
    /// string and are allowed by robots.txt. This is the only "crawling" ScopeScan does.
    /// </summary>
    public async Task<IReadOnlyList<Uri>> GetCandidateUrlsAsync(int max = 3)
    {
        var baseline = await GetBaselineAsync();
        var robots = await GetRobotsAsync();
        var result = new List<Uri> { baseline.FinalUrl.Query.Length > 0 || Target.Query.Length == 0 ? baseline.FinalUrl : Target };
        if (!baseline.IsHtml) return result;
        foreach (var link in HtmlExtract.Links(baseline.BodyText, baseline.FinalUrl))
        {
            if (result.Count > max) break;
            if (link.Query.Length <= 1 || !string.Equals(link.IdnHost, Target.IdnHost, StringComparison.OrdinalIgnoreCase)) continue;
            if (!robots.IsAllowed(link.PathAndQuery)) continue;
            if (result.Any(u => u.AbsolutePath == link.AbsolutePath)) continue;
            result.Add(link);
        }
        return result;
    }

    private static async Task<ScanResponse?> LoadRobotsAsync(Uri target, IScanHttpClient http)
    {
        try
        {
            return await http.SendAsync(new ScanHttpRequest(new Uri(target, "/robots.txt"), "robots.txt")
            {
                MaxBodyBytes = 64 * 1024,
                FollowRedirects = false,
            });
        }
        catch (Exception ex) when (ex is HttpRequestException or TimeoutException)
        {
            return null;
        }
    }
}

/// <summary>Helpers that keep finding construction consistent across checks.</summary>
public static class FindingFactory
{
    public static Finding Create(
        string checkId, string code, string title, Severity severity, string? cwe, Uri affected,
        string description, string? evidence, string remediation, Confidence confidence = Confidence.High) =>
        new($"{checkId}.{code}", title, severity, cwe, affected.ToString(), description,
            evidence is null ? null : SecretRedactor.Redact(evidence), [], remediation, confidence)
        { CheckId = checkId };
}
