using System.Text.Json;
using System.Text.RegularExpressions;
using ScopeScan.Core.Models;
using ScopeScan.Core.Storage;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

public sealed record JsVulnerability(string? AtOrAbove, string Below, Severity Severity, IReadOnlyList<string> Identifiers, string Summary);

public sealed record JsLibrary(string Name, string DisplayName, IReadOnlyList<string> UrlPatterns, IReadOnlyList<string> ContentPatterns, IReadOnlyList<JsVulnerability> Vulnerabilities);

/// <summary>The bundled, offline vulnerability database (Data/js-vulnerabilities.json, embedded).</summary>
public sealed class JsVulnerabilityDatabase
{
    private sealed record Document(string Updated, IReadOnlyList<JsLibrary> Libraries);

    public string Updated { get; }
    public IReadOnlyList<JsLibrary> Libraries { get; }

    private JsVulnerabilityDatabase(Document doc) { Updated = doc.Updated; Libraries = doc.Libraries; }

    public static JsVulnerabilityDatabase Parse(string json) =>
        new(JsonSerializer.Deserialize<Document>(json, JsonDefaults.Options) ?? throw new InvalidDataException("Empty vulnerability database."));

    public static JsVulnerabilityDatabase LoadEmbedded()
    {
        using var stream = typeof(JsVulnerabilityDatabase).Assembly.GetManifestResourceStream("ScopeScan.Scanner.js-vulnerabilities.json")
            ?? throw new InvalidOperationException("Embedded js-vulnerabilities.json missing.");
        using var reader = new StreamReader(stream);
        return Parse(reader.ReadToEnd());
    }

    public static IReadOnlyList<JsVulnerability> Match(JsLibrary lib, string version) =>
        lib.Vulnerabilities.Where(v =>
            CompareVersions(version, v.Below) < 0 &&
            (v.AtOrAbove is null || CompareVersions(version, v.AtOrAbove) >= 0)).ToList();

    /// <summary>Numeric dotted comparison; pre-release/build suffixes are ignored.</summary>
    public static int CompareVersions(string a, string b)
    {
        static int[] Parts(string v) => v.Split('-', '+')[0].Split('.')
            .Select(p => int.TryParse(new string(p.TakeWhile(char.IsDigit).ToArray()), out var n) ? n : 0).ToArray();
        var pa = Parts(a);
        var pb = Parts(b);
        for (var i = 0; i < Math.Max(pa.Length, pb.Length); i++)
        {
            var c = (i < pa.Length ? pa[i] : 0).CompareTo(i < pb.Length ? pb[i] : 0);
            if (c != 0) return c;
        }
        return 0;
    }
}

/// <summary>
/// Detects client-side libraries from script URLs, inline version banners and the first few KB of
/// same-host scripts, then matches versions against the bundled database.
/// </summary>
public sealed class JsLibraryCheck(JsVulnerabilityDatabase db) : IScanCheck
{
    private const int MaxScriptFetches = 5;
    private const int ScriptHeadBytes = 4096;

    public string Id => "js-libraries";
    public string Name => "Outdated JavaScript libraries";

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var baseline = await ctx.GetBaselineAsync();
        if (!baseline.IsHtml) return [];

        // library name -> (version, where it was seen)
        var detected = new Dictionary<string, (JsLibrary Lib, string Version, string Source)>();
        void Record(JsLibrary lib, string version, string source) => detected.TryAdd(lib.Name, (lib, version, source));

        var scripts = HtmlExtract.ScriptSources(baseline.BodyText, baseline.FinalUrl).ToList();
        var unresolved = new List<Uri>();
        foreach (var src in scripts)
        {
            var hit = MatchAny(src.ToString(), l => l.UrlPatterns);
            if (hit is { } h) Record(h.Lib, h.Version, $"script URL {src}");
            else unresolved.Add(src);
        }

        foreach (var inline in HtmlExtract.InlineScripts(baseline.BodyText))
            if (MatchAny(inline, l => l.ContentPatterns) is { } h) Record(h.Lib, h.Version, "inline script banner");

        // Read the banner of a few same-host scripts whose URL did not reveal a version.
        foreach (var src in unresolved.Where(u => string.Equals(u.IdnHost, ctx.Target.IdnHost, StringComparison.OrdinalIgnoreCase)).Take(MaxScriptFetches))
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var r = await ctx.Http.SendAsync(new ScanHttpRequest(src, "js-banner") { MaxBodyBytes = ScriptHeadBytes, FollowRedirects = false }, ct);
                if (r.StatusCode == 200 && MatchAny(r.BodyText, l => l.ContentPatterns) is { } h)
                    Record(h.Lib, h.Version, $"banner in {src}");
            }
            catch (Exception ex) when (ex is HttpRequestException or TimeoutException) { }
        }

        var findings = new List<Finding>();
        foreach (var (lib, version, source) in detected.Values)
        {
            var vulns = JsVulnerabilityDatabase.Match(lib, version);
            if (vulns.Count == 0) continue;
            var ids = vulns.SelectMany(v => v.Identifiers).Distinct().ToList();
            var severity = vulns.Max(v => v.Severity);
            findings.Add(FindingFactory.Create(Id, lib.Name, $"Outdated {lib.DisplayName} {version} with known vulnerabilities",
                severity, "CWE-1395", baseline.FinalUrl,
                $"{lib.DisplayName} {version} is affected by: " + string.Join("; ", vulns.Select(v => $"{v.Summary} ({string.Join(", ", v.Identifiers)})")) +
                ". Exploitability depends on how the application uses the affected APIs; this finding is based on version only.",
                $"Detected via {source}\nAdvisories: {string.Join(", ", ids)} (database updated {db.Updated})",
                $"Upgrade {lib.DisplayName} to the latest supported release (at least {vulns.Select(v => v.Below).Max(Comparer<string>.Create(JsVulnerabilityDatabase.CompareVersions))}) and remove unused copies.",
                Confidence.High));
        }
        return findings;
    }

    private (JsLibrary Lib, string Version)? MatchAny(string text, Func<JsLibrary, IReadOnlyList<string>> patterns)
    {
        foreach (var lib in db.Libraries)
            foreach (var p in patterns(lib))
                if (Regex.Match(text, p, RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(200)) is { Success: true } m)
                    return (lib, m.Groups[1].Value);
        return null;
    }
}
