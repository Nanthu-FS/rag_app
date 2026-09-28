using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Playwright;
using ScopeScan.Core;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Screenshots;

public sealed class ScreenshotOptions
{
    public int ViewportWidth { get; set; } = 1366;
    public int ViewportHeight { get; set; } = 768;
    public TimeSpan Timeout { get; set; } = TimeSpan.FromSeconds(20);
    /// <summary>Full-page captures are clipped to this height to keep files reasonable.</summary>
    public int MaxPageHeight { get; set; } = 8000;
    public int MaxResourceBytes { get; set; } = 5 * 1024 * 1024;
    /// <summary>Optional explicit Chromium path; otherwise Playwright's installed browser is used.</summary>
    public string? ExecutablePath { get; set; }
    public string UserAgent { get; set; } = new ScannerOptions().UserAgent;
}

public sealed record ScreenshotResult(byte[] Png, IReadOnlyList<string> BlockedRequests, bool MarkerFound = false);

public interface IScreenshotService
{
    /// <summary>Full-page capture of <paramref name="url"/>. Every browser request is fetched through <paramref name="http"/>.</summary>
    Task<ScreenshotResult> CaptureFullPageAsync(Uri url, IScanHttpClient http, CancellationToken ct = default);

    /// <summary>Loads a reflection probe URL and highlights occurrences of the inert marker before capturing the viewport.</summary>
    Task<ScreenshotResult> CaptureReflectionAsync(Uri probeUrl, string marker, IScanHttpClient http, CancellationToken ct = default);

    /// <summary>Renders trusted, locally generated HTML with all network access blocked.</summary>
    Task<byte[]> RenderHtmlAsync(string html, CancellationToken ct = default);
}

/// <summary>
/// Headless Chromium via Playwright. The browser never touches the network itself: every request is
/// intercepted and either aborted or fulfilled from <see cref="IScanHttpClient"/>, which applies the scope
/// gate, SSRF/DNS pinning, rate limit and timeout. Redirects are handed back to the browser so each hop
/// is re-checked. Cookies are stripped from responses.
/// </summary>
public sealed class PlaywrightScreenshotService(ScreenshotOptions options, ILogger<PlaywrightScreenshotService>? logger = null)
    : IScreenshotService, IAsyncDisposable
{
    private static readonly HashSet<string> BlockedResourceTypes = ["media", "font", "websocket", "eventsource", "manifest", "texttrack", "other"];
    private static readonly HashSet<string> DroppedResponseHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Set-Cookie", "Content-Encoding", "Content-Length", "Transfer-Encoding", "Connection", "Keep-Alive",
    };

    private readonly ILogger _logger = logger ?? NullLogger<PlaywrightScreenshotService>.Instance;
    private readonly SemaphoreSlim _launchLock = new(1, 1);
    private IPlaywright? _playwright;
    private IBrowser? _browser;

    public async Task<ScreenshotResult> CaptureFullPageAsync(Uri url, IScanHttpClient http, CancellationToken ct = default)
    {
        await using var session = await OpenAsync(http, ct);
        await session.NavigateAsync(url);
        var height = await session.Page.EvaluateAsync<int>("() => Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)");
        var png = await session.Page.ScreenshotAsync(new PageScreenshotOptions
        {
            FullPage = true,
            Type = ScreenshotType.Png,
            Timeout = (float)options.Timeout.TotalMilliseconds,
            Clip = height > options.MaxPageHeight ? new Clip { X = 0, Y = 0, Width = options.ViewportWidth, Height = options.MaxPageHeight } : null,
        });
        return new ScreenshotResult(png, session.Blocked.ToArray());
    }

    public async Task<ScreenshotResult> CaptureReflectionAsync(Uri probeUrl, string marker, IScanHttpClient http, CancellationToken ct = default)
    {
        if (!System.Text.RegularExpressions.Regex.IsMatch(marker, "^[a-z0-9]{6,64}$"))
            throw new ArgumentException("Marker must be an inert alphanumeric string.", nameof(marker));

        await using var session = await OpenAsync(http, ct);
        await session.NavigateAsync(probeUrl);
        var found = await session.Page.EvaluateAsync<bool>("""
            (marker) => {
              const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
              const hits = [];
              while (walker.nextNode()) if (walker.currentNode.nodeValue.includes(marker)) hits.push(walker.currentNode);
              for (const node of hits) {
                const idx = node.nodeValue.indexOf(marker);
                const range = document.createRange();
                range.setStart(node, idx); range.setEnd(node, idx + marker.length);
                const mark = document.createElement('mark');
                mark.setAttribute('style', 'background:#ffeb3b;outline:3px solid #d32f2f;color:#000;padding:0 2px');
                range.surroundContents(mark);
              }
              const inAttr = [...document.querySelectorAll('*')].filter(el => [...el.attributes].some(a => a.value.includes(marker)));
              inAttr.forEach(el => el.style.outline = '3px dashed #d32f2f');
              const first = document.querySelector('mark') || inAttr[0];
              if (first) first.scrollIntoView({ block: 'center' });
              const banner = document.createElement('div');
              banner.textContent = 'ScopeScan evidence: inert marker "' + marker + '" ' + ((hits.length || inAttr.length) ? 'highlighted' : 'not visible in rendered DOM');
              banner.setAttribute('style', 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#d32f2f;color:#fff;font:bold 14px sans-serif;padding:6px 10px');
              document.documentElement.appendChild(banner);
              return hits.length + inAttr.length > 0;
            }
            """, marker);
        var png = await session.Page.ScreenshotAsync(new PageScreenshotOptions { Type = ScreenshotType.Png, Timeout = (float)options.Timeout.TotalMilliseconds });
        return new ScreenshotResult(png, session.Blocked.ToArray(), found);
    }

    public async Task<byte[]> RenderHtmlAsync(string html, CancellationToken ct = default)
    {
        var browser = await GetBrowserAsync(ct);
        await using var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = options.ViewportWidth, Height = options.ViewportHeight },
            JavaScriptEnabled = false,
            ServiceWorkers = ServiceWorkerPolicy.Block,
        });
        await context.RouteAsync("**/*", route => route.AbortAsync("blockedbyclient"));
        var page = await context.NewPageAsync();
        await page.SetContentAsync(html, new PageSetContentOptions { Timeout = (float)options.Timeout.TotalMilliseconds });
        return await page.ScreenshotAsync(new PageScreenshotOptions { FullPage = true, Type = ScreenshotType.Png });
    }

    private async Task<Session> OpenAsync(IScanHttpClient http, CancellationToken ct)
    {
        var browser = await GetBrowserAsync(ct);
        var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            ViewportSize = new ViewportSize { Width = options.ViewportWidth, Height = options.ViewportHeight },
            UserAgent = options.UserAgent,
            IgnoreHTTPSErrors = true,
            AcceptDownloads = false,
            ServiceWorkers = ServiceWorkerPolicy.Block,
        });
        context.SetDefaultTimeout((float)options.Timeout.TotalMilliseconds);
        var session = new Session(context, await context.NewPageAsync(), options);
        await context.RouteAsync("**/*", route => HandleRouteAsync(route, http, session, ct));
        return session;
    }

    private async Task HandleRouteAsync(IRoute route, IScanHttpClient http, Session session, CancellationToken ct)
    {
        var request = route.Request;
        var isNavigation = request.IsNavigationRequest && request.Frame == session.Page.MainFrame;
        try
        {
            if (!Uri.TryCreate(request.Url, UriKind.Absolute, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
                throw new RequestBlockedException($"Scheme not allowed: {request.Url}");
            if (request.Method is not ("GET" or "HEAD"))
                throw new RequestBlockedException($"Method {request.Method} not allowed.");
            if (BlockedResourceTypes.Contains(request.ResourceType))
            {
                await route.AbortAsync("blockedbyclient");
                return;
            }

            var headers = new Dictionary<string, string>();
            if (request.Headers.TryGetValue("accept", out var accept)) headers["Accept"] = accept;
            // Chromium does not re-intercept a fulfilled 3xx, so redirects never reach the browser:
            // sub-resources follow them inside the scoped client (each hop scope-checked), and main-frame
            // navigations hand the Location back to the session, which navigates to it through this route.
            var response = await http.SendAsync(new ScanHttpRequest(uri, $"screenshot {request.ResourceType}")
            {
                Method = request.Method == "HEAD" ? HttpMethod.Head : HttpMethod.Get,
                FollowRedirects = !isNavigation,
                MaxBodyBytes = options.MaxResourceBytes,
                Headers = headers,
            }, ct);

            if (isNavigation && response.IsRedirect && response.Headers.Get("Location") is { } location && Uri.TryCreate(uri, location, out var next))
            {
                session.PendingRedirect = next;
                await route.FulfillAsync(new RouteFulfillOptions { Status = 200, ContentType = "text/html", Body = "" });
                return;
            }

            var responseHeaders = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var name in response.Headers.Names.Where(n => !DroppedResponseHeaders.Contains(n)))
                responseHeaders[name] = string.Join(", ", response.Headers.GetAll(name));

            await route.FulfillAsync(new RouteFulfillOptions { Status = response.StatusCode, Headers = responseHeaders, BodyBytes = response.Body });
        }
        catch (Exception ex) when (ex is RequestBlockedException or TimeoutException or HttpRequestException or OperationCanceledException)
        {
            session.Blocked.Enqueue($"{request.Url} ({ex.Message})");
            if (isNavigation && ex is RequestBlockedException rb) session.NavigationBlocked ??= rb;
            _logger.LogDebug("Screenshot request blocked: {Url}: {Reason}", request.Url, ex.Message);
            try { await route.AbortAsync("blockedbyclient"); } catch (PlaywrightException) { }
        }
    }

    private async Task<IBrowser> GetBrowserAsync(CancellationToken ct)
    {
        if (_browser is { IsConnected: true }) return _browser;
        await _launchLock.WaitAsync(ct);
        try
        {
            if (_browser is { IsConnected: true }) return _browser;
            _playwright ??= await Playwright.CreateAsync();
            _browser = await _playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
            {
                Headless = true,
                ExecutablePath = options.ExecutablePath,
                Timeout = (float)options.Timeout.TotalMilliseconds,
                // Defence in depth: even if interception failed, Chromium could not resolve or reach anything.
                Args = ["--host-resolver-rules=MAP * ~NOTFOUND", "--proxy-server=http://0.0.0.0:0", "--disable-background-networking", "--disable-sync", "--no-first-run"],
            });
            return _browser;
        }
        finally { _launchLock.Release(); }
    }

    public async ValueTask DisposeAsync()
    {
        if (_browser is not null) await _browser.DisposeAsync();
        _playwright?.Dispose();
    }

    private sealed class Session(IBrowserContext context, IPage page, ScreenshotOptions options) : IAsyncDisposable
    {
        public IPage Page { get; } = page;
        public ConcurrentQueue<string> Blocked { get; } = new();
        public RequestBlockedException? NavigationBlocked { get; set; }
        public Uri? PendingRedirect { get; set; }

        public async Task NavigateAsync(Uri url)
        {
            var maxHops = new ScannerOptions().MaxRedirects;
            for (var hop = 0; ; hop++)
            {
                PendingRedirect = null;
                try
                {
                    await Page.GotoAsync(url.ToString(), new PageGotoOptions { WaitUntil = WaitUntilState.Load, Timeout = (float)options.Timeout.TotalMilliseconds });
                }
                catch (TimeoutException)
                {
                    // Slow sub-resources (rate-limited to 2 req/s): capture whatever has rendered.
                }
                catch (PlaywrightException) when (NavigationBlocked is not null)
                {
                    throw NavigationBlocked;
                }
                if (NavigationBlocked is not null) throw NavigationBlocked;
                if (PendingRedirect is null) return;
                if (hop >= maxHops) throw new RequestBlockedException($"Too many redirects (>{maxHops}) starting at {url}.");
                url = PendingRedirect;
            }
        }

        public ValueTask DisposeAsync() => new(context.CloseAsync());
    }
}
