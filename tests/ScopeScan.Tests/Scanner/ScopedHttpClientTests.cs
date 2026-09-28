using System.Diagnostics;
using System.Net;
using ScopeScan.Core;
using ScopeScan.Scanner;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Tests.Scanner;

public class ScopedHttpClientTests
{
    private static HttpResponseMessage Redirect(string location, int status = 302) =>
        Fixtures.Parse($"HTTP/1.1 {status} Found\nLocation: {location}\n\n");

    private static ScanHttpRequest Get(string url) => new(new Uri(url), "test");

    [Fact]
    public async Task OutOfScope_IsRefusedWithoutSendingAnything()
    {
        using var h = new ScanHarness();
        await Assert.ThrowsAsync<OutOfScopeException>(() => h.Client.SendAsync(Get("https://other.example.org/")));
        Assert.Empty(h.Handler.Requests);
        Assert.Equal(0, h.Dns.Calls);
        Assert.StartsWith("blocked:", Assert.Single(h.Client.RequestLog).Error);
    }

    [Fact]
    public async Task RedirectLeavingScope_IsAborted()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", _ => Redirect("https://evil.example.net/steal"));
        await Assert.ThrowsAsync<OutOfScopeException>(() => h.Client.SendAsync(Get("https://app.example.com/")));
        Assert.Equal(["https://app.example.com/"], h.Handler.RequestedUrls);
    }

    [Fact]
    public async Task RedirectToNonHttpScheme_IsAborted()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", _ => Redirect("file:///etc/passwd"));
        await Assert.ThrowsAsync<OutOfScopeException>(() => h.Client.SendAsync(Get("https://app.example.com/")));
    }

    [Fact]
    public async Task InScopeRedirects_AreFollowedAndRecorded()
    {
        using var h = new ScanHarness { Scope = ["app.example.com", "*.example.com"] };
        h.Handler.On("http://app.example.com/", _ => Redirect("https://app.example.com/", 301))
                 .On("https://app.example.com/", _ => Redirect("/home"))
                 .On("https://app.example.com/home", "hardened.http");

        var r = await h.Client.SendAsync(Get("http://app.example.com/"));

        Assert.Equal(200, r.StatusCode);
        Assert.Equal("https://app.example.com/home", r.FinalUrl.ToString());
        Assert.Equal("http://app.example.com/", r.RequestedUrl.ToString());
        Assert.Equal([301, 302], r.Redirects.Select(x => x.StatusCode));
        Assert.Equal(3, h.Client.RequestLog.Count);
    }

    [Fact]
    public async Task RedirectsAreNotFollowedWhenDisabled()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", _ => Redirect("https://evil.example.net/"));
        var r = await h.Client.SendAsync(Get("https://app.example.com/") with { FollowRedirects = false });
        Assert.Equal(302, r.StatusCode);
        Assert.Single(h.Handler.Requests);
    }

    [Fact]
    public async Task RedirectLoop_IsCapped()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/a", _ => Redirect("/b")).On("https://app.example.com/b", _ => Redirect("/a"));
        await Assert.ThrowsAsync<RequestBlockedException>(() => h.Client.SendAsync(Get("https://app.example.com/a")));
        Assert.Equal(h.Options.MaxRedirects + 1, h.Handler.Requests.Count);
    }

    [Theory]
    [InlineData("127.0.0.1")]
    [InlineData("10.0.0.5")]
    [InlineData("169.254.169.254")]
    [InlineData("::1")]
    public async Task HostResolvingToPrivateAddress_IsBlocked(string ip)
    {
        using var h = new ScanHarness();
        h.Dns.Answers["app.example.com"] = [IPAddress.Parse(ip)];
        var ex = await Assert.ThrowsAsync<RequestBlockedException>(() => h.Client.SendAsync(Get("https://app.example.com/")));
        Assert.Contains("SSRF", ex.Message);
        Assert.Empty(h.Handler.Requests);
    }

    [Fact]
    public async Task MixedPublicAndPrivateAnswers_AreBlocked()
    {
        using var h = new ScanHarness();
        h.Dns.Answers["app.example.com"] = [IPAddress.Parse("93.184.216.34"), IPAddress.Parse("192.168.1.1")];
        await Assert.ThrowsAsync<RequestBlockedException>(() => h.Client.SendAsync(Get("https://app.example.com/")));
    }

    [Fact]
    public async Task Dns_IsResolvedOnceAndPinnedOnEveryRequest()
    {
        using var h = new ScanHarness();
        h.Dns.Answers["app.example.com"] = [IPAddress.Parse("198.51.99.7")];
        for (var i = 0; i < 3; i++) await h.Client.SendAsync(Get($"https://app.example.com/{i}"));

        Assert.Equal(1, h.Dns.Calls);
        Assert.All(h.Handler.Requests, r =>
        {
            Assert.True(r.Options.TryGetValue(PinnedSocketsHandlerFactory.PinnedAddressKey, out var pinned));
            Assert.Equal("198.51.99.7", pinned.ToString());
        });
    }

    [Fact]
    public async Task SetsScopeScanUserAgent_AndRefusesCredentialsAndUnsafeMethods()
    {
        using var h = new ScanHarness();
        await h.Client.SendAsync(Get("https://app.example.com/"));
        Assert.StartsWith("ScopeScan/", Assert.Single(h.Handler.Requests).Headers.UserAgent.ToString());

        await Assert.ThrowsAsync<RequestBlockedException>(() => h.Client.SendAsync(Get("https://app.example.com/") with
        {
            Headers = new Dictionary<string, string> { ["Cookie"] = "a=b" },
        }));
        await Assert.ThrowsAsync<RequestBlockedException>(() => h.Client.SendAsync(Get("https://app.example.com/") with { Method = HttpMethod.Post }));
        await Assert.ThrowsAsync<RequestBlockedException>(() => h.Client.SendAsync(Get("https://app.example.com/") with { Method = HttpMethod.Delete }));
    }

    [Fact]
    public async Task Body_IsTruncatedAtLimit()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/big", "HTTP/1.1 200 OK\nContent-Type: text/plain\n\n" + new string('x', 5000));
        var r = await h.Client.SendAsync(Get("https://app.example.com/big") with { MaxBodyBytes = 100 });
        Assert.Equal(100, r.Body.Length);
        Assert.True(r.BodyTruncated);
    }

    [Fact]
    public async Task SlowResponses_TimeOut()
    {
        using var h = new ScanHarness();
        h.Options.RequestTimeout = TimeSpan.FromMilliseconds(100);
        h.Handler.Delay = TimeSpan.FromSeconds(5);
        await Assert.ThrowsAsync<TimeoutException>(() => h.Client.SendAsync(Get("https://app.example.com/")));
        Assert.Equal("timeout", Assert.Single(h.Client.RequestLog).Error);
    }

    [Fact]
    public async Task RateLimiter_SpacesRequestsPerHost()
    {
        using var h = new ScanHarness();
        h.Options.MinRequestInterval = TimeSpan.FromMilliseconds(150);
        var sw = Stopwatch.StartNew();
        await Task.WhenAll(Enumerable.Range(0, 4).Select(i => h.Client.SendAsync(Get($"https://app.example.com/{i}"))));
        Assert.True(sw.ElapsedMilliseconds >= 440, $"elapsed {sw.ElapsedMilliseconds}ms");
    }

    [Fact]
    public void DefaultOptions_MatchSafetyPolicy()
    {
        var o = new ScannerOptions();
        Assert.Equal(TimeSpan.FromSeconds(10), o.RequestTimeout);
        Assert.Equal(TimeSpan.FromMilliseconds(500), o.MinRequestInterval); // 2 req/s
        Assert.Contains("ScopeScan", o.UserAgent);
    }

    [Fact]
    public void HostScanGuard_AllowsOneScanPerHost()
    {
        var guard = new HostScanGuard();
        Assert.True(guard.TryAcquire("app.example.com", out var lease));
        Assert.False(guard.TryAcquire("APP.example.com", out _));
        Assert.True(guard.TryAcquire("other.example.com", out var other));
        lease!.Dispose();
        lease.Dispose();
        Assert.True(guard.TryAcquire("app.example.com", out _));
        other!.Dispose();
    }

    [Fact]
    public async Task PinnedHandler_RefusesToConnectWithoutPin()
    {
        using var handler = PinnedSocketsHandlerFactory.Create(new ScannerOptions());
        using var client = new HttpClient(handler);
        var ex = await Assert.ThrowsAsync<HttpRequestException>(() => client.GetAsync("http://app.example.com/"));
        Assert.Contains("pinned", ex.InnerException?.Message ?? ex.Message);
    }

    [Fact]
    public void RobotsPolicy_HonorsLongestMatch()
    {
        var robots = RobotsPolicy.Parse("User-agent: *\nDisallow: /admin\nDisallow: /*.pdf$\nAllow: /admin/public\n\nUser-agent: Googlebot\nDisallow: /");
        Assert.False(robots.IsAllowed("/admin/users"));
        Assert.True(robots.IsAllowed("/admin/public/page"));
        Assert.False(robots.IsAllowed("/files/report.pdf"));
        Assert.True(robots.IsAllowed("/files/report.pdf?x=1"));
        Assert.True(robots.IsAllowed("/search?q=1"));
        Assert.False(RobotsPolicy.Parse("User-agent: ScopeScan\nDisallow: /\n").IsAllowed("/x"));
    }
}
