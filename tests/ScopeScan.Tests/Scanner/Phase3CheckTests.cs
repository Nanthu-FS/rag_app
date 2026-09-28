using System.Text;
using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;
using ScopeScan.Scanner;
using ScopeScan.Scanner.Checks;

namespace ScopeScan.Tests.Scanner;

public class ExposedFilesCheckTests
{
    [Fact]
    public async Task GitAndEnv_AreDetected_WithSecretsRedacted()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("/.git/HEAD", "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nref: refs/heads/main\n")
                 .On("/.env", "dotenv.http")
                 .On("/robots.txt", "robots.http")
                 .OnRaw("/.well-known/security.txt", "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nContact: mailto:security@example.com\n");

        var f = await h.Run(new ExposedFilesCheck());

        Assert.Equal(Severity.High, f.Has("git-head").Severity);
        var env = f.Has("dotenv");
        Assert.Equal(Severity.Critical, env.Severity);
        Assert.Contains("DB_PASSWORD=" + SecretRedactor.Mask, env.Evidence);
        Assert.DoesNotContain("Sup3rS3cret", env.Evidence);
        Assert.DoesNotContain("db.internal", env.Evidence);
        Assert.DoesNotContain("sk_live", env.Evidence);
        Assert.Contains("2 Disallow", f.Has("robots").Evidence);
        f.Lacks("security-txt-missing");
    }

    [Fact]
    public async Task SoftNotFoundPages_DoNotProduceFalsePositives()
    {
        using var h = new ScanHarness();
        foreach (var p in new[] { "/.git/HEAD", "/.env", "/backup.zip", "/.git/config", "/backup.sql" })
            h.Handler.OnRaw(p, "HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html><body>Page not found</body></html>");
        h.Handler.OnRaw("/wp-config.php.bak", "HTTP/1.1 302 Found\nLocation: /login\n\n");

        var f = await h.Run(new ExposedFilesCheck());
        Assert.All(f, x => Assert.Equal(Severity.Info, x.Severity));
        f.Has("security-txt-missing");
    }

    [Fact]
    public async Task BinaryArchives_DetectedBySignature_ContentNotRead()
    {
        using var h = new ScanHarness();
        h.Handler.On("/backup.zip", _ => new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new ByteArrayContent([.. "PK\u0003\u0004"u8, .. new byte[100_000]]),
        });
        var f = (await h.Run(new ExposedFilesCheck())).Has("backup-zip");
        Assert.Contains($"{ExposedFilesCheck.MaxBytes}+ bytes", f.Evidence);
    }

    [Fact]
    public async Task OnlyFixedListIsRequested_WithoutFollowingRedirects()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("/.env", "HTTP/1.1 301 Moved\nLocation: https://app.example.com/.env/\n\n");
        await h.Run(new ExposedFilesCheck());
        Assert.Equal(16, h.Handler.Requests.Count); // 13 probes + robots + sitemap + security.txt
        Assert.DoesNotContain("https://app.example.com/.env/", h.Handler.RequestedUrls);
    }
}

public class JsLibraryCheckTests
{
    private static readonly JsVulnerabilityDatabase Db = JsVulnerabilityDatabase.LoadEmbedded();

    [Fact]
    public async Task DetectsFromUrlInlineBannerAndSameHostScripts()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "app-page.http")
                 .On("/assets/vendor.js", "vendor-js.http")
                 .OnRaw("/assets/app.js?v=2", "HTTP/1.1 200 OK\nContent-Type: application/javascript\n\nconsole.log(1)");

        var f = await h.Run(new JsLibraryCheck(Db));

        var jq = f.Has("jquery");
        Assert.Contains("3.3.1", jq.Title);
        Assert.Contains("CVE-2019-11358", jq.Evidence);
        Assert.Contains("CVE-2020-11022", jq.Evidence);
        Assert.DoesNotContain("CVE-2015-9251", jq.Evidence);
        Assert.Contains("CVE-2019-8331", f.Has("bootstrap").Evidence);
        Assert.Equal(Severity.High, f.Has("handlebars").Severity);
        f.Lacks("lodash"); // 4.17.21 is patched

        // Third-party CDN scripts are identified by URL only, never fetched.
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains("jquery.com") || u.Contains("cdnjs"));
        Assert.Contains("https://app.example.com/assets/vendor.js", h.Handler.RequestedUrls);
    }

    [Theory]
    [InlineData("jquery", "1.12.4", 3)]
    [InlineData("jquery", "1.8.3", 4)]
    [InlineData("jquery", "3.5.0", 0)]
    [InlineData("bootstrap", "4.2.1", 1)]
    [InlineData("bootstrap", "4.3.1", 0)]
    [InlineData("angularjs", "1.8.2", 1)]
    [InlineData("dompurify", "3.0.5", 1)]
    [InlineData("dompurify", "3.1.3", 0)]
    public void VersionRanges(string lib, string version, int expected)
    {
        Assert.Equal(expected, JsVulnerabilityDatabase.Match(Db.Libraries.Single(l => l.Name == lib), version).Count);
    }

    [Theory]
    [InlineData("1.10.0", "1.9.0", 1)]
    [InlineData("3.0.0-beta1", "3.0.0", 0)]
    [InlineData("4.17", "4.17.0", 0)]
    public void CompareVersions_IsNumeric(string a, string b, int sign) =>
        Assert.Equal(sign, Math.Sign(JsVulnerabilityDatabase.CompareVersions(a, b)));
}

public class ReflectedParameterCheckTests
{
    [Fact]
    public async Task ReflectedMarker_IsReportedWithContext_AndOnlyInertMarkersSent()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "app-page.http")
                 .On("/robots.txt", "robots.http");
        var ctx = h.Context();
        // /search echoes q into the body and page into an attribute
        h.Handler.On(u => u.Contains("/search?"), req =>
        {
            var q = System.Web.HttpUtility.ParseQueryString(req.RequestUri!.Query);
            return Fixtures.Parse($"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html><body><h1>Results for {q["q"]}</h1><a data-page=\"{q["page"]}\">next</a></body></html>");
        });

        var f = await new ReflectedParameterCheck().RunAsync(ctx, CancellationToken.None);

        var q = f.Has("search.q");
        Assert.Equal(Severity.Low, q.Severity);
        Assert.Contains("HTML body", q.Title);
        Assert.Contains(ctx.Marker, q.AffectedUrl);
        Assert.Contains("HTML attribute", f.Has("search.page").Title);

        // Disallowed by robots.txt: /private/... must never be requested.
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains("/private/"));
        // External links are never probed.
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains("other.example.org"));
        // Every probe value is the alphanumeric marker only.
        var probes = h.Handler.Requests.Select(r => r.RequestUri!).Where(u => u.Query.Contains(ScanContext.MarkerPrefix)).ToList();
        Assert.NotEmpty(probes);
        Assert.All(probes, u => Assert.DoesNotMatch(@"[<>""'();]|%3C|%22|%27", u.Query));
    }

    [Fact]
    public async Task ScriptContext_IsMediumLowConfidence()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", "HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html></html>");
        h.Handler.On(u => u.Contains("scopescan="), req =>
            Fixtures.Parse($"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<script>var s = \"{System.Web.HttpUtility.ParseQueryString(req.RequestUri!.Query)["scopescan"]}\";</script>"));

        var f = Assert.Single(await h.Run(new ReflectedParameterCheck()));
        Assert.Equal(Severity.Medium, f.Severity);
        Assert.Equal(Confidence.Low, f.Confidence);
    }

    [Fact]
    public async Task NoReflection_NoFinding()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "hardened.http");
        Assert.Empty(await h.Run(new ReflectedParameterCheck()));
    }
}

public class OpenRedirectCheckTests
{
    [Fact]
    public async Task RedirectToMarker_IsReported_AndNeverFollowed()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "app-page.http");
        h.Handler.On(u => u.Contains("/login?"), req =>
        {
            var next = System.Web.HttpUtility.ParseQueryString(req.RequestUri!.Query)["next"];
            return Fixtures.Parse($"HTTP/1.1 302 Found\nLocation: {next}\n\n");
        });

        var f = (await h.Run(new OpenRedirectCheck())).Has("next");
        Assert.Equal(Severity.Medium, f.Severity);
        Assert.Equal("CWE-601", f.Cwe);
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains(OpenRedirectCheck.MarkerHost + "/"));
        Assert.All(h.Handler.RequestedUrls, u => Assert.StartsWith("https://app.example.com/", u));
    }

    [Fact]
    public async Task SafeRedirect_IsNotReported()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "app-page.http");
        h.Handler.On(u => u.Contains("/login?"), _ => Fixtures.Parse("HTTP/1.1 302 Found\nLocation: /account\n\n"));
        Assert.Empty(await h.Run(new OpenRedirectCheck()));
    }

    [Fact]
    public async Task NoRedirectParameters_SendsNoProbes()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "hardened.http");
        Assert.Empty(await h.Run(new OpenRedirectCheck()));
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains(OpenRedirectCheck.MarkerHost));
    }
}

public class FingerprintCheckTests
{
    [Fact]
    public async Task IdentifiesTechnologiesFromBaselineOnly()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "app-page.http");
        var f = Assert.Single(await h.Run(new FingerprintCheck()));

        Assert.Equal(Severity.Info, f.Severity);
        foreach (var tech in new[] { "nginx", "Cloudflare", "Express", "WordPress", "WordPress 5.8.1" })
            Assert.Contains(tech, f.Evidence);
        Assert.Single(h.Handler.Requests); // baseline only
    }

    [Fact]
    public async Task NothingRecognised_NoFinding()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", "HTTP/1.1 200 OK\nContent-Type: text/plain\n\nhello");
        Assert.Empty(await h.Run(new FingerprintCheck()));
    }
}
