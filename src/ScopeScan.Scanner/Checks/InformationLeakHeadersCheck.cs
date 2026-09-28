using System.Text.RegularExpressions;
using ScopeScan.Core.Models;

namespace ScopeScan.Scanner.Checks;

/// <summary>Flags response headers that disclose software names and versions.</summary>
public sealed partial class InformationLeakHeadersCheck : IScanCheck
{
    public string Id => "info-leak-headers";
    public string Name => "Information-leaking headers";

    private static readonly string[] AlwaysLeaky =
        ["X-Powered-By", "X-AspNet-Version", "X-AspNetMvc-Version", "X-Generator", "X-Runtime", "X-Version", "X-Backend-Server", "X-Debug-Token", "X-Debug-Token-Link"];

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var r = await ctx.GetBaselineAsync();
        var leaks = new List<string>();

        var server = r.Headers.Get("Server");
        if (server is not null && VersionRegex().IsMatch(server)) leaks.Add($"Server: {server}");
        foreach (var name in AlwaysLeaky)
            if (r.Headers.Get(name) is { } v) leaks.Add($"{name}: {v}");

        if (leaks.Count == 0) return [];

        var debug = leaks.Any(l => l.StartsWith("X-Debug", StringComparison.OrdinalIgnoreCase));
        return
        [
            FindingFactory.Create(Id, "version-disclosure",
                debug ? "Debug headers exposed" : "Server software and version disclosed in headers",
                debug ? Severity.Medium : Severity.Low, "CWE-200", r.FinalUrl,
                "Response headers reveal software or framework details that help attackers find known vulnerabilities for the exact versions in use.",
                string.Join("\n", leaks),
                "Remove or genericise these headers in the web server / framework configuration (e.g. 'server_tokens off', remove X-Powered-By)."),
        ];
    }

    [GeneratedRegex(@"\d+(\.\d+)+")]
    private static partial Regex VersionRegex();
}
