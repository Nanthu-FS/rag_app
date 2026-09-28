using System.Text.RegularExpressions;
using System.Web;
using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

/// <summary>
/// For existing redirect-style parameters (next, returnUrl, …) substitutes a benign external marker URL on a
/// reserved, non-resolvable domain and checks whether the server redirects to it. Redirects are never followed.
/// </summary>
public sealed partial class OpenRedirectCheck : IScanCheck
{
    public const string MarkerHost = "scopescan-redirect-marker.example";
    private const int MaxRequests = 5;

    public string Id => "open-redirect";
    public string Name => "Open redirect (benign marker)";

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var markerUrl = $"https://{MarkerHost}/{ctx.Marker}";
        var findings = new List<Finding>();
        var sent = 0;

        foreach (var candidate in await ctx.GetCandidateUrlsAsync())
        {
            var names = HttpUtility.ParseQueryString(candidate.Query).AllKeys.OfType<string>()
                .Where(k => RedirectParamRegex().IsMatch(k)).Distinct();
            foreach (var name in names)
            {
                if (sent++ >= MaxRequests) return findings;
                ct.ThrowIfCancellationRequested();
                var probe = ReflectedParameterCheck.WithParameter(candidate, name, markerUrl);
                ScanResponse r;
                try
                {
                    r = await ctx.Http.SendAsync(new ScanHttpRequest(probe, $"open-redirect-probe {name}") { FollowRedirects = false, MaxBodyBytes = 64 * 1024 }, ct);
                }
                catch (Exception ex) when (ex is HttpRequestException or TimeoutException) { continue; }

                var location = r.Headers.Get("Location");
                if (r.IsRedirect && location is not null && Uri.TryCreate(probe, location, out var target) &&
                    target.Host.Equals(MarkerHost, StringComparison.OrdinalIgnoreCase))
                {
                    findings.Add(FindingFactory.Create(Id, $"{name.ToLowerInvariant()}", $"Open redirect via '{name}' parameter",
                        Severity.Medium, "CWE-601", probe,
                        $"The '{name}' parameter redirects the browser to an arbitrary external site. Attackers can use trusted links from this domain for phishing or to steal OAuth tokens in some flows.",
                        $"GET {probe.PathAndQuery}\nHTTP {r.StatusCode} Location: {location}",
                        "Only allow relative paths or an allowlist of destinations for redirect parameters."));
                }
                else if (r.IsHtml && ClientRedirectRegex().IsMatch(r.BodyText) && r.BodyText.Contains(markerUrl, StringComparison.Ordinal))
                {
                    findings.Add(FindingFactory.Create(Id, $"{name.ToLowerInvariant()}.client", $"Possible client-side open redirect via '{name}'",
                        Severity.Low, "CWE-601", probe,
                        $"The marker URL supplied in '{name}' appears in a meta refresh or script-based redirect in the response.",
                        $"GET {probe.PathAndQuery}\nMarker URL found near a client-side redirect construct.",
                        "Validate redirect destinations against an allowlist before using them in client-side redirects.",
                        Confidence.Medium));
                }
            }
        }
        return findings;
    }

    [GeneratedRegex(@"^(url|uri|next|redirect|redirect_?ur[il]|redir|return|return_?to|returnurl|return_?path|goto|continue|dest|destination|target|to|out|view|forward|callback_?url|success_?url|rurl|r)$", RegexOptions.IgnoreCase)]
    private static partial Regex RedirectParamRegex();

    [GeneratedRegex(@"http-equiv\s*=\s*[""']?refresh|location(\.href)?\s*=|location\.(replace|assign)\s*\(", RegexOptions.IgnoreCase)]
    private static partial Regex ClientRedirectRegex();
}
