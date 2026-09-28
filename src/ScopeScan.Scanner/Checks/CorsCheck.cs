using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

/// <summary>Sends one GET with a benign, non-resolvable Origin and inspects the CORS response headers.</summary>
public sealed class CorsCheck : IScanCheck
{
    public const string ProbeOrigin = "https://scopescan-cors-probe.example";

    public string Id => "cors";
    public string Name => "CORS configuration";

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var r = await ctx.Http.SendAsync(new ScanHttpRequest(ctx.Target, "cors-probe")
        {
            FollowRedirects = true,
            Headers = new Dictionary<string, string> { ["Origin"] = ProbeOrigin },
            MaxBodyBytes = 1024,
        }, ct);

        var acao = r.Headers.Get("Access-Control-Allow-Origin")?.Trim();
        if (acao is null) return [];
        var credentials = string.Equals(r.Headers.Get("Access-Control-Allow-Credentials")?.Trim(), "true", StringComparison.OrdinalIgnoreCase);
        var evidence = $"Request Origin: {ProbeOrigin}\nAccess-Control-Allow-Origin: {acao}" +
                       (credentials ? "\nAccess-Control-Allow-Credentials: true" : "");

        if (acao.Equals(ProbeOrigin, StringComparison.OrdinalIgnoreCase))
        {
            return
            [
                credentials
                    ? FindingFactory.Create(Id, "reflected-origin-credentials", "CORS reflects arbitrary origins with credentials",
                        Severity.High, "CWE-942", r.FinalUrl,
                        "The server echoes an untrusted Origin and allows credentials, so any website a logged-in user visits could read authenticated responses from this endpoint.",
                        evidence, "Validate Origin against an explicit allowlist; never reflect it blindly when credentials are allowed.")
                    : FindingFactory.Create(Id, "reflected-origin", "CORS reflects arbitrary origins",
                        Severity.Low, "CWE-942", r.FinalUrl,
                        "The server echoes an untrusted Origin. Without credentials the impact is limited to data readable anonymously, but the policy is broader than intended.",
                        evidence, "Validate Origin against an explicit allowlist.", Confidence.Medium),
            ];
        }

        if (acao == "*" && credentials)
        {
            return
            [
                FindingFactory.Create(Id, "wildcard-credentials", "CORS wildcard combined with credentials",
                    Severity.Medium, "CWE-942", r.FinalUrl,
                    "Access-Control-Allow-Origin '*' together with Allow-Credentials 'true' is invalid and indicates a misconfigured policy; browsers will block credentialed reads, but the intent suggests origin handling is unsafe elsewhere.",
                    evidence, "Use an explicit origin allowlist when credentials are required.", Confidence.Medium),
            ];
        }

        if (acao.Equals("null", StringComparison.OrdinalIgnoreCase))
        {
            return
            [
                FindingFactory.Create(Id, "null-origin", "CORS allows the 'null' origin",
                    Severity.Medium, "CWE-942", r.FinalUrl,
                    "The 'null' origin can be produced by sandboxed iframes and local files, so allowing it lets untrusted content read responses.",
                    evidence, "Remove 'null' from allowed origins.", Confidence.Medium),
            ];
        }

        return [];
    }
}
