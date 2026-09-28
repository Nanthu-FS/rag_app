using System.Net;
using System.Text;
using ScopeScan.Core.Evidence;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Screenshots;

/// <summary>Builds a self-contained HTML "headers summary" panel from captured response data (rendered offline, no network).</summary>
public static class HeadersPanelRenderer
{
    public static readonly string[] SecurityHeaders =
    [
        "Content-Security-Policy", "Strict-Transport-Security", "X-Frame-Options",
        "X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy",
    ];

    private static readonly string[] LeakyHeaders = ["Server", "X-Powered-By", "X-AspNet-Version", "X-AspNetMvc-Version", "X-Generator"];

    public static string Render(ScanResponse response, DateTimeOffset capturedAt)
    {
        static string E(string s) => WebUtility.HtmlEncode(s);
        var sb = new StringBuilder();
        sb.Append("""
            <!doctype html><html><head><meta charset="utf-8"><style>
            body{font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:24px;background:#f6f7f9;color:#1d232b}
            .card{background:#fff;border:1px solid #d9dee5;border-radius:8px;padding:20px 24px;margin-bottom:16px}
            h1{font-size:18px;margin:0 0 4px} .meta{color:#5c6773;font-size:12px;margin-bottom:12px;word-break:break-all}
            h2{font-size:14px;margin:0 0 10px;text-transform:uppercase;letter-spacing:.04em;color:#5c6773}
            table{border-collapse:collapse;width:100%} td,th{text-align:left;padding:6px 8px;border-top:1px solid #eef0f3;vertical-align:top}
            th{width:260px;font-weight:600} td{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;word-break:break-all}
            .ok{color:#137333;font-weight:600} .missing{color:#b3261e;font-weight:600} .warn{color:#9a6700;font-weight:600}
            </style></head><body>
            """);
        sb.Append($"<div class=\"card\"><h1>Response headers summary</h1><div class=\"meta\">GET {E(response.FinalUrl.ToString())} &rarr; HTTP {response.StatusCode} &middot; captured {capturedAt:yyyy-MM-dd HH:mm} UTC by ScopeScan</div>");

        sb.Append("<h2>Security headers</h2><table>");
        foreach (var name in SecurityHeaders)
        {
            var value = response.Headers.Get(name);
            sb.Append($"<tr><th>{E(name)}</th><td>{(value is null ? "<span class=\"missing\">MISSING</span>" : $"<span class=\"ok\">present</span> {E(SecretRedactor.Redact(value, 300))}")}</td></tr>");
        }
        sb.Append("</table></div>");

        var leaks = LeakyHeaders.Select(n => (n, v: response.Headers.Get(n))).Where(x => x.v is not null).ToList();
        if (leaks.Count > 0)
        {
            sb.Append("<div class=\"card\"><h2>Information-disclosing headers</h2><table>");
            foreach (var (n, v) in leaks) sb.Append($"<tr><th>{E(n)}</th><td><span class=\"warn\">{E(SecretRedactor.Redact(v, 200))}</span></td></tr>");
            sb.Append("</table></div>");
        }

        var cookies = response.Redirects.SelectMany(h => h.Headers.GetAll("Set-Cookie")).Concat(response.Headers.GetAll("Set-Cookie")).ToList();
        if (cookies.Count > 0)
        {
            sb.Append("<div class=\"card\"><h2>Set-Cookie (values redacted)</h2><table>");
            foreach (var c in cookies.Take(20)) sb.Append($"<tr><td>{E(SecretRedactor.RedactSetCookie(c))}</td></tr>");
            sb.Append("</table></div>");
        }

        sb.Append("</body></html>");
        return sb.ToString();
    }
}
