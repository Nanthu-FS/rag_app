using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

/// <summary>Evaluates CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy.</summary>
public sealed class SecurityHeadersCheck : IScanCheck
{
    public string Id => "security-headers";
    public string Name => "Security headers";

    private const long MinHstsMaxAge = 15552000; // 180 days

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var r = await ctx.GetBaselineAsync();
        var h = r.Headers;
        var url = r.FinalUrl;
        var findings = new List<Finding>();
        Finding F(string code, string title, Severity sev, string cwe, string desc, string? ev, string fix, Confidence c = Confidence.High) =>
            FindingFactory.Create(Id, code, title, sev, cwe, url, desc, ev, fix, c);

        // Transport
        if (url.Scheme == Uri.UriSchemeHttp)
        {
            findings.Add(F("no-https", "Page served over plain HTTP", Severity.Medium, "CWE-319",
                "The target did not redirect to HTTPS, so content and any credentials travel unencrypted.",
                $"Final URL: {url}", "Serve the site exclusively over HTTPS and redirect all HTTP requests to HTTPS."));
        }
        else
        {
            var hsts = h.Get("Strict-Transport-Security");
            if (hsts is null)
                findings.Add(F("hsts-missing", "Strict-Transport-Security header missing", Severity.Medium, "CWE-319",
                    "Without HSTS, browsers may be downgraded to HTTP on first visit or via SSL-stripping attacks.",
                    null, "Add 'Strict-Transport-Security: max-age=31536000; includeSubDomains'."));
            else if (ParseMaxAge(hsts) is var maxAge && maxAge < MinHstsMaxAge)
                findings.Add(F("hsts-short", "HSTS max-age is too short", Severity.Low, "CWE-319",
                    $"HSTS max-age is {maxAge?.ToString() ?? "invalid"} seconds; at least 180 days is recommended.",
                    $"Strict-Transport-Security: {hsts}", "Set max-age to at least 15552000 (ideally 31536000)."));
        }

        // Content-Security-Policy
        var csp = h.Get("Content-Security-Policy");
        if (csp is null)
        {
            var reportOnly = h.Get("Content-Security-Policy-Report-Only");
            findings.Add(reportOnly is null
                ? F("csp-missing", "Content-Security-Policy header missing", Severity.Medium, "CWE-693",
                    "No CSP is set, so the browser has no second line of defence against injected scripts (XSS).",
                    null, "Define a restrictive Content-Security-Policy, starting with default-src 'self' and script-src with nonces or hashes.")
                : F("csp-report-only", "CSP is in report-only mode", Severity.Low, "CWE-693",
                    "A CSP is present only as Report-Only, so violations are reported but not blocked.",
                    $"Content-Security-Policy-Report-Only: {reportOnly}", "Enforce the policy via the Content-Security-Policy header once violations are resolved."));
        }
        else
        {
            findings.AddRange(AnalyzeCsp(csp, url));
        }

        // Clickjacking
        var xfo = h.Get("X-Frame-Options");
        var hasFrameAncestors = csp?.Contains("frame-ancestors", StringComparison.OrdinalIgnoreCase) == true;
        if (xfo is null && !hasFrameAncestors && r.IsHtml)
            findings.Add(F("clickjacking", "No clickjacking protection", Severity.Medium, "CWE-1021",
                "Neither X-Frame-Options nor CSP frame-ancestors is set, so the page can be framed by other sites.",
                null, "Add 'X-Frame-Options: DENY' (or SAMEORIGIN) or CSP 'frame-ancestors 'none''."));
        else if (xfo is not null && !hasFrameAncestors &&
                 !xfo.Trim().Equals("DENY", StringComparison.OrdinalIgnoreCase) && !xfo.Trim().Equals("SAMEORIGIN", StringComparison.OrdinalIgnoreCase))
            findings.Add(F("xfo-invalid", "X-Frame-Options has an ineffective value", Severity.Low, "CWE-1021",
                "Only DENY and SAMEORIGIN are supported by modern browsers; other values are ignored.",
                $"X-Frame-Options: {xfo}", "Use 'X-Frame-Options: DENY' or CSP frame-ancestors."));

        var xcto = h.Get("X-Content-Type-Options");
        if (!string.Equals(xcto?.Trim(), "nosniff", StringComparison.OrdinalIgnoreCase))
            findings.Add(F("xcto-missing", "X-Content-Type-Options: nosniff not set", Severity.Low, "CWE-693",
                "Browsers may MIME-sniff responses and execute content with an unexpected type.",
                xcto is null ? null : $"X-Content-Type-Options: {xcto}", "Add 'X-Content-Type-Options: nosniff'."));

        var referrer = h.Get("Referrer-Policy");
        if (referrer is null)
            findings.Add(F("referrer-missing", "Referrer-Policy header missing", Severity.Low, "CWE-200",
                "Without an explicit policy, older browsers send the full URL (including query strings) to other sites.",
                null, "Add 'Referrer-Policy: strict-origin-when-cross-origin' or stricter.", Confidence.Medium));
        else if (referrer.Contains("unsafe-url", StringComparison.OrdinalIgnoreCase) || referrer.Trim().Equals("no-referrer-when-downgrade", StringComparison.OrdinalIgnoreCase))
            findings.Add(F("referrer-weak", "Referrer-Policy leaks full URLs", Severity.Low, "CWE-200",
                "This policy sends full URLs, including paths and query strings, to third-party sites.",
                $"Referrer-Policy: {referrer}", "Use 'strict-origin-when-cross-origin', 'same-origin' or 'no-referrer'."));

        if (!h.Contains("Permissions-Policy") && r.IsHtml)
            findings.Add(F("permissions-missing", "Permissions-Policy header missing", Severity.Info, "CWE-693",
                "Powerful browser features (camera, geolocation, etc.) are not explicitly restricted.",
                null, "Add a Permissions-Policy that disables unused features, e.g. 'camera=(), microphone=(), geolocation=()'."));

        return findings;
    }

    private IEnumerable<Finding> AnalyzeCsp(string csp, Uri url)
    {
        var directives = csp.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(d => d.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            .Where(p => p.Length > 0)
            .GroupBy(p => p[0].ToLowerInvariant())
            .ToDictionary(g => g.Key, g => g.First().Skip(1).Select(v => v.ToLowerInvariant()).ToArray());

        var script = directives.GetValueOrDefault("script-src") ?? directives.GetValueOrDefault("default-src");
        var evidence = $"Content-Security-Policy: {csp}";
        if (script is null)
        {
            yield return FindingFactory.Create(Id, "csp-no-script-src", "CSP does not restrict scripts", Severity.Low, "CWE-693", url,
                "The policy has neither script-src nor default-src, so scripts from any origin are allowed.",
                evidence, "Add a default-src and script-src directive.");
            yield break;
        }

        var hasNonceOrHash = script.Any(v => v.StartsWith("'nonce-") || v.StartsWith("'sha"));
        if (script.Contains("'unsafe-inline'") && !hasNonceOrHash && !script.Contains("'strict-dynamic'"))
            yield return FindingFactory.Create(Id, "csp-unsafe-inline", "CSP allows inline scripts ('unsafe-inline')", Severity.Low, "CWE-693", url,
                "'unsafe-inline' without nonces or hashes lets injected inline scripts run, largely defeating CSP's XSS protection.",
                evidence, "Replace 'unsafe-inline' with nonces or hashes for required inline scripts.");
        if (script.Contains("'unsafe-eval'"))
            yield return FindingFactory.Create(Id, "csp-unsafe-eval", "CSP allows eval ('unsafe-eval')", Severity.Low, "CWE-693", url,
                "'unsafe-eval' permits string-to-code functions such as eval(), which widen the impact of injection bugs.",
                evidence, "Remove 'unsafe-eval' and refactor code that relies on eval/new Function.");
        if (script.Any(v => v is "*" or "http:" or "https:" or "data:"))
            yield return FindingFactory.Create(Id, "csp-wildcard", "CSP script source is overly broad", Severity.Low, "CWE-693", url,
                "The script source list includes a wildcard or whole scheme, allowing scripts from arbitrary hosts.",
                evidence, "List specific trusted origins, or use nonces with 'strict-dynamic'.");
    }

    private static long? ParseMaxAge(string hsts)
    {
        foreach (var part in hsts.Split(';', StringSplitOptions.TrimEntries))
        {
            if (!part.StartsWith("max-age", StringComparison.OrdinalIgnoreCase)) continue;
            var value = part.Split('=', 2).ElementAtOrDefault(1)?.Trim('"', ' ');
            return long.TryParse(value, out var v) ? v : null;
        }
        return null;
    }
}
