using System.Text;
using System.Text.RegularExpressions;
using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

/// <summary>
/// Safe GETs for a small, fixed list of well-known files. Detects existence via content signatures
/// (to avoid soft-404 false positives), reads at most a few KB, and never stores file contents:
/// evidence is a short, redacted description of what matched.
/// </summary>
public sealed partial class ExposedFilesCheck : IScanCheck
{
    public const int MaxBytes = 4096;

    public string Id => "exposed-files";
    public string Name => "Exposed files";

    private sealed record Probe(string Path, string Code, string Title, Severity Severity, string Cwe,
        Func<ScanResponse, string?> Detect, string Description, string Remediation);

    private static readonly Probe[] Probes =
    [
        new("/.git/HEAD", "git-head", "Git repository metadata exposed (.git/HEAD)", Severity.High, "CWE-527",
            r => GitHeadRegex().IsMatch(Text(r)) ? "Content starts with a Git ref: " + Snip(Text(r).Split('\n')[0]) : null,
            "The .git directory is web-accessible. Attackers can often reconstruct source code, history and embedded secrets.",
            "Block access to /.git (and other VCS folders) at the web server, and remove them from the deployed web root."),
        new("/.git/config", "git-config", "Git configuration exposed (.git/config)", Severity.High, "CWE-527",
            r => Text(r).Contains("[core]") ? "Content contains a [core] section" + (Text(r).Contains("[remote") ? " and remote definitions" : "") : null,
            "The Git config is web-accessible, confirming an exposed repository and possibly revealing remote URLs.",
            "Block access to /.git at the web server and remove it from the web root."),
        new("/.svn/entries", "svn-entries", "Subversion metadata exposed (.svn/entries)", Severity.Medium, "CWE-527",
            r => SvnRegex().IsMatch(Text(r)) ? "Content matches the SVN entries format" : null,
            "Subversion metadata is web-accessible and may reveal file names and source history.",
            "Block access to /.svn and remove it from the web root."),
        new("/.env", "dotenv", "Environment file exposed (.env)", Severity.High, "CWE-538",
            DetectEnv,
            "A .env file is web-accessible. These files typically hold database credentials, API keys and other secrets. Values were not stored by ScopeScan.",
            "Remove the file from the web root, block dotfiles at the web server, and rotate every secret it contained."),
        new("/.DS_Store", "ds-store", "macOS .DS_Store file exposed", Severity.Low, "CWE-538",
            r => r.Body.AsSpan().StartsWith("\0\0\0\u0001Bud1"u8) ? "Binary .DS_Store signature (Bud1)" : null,
            ".DS_Store files list directory contents and can reveal hidden file names.",
            "Delete .DS_Store files from the deployment and block them at the web server."),
        new("/backup.zip", "backup-zip", "Backup archive exposed (backup.zip)", Severity.High, "CWE-530",
            r => r.Body.AsSpan().StartsWith("PK\u0003\u0004"u8) ? "ZIP archive signature (PK\\x03\\x04); content not downloaded" : null,
            "A backup archive is downloadable and may contain source code, configuration or data.",
            "Remove backup files from the web root and store backups outside publicly served paths."),
        new("/backup.tar.gz", "backup-targz", "Backup archive exposed (backup.tar.gz)", Severity.High, "CWE-530",
            r => r.Body.Length > 2 && r.Body[0] == 0x1f && r.Body[1] == 0x8b ? "GZIP signature (\\x1f\\x8b); content not downloaded" : null,
            "A backup archive is downloadable and may contain source code, configuration or data.",
            "Remove backup files from the web root and store backups outside publicly served paths."),
        new("/backup.sql", "backup-sql", "Database dump exposed (backup.sql)", Severity.Critical, "CWE-530",
            r => SqlDumpRegex().IsMatch(Text(r)) ? "Content contains SQL dump statements (CREATE TABLE / INSERT INTO)" : null,
            "A database dump is downloadable. It may contain user records and credentials.",
            "Remove the dump immediately, investigate access logs, and treat the data as potentially exposed."),
        new("/web.config.bak", "webconfig-bak", "Configuration backup exposed (web.config.bak)", Severity.High, "CWE-530",
            r => Text(r).Contains("<configuration", StringComparison.OrdinalIgnoreCase) ? "Content is an XML <configuration> document" : null,
            "A backup of the ASP.NET configuration is served as plain text and may include connection strings and keys.",
            "Delete backup copies from the web root and rotate any secrets they contained."),
        new("/wp-config.php.bak", "wpconfig-bak", "WordPress configuration backup exposed", Severity.Critical, "CWE-530",
            r => Text(r).Contains("DB_PASSWORD") || Text(r).Contains("<?php") ? "Content is PHP source (served unparsed)" : null,
            "A backup of wp-config.php is served as source, typically exposing database credentials and auth salts.",
            "Delete the backup, rotate DB credentials and WordPress salts."),
        new("/config.php.bak", "configphp-bak", "PHP configuration backup exposed", Severity.High, "CWE-530",
            r => Text(r).Contains("<?php") ? "Content is PHP source (served unparsed)" : null,
            "A PHP configuration backup is served as source code and may contain credentials.",
            "Delete backup files from the web root and rotate any secrets they contained."),
        new("/phpinfo.php", "phpinfo", "phpinfo() page exposed", Severity.Medium, "CWE-200",
            r => Text(r).Contains("PHP Version") && Text(r).Contains("phpinfo", StringComparison.OrdinalIgnoreCase) ? "Page contains phpinfo() output" : null,
            "phpinfo() output reveals PHP version, modules, paths and environment variables.",
            "Remove phpinfo pages from production."),
        new("/server-status", "server-status", "Apache server-status exposed", Severity.Medium, "CWE-200",
            r => Text(r).Contains("Apache Server Status") ? "Page title is 'Apache Server Status'" : null,
            "mod_status output reveals client IPs, requested URLs and server internals.",
            "Restrict /server-status to localhost or disable mod_status."),
    ];

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        var findings = new List<Finding>();
        var origin = new Uri(ctx.Target.GetLeftPart(UriPartial.Authority));

        foreach (var probe in Probes)
        {
            ct.ThrowIfCancellationRequested();
            var url = new Uri(origin, probe.Path);
            ScanResponse r;
            try
            {
                r = await ctx.Http.SendAsync(new ScanHttpRequest(url, $"exposed-file {probe.Path}") { FollowRedirects = false, MaxBodyBytes = MaxBytes }, ct);
            }
            catch (Exception ex) when (ex is HttpRequestException or TimeoutException) { continue; }

            if (r.StatusCode != 200 || r.IsHtml && probe.Code is not ("phpinfo" or "server-status")) continue;
            var signal = probe.Detect(r);
            if (signal is null) continue;

            var severity = probe.Code == "dotenv" && SecretKeyRegex().IsMatch(Text(r)) ? Severity.Critical : probe.Severity;
            findings.Add(FindingFactory.Create(Id, probe.Code, probe.Title, severity, probe.Cwe, url, probe.Description,
                $"GET {probe.Path} -> HTTP 200 ({r.Body.Length}{(r.BodyTruncated ? "+" : "")} bytes read)\n{signal}", probe.Remediation));
        }

        findings.AddRange(await InformationalFilesAsync(ctx, origin, ct));
        return findings;
    }

    private async Task<IEnumerable<Finding>> InformationalFilesAsync(ScanContext ctx, Uri origin, CancellationToken ct)
    {
        var findings = new List<Finding>();

        var robots = await ctx.GetRobotsResponseAsync();
        if (robots is { StatusCode: 200, IsHtml: false } && robots.BodyText.Contains("user-agent", StringComparison.OrdinalIgnoreCase))
        {
            var policy = await ctx.GetRobotsAsync();
            findings.Add(FindingFactory.Create(Id, "robots", "robots.txt present", Severity.Info, "CWE-200", robots.FinalUrl,
                "robots.txt is public. Disallow rules are not access control and can point attackers at sensitive paths; review them.",
                $"{policy.DisallowCount} Disallow rule(s) apply to all crawlers.",
                "Ensure no Disallow entry is the only protection for a sensitive path."));
        }

        var sitemap = await TryGetAsync(ctx, new Uri(origin, "/sitemap.xml"), ct);
        if (sitemap is { StatusCode: 200 } && SitemapRegex().IsMatch(Text(sitemap)))
            findings.Add(FindingFactory.Create(Id, "sitemap", "sitemap.xml present", Severity.Info, null, sitemap.FinalUrl,
                "A sitemap is published. This is normal; it is listed for completeness of the attack-surface inventory.",
                "GET /sitemap.xml -> HTTP 200", "No action needed."));

        var sec = await TryGetAsync(ctx, new Uri(origin, "/.well-known/security.txt"), ct);
        if (sec is not { StatusCode: 200 } || !Text(sec).Contains("Contact:", StringComparison.OrdinalIgnoreCase))
            findings.Add(FindingFactory.Create(Id, "security-txt-missing", "No security.txt published", Severity.Info, null,
                new Uri(origin, "/.well-known/security.txt"),
                "There is no RFC 9116 security.txt, so researchers have no documented way to report vulnerabilities.",
                sec is null ? null : $"GET /.well-known/security.txt -> HTTP {sec.StatusCode}",
                "Publish /.well-known/security.txt with Contact and Expires fields."));
        return findings;
    }

    private static async Task<ScanResponse?> TryGetAsync(ScanContext ctx, Uri url, CancellationToken ct)
    {
        try
        {
            return await ctx.Http.SendAsync(new ScanHttpRequest(url, $"exposed-file {url.AbsolutePath}") { FollowRedirects = false, MaxBodyBytes = MaxBytes }, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TimeoutException) { return null; }
    }

    private static string? DetectEnv(ScanResponse r)
    {
        var keys = Text(r).Split('\n')
            .Select(l => EnvLineRegex().Match(l.Trim()))
            .Where(m => m.Success)
            .Select(m => m.Groups["key"].Value)
            .Distinct()
            .ToList();
        if (keys.Count < 2) return null;
        // Only key names are kept; every value is replaced.
        return "Variables found (values redacted):\n" + string.Join("\n", keys.Take(12).Select(k => $"{k}={SecretRedactor.Mask}")) +
               (keys.Count > 12 ? $"\n… and {keys.Count - 12} more" : "");
    }

    private static string Text(ScanResponse r) => Encoding.UTF8.GetString(r.Body);
    private static string Snip(string s) => s.Length > 60 ? s[..60] : s;

    [GeneratedRegex(@"^(ref: refs/|[0-9a-f]{40}\s*$)")]
    private static partial Regex GitHeadRegex();

    [GeneratedRegex(@"^(\d+\s*\n|<\?xml[^>]*>\s*<wc-entries)")]
    private static partial Regex SvnRegex();

    [GeneratedRegex(@"(CREATE TABLE|INSERT INTO|-- (MySQL|PostgreSQL) (database )?dump)", RegexOptions.IgnoreCase)]
    private static partial Regex SqlDumpRegex();

    [GeneratedRegex(@"<urlset|<sitemapindex", RegexOptions.IgnoreCase)]
    private static partial Regex SitemapRegex();

    [GeneratedRegex(@"^(export\s+)?(?<key>[A-Za-z_][A-Za-z0-9_]*)\s*=")]
    private static partial Regex EnvLineRegex();

    [GeneratedRegex(@"^(export\s+)?[A-Za-z0-9_]*(PASSWORD|SECRET|TOKEN|API_?KEY|PRIVATE)[A-Za-z0-9_]*\s*=\s*\S+", RegexOptions.IgnoreCase | RegexOptions.Multiline)]
    private static partial Regex SecretKeyRegex();
}
