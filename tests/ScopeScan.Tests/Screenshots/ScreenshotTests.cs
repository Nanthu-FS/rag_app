using System.Buffers.Binary;
using Microsoft.Extensions.Time.Testing;
using ScopeScan.Core;
using ScopeScan.Core.Models;
using ScopeScan.Core.Storage;
using ScopeScan.Scanner;
using ScopeScan.Screenshots;
using ScopeScan.Tests.Scanner;

namespace ScopeScan.Tests.Screenshots;

/// <summary>One headless Chromium shared by all screenshot tests.</summary>
public sealed class BrowserFixture : IAsyncLifetime
{
    public PlaywrightScreenshotService Service { get; } = new(new ScreenshotOptions { Timeout = TimeSpan.FromSeconds(20) });
    public Task InitializeAsync() => Task.CompletedTask;
    public async Task DisposeAsync() => await Service.DisposeAsync();
}

public class ScreenshotTests(BrowserFixture browser) : IClassFixture<BrowserFixture>
{
    private const string Page = """
        HTTP/1.1 200 OK
        Content-Type: text/html; charset=utf-8
        Set-Cookie: sessionid=topsecretvalue; Path=/

        <!doctype html><html><head><title>Demo</title>
        <link rel="stylesheet" href="/site.css">
        <script src="/app.js"></script>
        </head><body style="margin:0">
        <h1 id="t">Hello from app.example.com</h1>
        <img src="https://tracker.other-site.net/pixel.png">
        <div style="height:1500px;background:linear-gradient(#fff,#39f)"></div>
        </body></html>
        """;

    private static (int W, int H) PngSize(byte[] png)
    {
        Assert.True(png.AsSpan(0, 8).SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }), "not a PNG");
        return (BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(16)), BinaryPrimitives.ReadInt32BigEndian(png.AsSpan(20)));
    }

    private static ScanHarness Harness()
    {
        var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", Page)
                 .OnRaw("/site.css", "HTTP/1.1 200 OK\nContent-Type: text/css\n\nh1{color:#c00}")
                 .OnRaw("/app.js", "HTTP/1.1 200 OK\nContent-Type: application/javascript\n\ndocument.title='js ran';");
        return h;
    }

    [Fact]
    public async Task FullPage_IsCapturedAt1366Wide_ThroughTheScopedClient()
    {
        using var h = Harness();
        var shot = await browser.Service.CaptureFullPageAsync(new Uri("https://app.example.com/"), h.Client);

        var (w, height) = PngSize(shot.Png);
        Assert.Equal(1366, w);
        Assert.True(height > 768, $"expected full-page height, got {height}");

        // In-scope subresources were fetched via the gatekeeper; the out-of-scope tracker was not.
        Assert.Contains("https://app.example.com/app.js", h.Handler.RequestedUrls);
        Assert.Contains("https://app.example.com/site.css", h.Handler.RequestedUrls);
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains("other-site.net"));
        Assert.Contains(shot.BlockedRequests, b => b.Contains("tracker.other-site.net"));
        Assert.Contains(h.Client.RequestLog, e => e.Purpose == "screenshot document");
        Assert.All(h.Handler.Requests, r => Assert.StartsWith("ScopeScan/", r.Headers.UserAgent.ToString()));
    }

    [Fact]
    public async Task OutOfScopeTarget_IsRefused()
    {
        using var h = Harness();
        await Assert.ThrowsAsync<OutOfScopeException>(() => browser.Service.CaptureFullPageAsync(new Uri("https://other.example.org/"), h.Client));
        Assert.Empty(h.Handler.Requests);
    }

    [Fact]
    public async Task RedirectOutOfScope_AbortsTheCapture()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", "HTTP/1.1 302 Found\nLocation: https://evil.example.net/\n\n");
        await Assert.ThrowsAsync<OutOfScopeException>(() => browser.Service.CaptureFullPageAsync(new Uri("https://app.example.com/"), h.Client));
        Assert.DoesNotContain(h.Handler.RequestedUrls, u => u.Contains("evil.example.net"));
    }

    [Fact]
    public async Task InScopeRedirect_IsFollowedByTheBrowser()
    {
        using var h = Harness();
        h.Handler.OnRaw("https://app.example.com/start", "HTTP/1.1 302 Found\nLocation: /\n\n");
        var shot = await browser.Service.CaptureFullPageAsync(new Uri("https://app.example.com/start"), h.Client);
        PngSize(shot.Png);
        Assert.Contains("https://app.example.com/", h.Handler.RequestedUrls);
    }

    [Fact]
    public async Task Reflection_HighlightsMarker()
    {
        using var h = new ScanHarness();
        const string marker = "scopescan123abc123p0";
        h.Handler.On(u => u.Contains("/search"), _ => Fixtures.Parse(
            $"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<html><body><p>You searched for {marker}</p></body></html>"));

        var shot = await browser.Service.CaptureReflectionAsync(new Uri($"https://app.example.com/search?q={marker}"), marker, h.Client);
        Assert.True(shot.MarkerFound);
        Assert.Equal((1366, 768), PngSize(shot.Png));
        await Assert.ThrowsAsync<ArgumentException>(() => browser.Service.CaptureReflectionAsync(new Uri("https://app.example.com/"), "<script>", h.Client));
    }

    [Fact]
    public async Task HeadersPanel_RendersOfflineAndRedactsCookies()
    {
        using var h = Harness();
        var baseline = await h.Context().GetBaselineAsync();
        var html = HeadersPanelRenderer.Render(baseline, DateTimeOffset.UnixEpoch);

        Assert.Contains("MISSING", html);
        Assert.Contains("sessionid=[REDACTED]", html);
        Assert.DoesNotContain("topsecretvalue", html);

        var before = h.Handler.Requests.Count;
        var png = await browser.Service.RenderHtmlAsync(html);
        Assert.Equal(1366, PngSize(png).W);
        Assert.Equal(before, h.Handler.Requests.Count);
    }

    [Fact]
    public void HeadersPanel_HtmlEncodesHeaderValues()
    {
        var headers = new ScopeScan.Scanner.Http.HeaderMap();
        headers.Add("Server", "<script>alert(1)</script>");
        var html = HeadersPanelRenderer.Render(new ScopeScan.Scanner.Http.ScanResponse
        {
            RequestedUrl = new Uri("https://app.example.com/"), FinalUrl = new Uri("https://app.example.com/"), StatusCode = 200, Headers = headers,
        }, DateTimeOffset.UnixEpoch);
        Assert.DoesNotContain("<script>alert", html);
        Assert.Contains("&lt;script&gt;", html);
    }

    [Fact]
    public async Task EvidenceCapture_SavesScreenshotsAndAttachesThemToFindings()
    {
        using var dir = new TempDir();
        var repo = new FileScanRepository(new FileStorageService(dir.Path), new FakeTimeProvider(DateTimeOffset.UnixEpoch));
        var scan = await repo.CreateAsync("https://app.example.com/", "app.example.com", true);

        using var h = Harness();
        const string marker = "scopescan123fff000p0";
        h.Handler.On(u => u.Contains("/search"), _ => Fixtures.Parse($"HTTP/1.1 200 OK\nContent-Type: text/html\n\n<p>{marker}</p>"));
        var ctx = new ScanContext(scan.Id, new Uri("https://app.example.com/"), h.Client);

        Finding F(string check, string id, string url, Severity s = Severity.Low) =>
            new(id, id, s, null, url, "d", null, [], "r", Confidence.High) { CheckId = check };
        var findings = new[]
        {
            F("security-headers", "security-headers.csp-missing", "https://app.example.com/", Severity.Medium),
            F("cookie-flags", "cookie-flags.httponly-missing.sessionid", "https://app.example.com/"),
            F("reflected-parameters", "reflected-parameters.search.q", $"https://app.example.com/search?q={marker}"),
            F("tls", "tls.cert-expired", "https://app.example.com/", Severity.High),
        };

        var result = await new EvidenceCapture(browser.Service, repo).CaptureAsync(ctx, findings);

        Assert.Empty(result.Errors);
        Assert.Equal(["screenshots/full-page.png", "screenshots/headers-summary.png"], result.ScanScreenshots);
        Assert.Equal(["screenshots/headers-summary.png"], result.Findings[0].ScreenshotPaths);
        Assert.Equal(["screenshots/headers-summary.png"], result.Findings[1].ScreenshotPaths);
        Assert.Equal(["screenshots/reflection-1.png"], result.Findings[2].ScreenshotPaths);
        Assert.Empty(result.Findings[3].ScreenshotPaths);
        foreach (var p in new[] { "full-page.png", "headers-summary.png", "reflection-1.png" })
            Assert.True(File.Exists(repo.GetScanFilePath(scan.Id, $"screenshots/{p}")), p);
    }

    [Fact]
    public async Task EvidenceCapture_RecordsFailuresWithoutThrowing()
    {
        using var dir = new TempDir();
        var repo = new FileScanRepository(new FileStorageService(dir.Path));
        var scan = await repo.CreateAsync("https://app.example.com/", "app.example.com", true);
        using var h = new ScanHarness { Scope = [] }; // nothing in scope -> capture refused
        var ctx = new ScanContext(scan.Id, new Uri("https://app.example.com/"), h.Client);

        var result = await new EvidenceCapture(browser.Service, repo).CaptureAsync(ctx, []);
        Assert.Empty(result.ScanScreenshots);
        Assert.Contains(result.Errors, e => e.Contains("not in scope"));
    }
}
