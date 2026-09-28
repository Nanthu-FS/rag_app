using System.Text.RegularExpressions;
using System.Web;
using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

/// <summary>
/// Replaces query parameter values with an inert alphanumeric marker and reports where it is echoed back.
/// No script, HTML or SQL payloads are ever sent; a reflection only indicates a place worth manual review.
/// </summary>
public sealed partial class ReflectedParameterCheck : IScanCheck
{
    public const string SyntheticParameter = "scopescan";
    private const int MaxRequests = 8;
    private const int MaxParamsPerUrl = 5;

    public string Id => "reflected-parameters";
    public string Name => "Reflected parameters (inert marker)";

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var findings = new List<Finding>();
        var sent = 0;
        foreach (var candidate in await ctx.GetCandidateUrlsAsync())
        {
            var query = HttpUtility.ParseQueryString(candidate.Query);
            var names = query.AllKeys.OfType<string>().Where(k => k.Length > 0).Distinct().Take(MaxParamsPerUrl).ToList();
            if (names.Count == 0) names = [SyntheticParameter];

            for (var i = 0; i < names.Count && sent < MaxRequests; i++, sent++)
            {
                ct.ThrowIfCancellationRequested();
                var marker = $"{ctx.Marker}p{sent}";
                var probe = WithParameter(candidate, names[i], marker);
                ScanResponse r;
                try { r = await ctx.Http.SendAsync(new ScanHttpRequest(probe, $"reflection-probe {names[i]}"), ct); }
                catch (Exception ex) when (ex is HttpRequestException or TimeoutException) { continue; }

                var body = r.BodyText;
                var index = body.IndexOf(marker, StringComparison.Ordinal);
                if (index < 0) continue;

                var context = r.IsHtml ? DetectContext(body, index) : "non-HTML response";
                var (severity, confidence) = context switch
                {
                    "script block" => (Severity.Medium, Confidence.Low),
                    "HTML attribute" or "HTML body" => (Severity.Low, Confidence.Medium),
                    _ => (Severity.Info, Confidence.Medium),
                };
                findings.Add(FindingFactory.Create(Id, $"{Slug(probe.AbsolutePath)}.{Slug(names[i])}",
                    $"Parameter '{names[i]}' is reflected in the response ({context})", severity, "CWE-79", probe,
                    $"The value of '{names[i]}' is echoed into the {context} without being altered. ScopeScan only sent an inert " +
                    "alphanumeric marker, so this does not prove XSS; it identifies a location where output encoding should be verified manually.",
                    $"Marker: {marker}\nContext: {context}\nSnippet: …{Snippet(body, index, marker.Length)}…",
                    "Ensure user input is contextually output-encoded (HTML, attribute, JavaScript) and consider a strict CSP.",
                    confidence));
            }
        }
        return findings;
    }

    public static Uri WithParameter(Uri url, string name, string value)
    {
        var query = HttpUtility.ParseQueryString(url.Query);
        query[name] = value;
        return new UriBuilder(url) { Query = query.ToString() }.Uri;
    }

    private static string DetectContext(string html, int index)
    {
        var before = html[..index];
        var lastScriptOpen = before.LastIndexOf("<script", StringComparison.OrdinalIgnoreCase);
        var lastScriptClose = before.LastIndexOf("</script", StringComparison.OrdinalIgnoreCase);
        if (lastScriptOpen > lastScriptClose && before.IndexOf('>', lastScriptOpen) >= 0) return "script block";
        var lastTagOpen = before.LastIndexOf('<');
        var lastTagClose = before.LastIndexOf('>');
        return lastTagOpen > lastTagClose ? "HTML attribute" : "HTML body";
    }

    private static string Snippet(string body, int index, int length)
    {
        var start = Math.Max(0, index - 60);
        var end = Math.Min(body.Length, index + length + 60);
        return WhitespaceRegex().Replace(body[start..end], " ");
    }

    private static string Slug(string s) { var v = SlugRegex().Replace(s.ToLowerInvariant(), "-").Trim('-'); return v.Length == 0 ? "root" : v; }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex SlugRegex();
}
