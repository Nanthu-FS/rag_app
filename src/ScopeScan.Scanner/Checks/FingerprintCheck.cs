using System.Text.RegularExpressions;
using ScopeScan.Core.Models;

namespace ScopeScan.Scanner.Checks;

/// <summary>Identifies technologies from the baseline response only (headers, cookie names, HTML). Sends no requests.</summary>
public sealed partial class FingerprintCheck : IScanCheck
{
    public string Id => "fingerprint";
    public string Name => "Technology fingerprint";

    private sealed record Rule(string Technology, string Category, Func<Signals, string?> Match);

    private sealed record Signals(Http.HeaderMap Headers, IReadOnlyList<string> CookieNames, string Html)
    {
        public string? H(string name) => Headers.Get(name);
    }

    private static readonly Rule[] Rules =
    [
        new("nginx", "Web server", s => Contains(s.H("Server"), "nginx")),
        new("Apache HTTP Server", "Web server", s => Contains(s.H("Server"), "apache")),
        new("Microsoft IIS", "Web server", s => Contains(s.H("Server"), "microsoft-iis")),
        new("LiteSpeed", "Web server", s => Contains(s.H("Server"), "litespeed")),
        new("Cloudflare", "CDN / WAF", s => s.H("CF-RAY") is not null ? "CF-RAY header" : Contains(s.H("Server"), "cloudflare")),
        new("Amazon CloudFront", "CDN", s => s.H("X-Amz-Cf-Id") is not null ? "X-Amz-Cf-Id header" : Contains(s.H("Via"), "cloudfront")),
        new("Fastly", "CDN", s => s.H("X-Served-By")?.Contains("cache-", StringComparison.OrdinalIgnoreCase) == true && s.H("X-Fastly-Request-ID") is not null ? "X-Fastly-Request-ID header" : null),
        new("Akamai", "CDN", s => s.H("X-Akamai-Transformed") is not null ? "X-Akamai-Transformed header" : null),
        new("Vercel", "Hosting", s => s.H("X-Vercel-Id") is not null ? "X-Vercel-Id header" : null),
        new("Netlify", "Hosting", s => s.H("X-NF-Request-ID") is not null ? "X-NF-Request-ID header" : Contains(s.H("Server"), "netlify")),
        new("PHP", "Language", s => Contains(s.H("X-Powered-By"), "php") ?? (s.CookieNames.Contains("PHPSESSID") ? "PHPSESSID cookie" : null)),
        new("ASP.NET", "Framework", s => Contains(s.H("X-Powered-By"), "asp.net") ?? (s.H("X-AspNet-Version") is not null ? "X-AspNet-Version header" : null)
            ?? (s.CookieNames.Any(c => c.StartsWith("ASP.NET_", StringComparison.OrdinalIgnoreCase) || c.StartsWith(".AspNetCore.", StringComparison.OrdinalIgnoreCase)) ? "ASP.NET cookie" : null)
            ?? (s.Html.Contains("__VIEWSTATE") ? "__VIEWSTATE field" : null)),
        new("Express", "Framework", s => Contains(s.H("X-Powered-By"), "express")),
        new("Java (Servlet)", "Language", s => s.CookieNames.Contains("JSESSIONID") ? "JSESSIONID cookie" : null),
        new("Django", "Framework", s => s.CookieNames.Contains("csrftoken") || s.Html.Contains("csrfmiddlewaretoken") ? "Django CSRF token" : null),
        new("Laravel", "Framework", s => s.CookieNames.Contains("laravel_session") ? "laravel_session cookie" : null),
        new("Ruby on Rails", "Framework", s => s.CookieNames.Any(c => c.StartsWith("_") && c.EndsWith("_session")) && s.Html.Contains("csrf-param") ? "Rails session cookie + csrf-param" : null),
        new("WordPress", "CMS", s => s.Html.Contains("/wp-content/") || s.Html.Contains("/wp-includes/") ? "wp-content paths" : null),
        new("Drupal", "CMS", s => s.H("X-Drupal-Cache") is not null ? "X-Drupal-Cache header" : s.Html.Contains("Drupal.settings") ? "Drupal.settings" : null),
        new("Joomla", "CMS", s => s.Html.Contains("/media/jui/") || s.Html.Contains("Joomla!") ? "Joomla assets" : null),
        new("Shopify", "E-commerce", s => s.H("X-ShopId") is not null || s.Html.Contains("cdn.shopify.com") ? "Shopify assets" : null),
        new("Next.js", "Frontend", s => s.Html.Contains("__NEXT_DATA__") || s.Html.Contains("/_next/") ? "__NEXT_DATA__ / _next assets" : null),
        new("Nuxt", "Frontend", s => s.Html.Contains("__NUXT__") || s.Html.Contains("/_nuxt/") ? "__NUXT__ / _nuxt assets" : null),
        new("Angular", "Frontend", s => NgVersionRegex().Match(s.Html) is { Success: true } m ? $"ng-version=\"{m.Groups[1].Value}\"" : null),
        new("React", "Frontend", s => s.Html.Contains("data-reactroot") || s.Html.Contains("react-dom") ? "React markers" : null),
        new("Vue.js", "Frontend", s => s.Html.Contains("data-v-") || s.Html.Contains("vue.runtime") || s.Html.Contains("vue.min.js") ? "Vue markers" : null),
        new("Google Analytics / Tag Manager", "Analytics", s => s.Html.Contains("googletagmanager.com") || s.Html.Contains("google-analytics.com") ? "Google tag script" : null),
    ];

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var r = await ctx.GetBaselineAsync();
        var cookieNames = r.Redirects.SelectMany(h => h.Headers.GetAll("Set-Cookie")).Concat(r.Headers.GetAll("Set-Cookie"))
            .Select(c => c.Split('=', 2)[0].Trim()).Where(n => n.Length > 0).Distinct().ToList();
        var html = r.IsHtml ? r.BodyText : "";
        var signals = new Signals(r.Headers, cookieNames, html);

        var detected = Rules.Select(rule => (rule, evidence: rule.Match(signals))).Where(x => x.evidence is not null).ToList();
        if (HtmlExtract.MetaGenerator(html) is { } generator)
            detected.Add((new Rule(generator, "Generator meta tag", _ => null), $"<meta name=\"generator\" content=\"{generator}\">"));

        if (detected.Count == 0) return [];
        return
        [
            FindingFactory.Create(Id, "technologies", "Technology fingerprint", Severity.Info, null, r.FinalUrl,
                "Technologies identified from response headers, cookie names and page markup. Listed for inventory; not a vulnerability by itself.",
                string.Join("\n", detected.Select(d => $"{d.rule.Technology} [{d.rule.Category}] - {d.evidence}")),
                "Review whether each disclosed component is up to date; minimise version disclosure.", Confidence.Medium),
        ];
    }

    private static string? Contains(string? header, string needle) =>
        header?.Contains(needle, StringComparison.OrdinalIgnoreCase) == true ? $"header value '{header}'" : null;

    [GeneratedRegex(@"ng-version=""([\d.]+)""")]
    private static partial Regex NgVersionRegex();
}
