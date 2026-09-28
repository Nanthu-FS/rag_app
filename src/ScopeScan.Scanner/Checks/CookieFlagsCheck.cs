using System.Text.RegularExpressions;
using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;

namespace ScopeScan.Scanner.Checks;

/// <summary>Inspects Set-Cookie headers (including on redirect hops) for Secure, HttpOnly and SameSite. Cookie values are never stored.</summary>
public sealed partial class CookieFlagsCheck : IScanCheck
{
    public string Id => "cookie-flags";
    public string Name => "Cookie flags";

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var r = await ctx.GetBaselineAsync();
        var sources = r.Redirects.Select(h => (h.Url, h.Headers)).Append((r.FinalUrl, r.Headers));
        var findings = new List<Finding>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var (url, headers) in sources)
        {
            foreach (var raw in headers.GetAll("Set-Cookie"))
            {
                var cookie = ParsedCookie.Parse(raw);
                if (cookie is null || !seen.Add(cookie.Name)) continue;
                findings.AddRange(Evaluate(cookie, url, SecretRedactor.RedactSetCookie(raw)));
            }
        }
        return findings;
    }

    private IEnumerable<Finding> Evaluate(ParsedCookie c, Uri url, string evidence)
    {
        var sensitive = SessionNameRegex().IsMatch(c.Name);
        var slug = SlugRegex().Replace(c.Name.ToLowerInvariant(), "-");
        var what = sensitive ? "session-like cookie" : "cookie";

        if (!c.Secure && url.Scheme == Uri.UriSchemeHttps)
            yield return FindingFactory.Create(Id, $"secure-missing.{slug}", $"Cookie '{c.Name}' missing Secure flag",
                sensitive ? Severity.Medium : Severity.Low, "CWE-614", url,
                $"The {what} can be sent over unencrypted HTTP connections, where it may be intercepted.",
                evidence, "Set the Secure attribute on the cookie.");

        if (!c.HttpOnly)
            yield return FindingFactory.Create(Id, $"httponly-missing.{slug}", $"Cookie '{c.Name}' missing HttpOnly flag",
                sensitive ? Severity.Medium : Severity.Low, "CWE-1004", url,
                $"The {what} is readable from JavaScript, so an XSS bug could be used to steal it.",
                evidence, "Set the HttpOnly attribute unless client-side script genuinely needs the value.",
                sensitive ? Confidence.High : Confidence.Medium);

        if (c.SameSite is null)
            yield return FindingFactory.Create(Id, $"samesite-missing.{slug}", $"Cookie '{c.Name}' has no SameSite attribute",
                Severity.Low, "CWE-1275", url,
                "Without an explicit SameSite attribute the cookie relies on browser defaults, which vary, for CSRF protection.",
                evidence, "Set SameSite=Lax (or Strict) explicitly.", Confidence.Medium);
        else if (c.SameSite.Equals("none", StringComparison.OrdinalIgnoreCase) && !c.Secure)
            yield return FindingFactory.Create(Id, $"samesite-none-insecure.{slug}", $"Cookie '{c.Name}' uses SameSite=None without Secure",
                Severity.Medium, "CWE-1275", url,
                "SameSite=None cookies without Secure are rejected by modern browsers and are sent cross-site where accepted.",
                evidence, "Add the Secure attribute, or use SameSite=Lax/Strict.");
    }

    private sealed record ParsedCookie(string Name, bool Secure, bool HttpOnly, string? SameSite)
    {
        public static ParsedCookie? Parse(string header)
        {
            var parts = header.Split(';', StringSplitOptions.TrimEntries);
            var eq = parts[0].IndexOf('=');
            if (eq <= 0) return null;
            var attrs = parts.Skip(1).Select(p => p.Split('=', 2)).ToList();
            bool Has(string n) => attrs.Any(a => a[0].Equals(n, StringComparison.OrdinalIgnoreCase));
            var sameSite = attrs.FirstOrDefault(a => a[0].Equals("SameSite", StringComparison.OrdinalIgnoreCase))?.ElementAtOrDefault(1);
            return new ParsedCookie(parts[0][..eq].Trim(), Has("Secure"), Has("HttpOnly"), sameSite);
        }
    }

    [GeneratedRegex(@"sess|sid|auth|token|jwt|login|remember|csrf|xsrf", RegexOptions.IgnoreCase)]
    private static partial Regex SessionNameRegex();

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex SlugRegex();
}
