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
    private readonly Lazy<Task<RobotsPolicy>> _robots = new(() => LoadRobotsAsync(target, http));

    public string ScanId { get; } = scanId;
    public Uri Target { get; } = target;
    public IScanHttpClient Http { get; } = http;

    /// <summary>A unique marker for this scan, e.g. "scopescan123a1b2c3".</summary>
    public string Marker { get; } = MarkerPrefix + Guid.NewGuid().ToString("N")[..6];

    /// <summary>GET of the target (redirects followed in scope). Throws if the target is unreachable.</summary>
    public Task<ScanResponse> GetBaselineAsync() => _baseline.Value;

    public Task<RobotsPolicy> GetRobotsAsync() => _robots.Value;

    private static async Task<RobotsPolicy> LoadRobotsAsync(Uri target, IScanHttpClient http)
    {
        try
        {
            var r = await http.SendAsync(new ScanHttpRequest(new Uri(target, "/robots.txt"), "robots.txt") { MaxBodyBytes = 64 * 1024 });
            return r.StatusCode == 200 && !r.IsHtml ? RobotsPolicy.Parse(r.BodyText) : RobotsPolicy.AllowAll;
        }
        catch (Exception ex) when (ex is HttpRequestException or TimeoutException)
        {
            return RobotsPolicy.AllowAll;
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
