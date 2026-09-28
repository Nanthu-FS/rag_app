using System.Collections.Concurrent;
using System.Net;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;
using ScopeScan.Core;
using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;
using ScopeScan.Core.Scope;

namespace ScopeScan.Scanner.Http;

/// <summary>
/// Per-scan gatekeeper for all target traffic: scope gate on every request and redirect hop,
/// DNS resolved once per host and pinned, private addresses refused, per-host rate limit,
/// fixed timeout, bounded body reads and a request log for the report appendix.
/// </summary>
public sealed class ScopedHttpClient : IScanHttpClient, IDisposable
{
    private static readonly HashSet<string> ForbiddenHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Cookie", "Authorization", "Proxy-Authorization", "Host", "User-Agent",
    };

    private readonly IScopeGate _scope;
    private readonly IDnsResolver _dns;
    private readonly HostRateLimiter _rateLimiter;
    private readonly ITlsHandshaker _tls;
    private readonly ScannerOptions _options;
    private readonly TimeProvider _clock;
    private readonly HttpMessageInvoker _invoker;
    private readonly ConcurrentDictionary<string, Lazy<Task<IPAddress>>> _pins = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentQueue<RequestLogEntry> _log = new();

    public ScopedHttpClient(
        IScopeGate scope, IDnsResolver dns, HostRateLimiter rateLimiter, HttpMessageHandler handler,
        ITlsHandshaker tls, ScannerOptions options, TimeProvider? clock = null)
    {
        _scope = scope;
        _dns = dns;
        _rateLimiter = rateLimiter;
        _tls = tls;
        _options = options;
        _clock = clock ?? TimeProvider.System;
        _invoker = new HttpMessageInvoker(handler, disposeHandler: false);
    }

    public IReadOnlyList<RequestLogEntry> RequestLog => _log.ToArray();

    public async Task<ScanResponse> SendAsync(ScanHttpRequest request, CancellationToken ct = default)
    {
        if (request.Method != HttpMethod.Get && request.Method != HttpMethod.Head && request.Method != HttpMethod.Options)
            throw new RequestBlockedException($"Method {request.Method} is not permitted; ScopeScan only sends safe methods.");

        var hops = new List<RedirectHop>();
        var url = request.Url;
        while (true)
        {
            var response = await SendSingleAsync(request, url, ct);
            var location = response.Headers.Get("Location");
            if (!request.FollowRedirects || !response.IsRedirect || location is null)
                return response with { RequestedUrl = request.Url, Redirects = hops };

            if (hops.Count >= _options.MaxRedirects)
                throw new RequestBlockedException($"Too many redirects (>{_options.MaxRedirects}) starting at {request.Url}.");
            if (!Uri.TryCreate(url, location, out var next))
                return response with { RequestedUrl = request.Url, Redirects = hops };

            hops.Add(new RedirectHop(url, response.StatusCode, response.Headers));
            url = next; // scope is re-checked at the top of SendSingleAsync
        }
    }

    private async Task<ScanResponse> SendSingleAsync(ScanHttpRequest request, Uri url, CancellationToken ct)
    {
        var ip = await AuthorizeAsync(url, request.Method.Method, request.Purpose, ct);
        await _rateLimiter.WaitTurnAsync(url.IdnHost, ct);

        using var message = new HttpRequestMessage(request.Method, url);
        message.Options.Set(PinnedSocketsHandlerFactory.PinnedAddressKey, ip);
        message.Headers.TryAddWithoutValidation("User-Agent", _options.UserAgent);
        message.Headers.TryAddWithoutValidation("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8");
        foreach (var (name, value) in request.Headers ?? new Dictionary<string, string>())
        {
            if (ForbiddenHeaders.Contains(name)) throw new RequestBlockedException($"Header '{name}' may not be set by checks.");
            message.Headers.Remove(name);
            message.Headers.TryAddWithoutValidation(name, value);
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
        timeout.CancelAfter(_options.RequestTimeout);
        try
        {
            using var response = await _invoker.SendAsync(message, timeout.Token);
            var headers = new HeaderMap(response.Headers.Concat(response.Content.Headers));
            var limit = request.MaxBodyBytes ?? _options.MaxBodyBytes;
            var (body, truncated) = request.Method == HttpMethod.Head ? ([], false) : await ReadBoundedAsync(response.Content, limit, timeout.Token);
            Log(request.Method.Method, url, (int)response.StatusCode, request.Purpose, null);
            return new ScanResponse
            {
                RequestedUrl = url,
                FinalUrl = url,
                StatusCode = (int)response.StatusCode,
                Headers = headers,
                Body = body,
                BodyTruncated = truncated,
            };
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested)
        {
            Log(request.Method.Method, url, null, request.Purpose, "timeout");
            throw new TimeoutException($"Request to {url} timed out after {_options.RequestTimeout.TotalSeconds:0}s.");
        }
        catch (HttpRequestException ex)
        {
            Log(request.Method.Method, url, null, request.Purpose, ex.Message);
            throw;
        }
    }

    public async Task<TlsInfo> InspectTlsAsync(Uri url, CancellationToken ct = default)
    {
        if (url.Scheme != Uri.UriSchemeHttps) throw new ArgumentException("TLS inspection requires an https URL.", nameof(url));
        var ip = await AuthorizeAsync(url, "TLS", "tls-handshake", ct);
        var host = url.IdnHost;

        await _rateLimiter.WaitTurnAsync(host, ct);
        TlsHandshakeResult main;
        try
        {
            main = await _tls.HandshakeAsync(ip, url.Port, host, SslProtocols.None, _options.RequestTimeout, ct);
            Log("TLS", url, null, "tls-handshake", null);
        }
        catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
        {
            Log("TLS", url, null, "tls-handshake", ex.Message);
            throw;
        }

        // Probe whether legacy protocols are still accepted. A probe failure (including the local
        // OS refusing to offer the protocol) is treated as "not accepted".
        var legacy = new List<string>();
#pragma warning disable SYSLIB0039 // TLS 1.0/1.1 are used deliberately to detect weak server configuration.
        foreach (var (proto, name) in new[] { (SslProtocols.Tls11, "TLS 1.1"), (SslProtocols.Tls, "TLS 1.0") })
#pragma warning restore SYSLIB0039
        {
            await _rateLimiter.WaitTurnAsync(host, ct);
            try
            {
                var r = await _tls.HandshakeAsync(ip, url.Port, host, proto, _options.RequestTimeout, ct);
                r.Certificate.Dispose();
                legacy.Add(name);
                Log("TLS", url, null, $"tls-probe {name}", null);
            }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                Log("TLS", url, null, $"tls-probe {name}", "not accepted");
            }
        }

        using var cert = main.Certificate;
        return new TlsInfo(
            NegotiatedProtocol: ProtocolName(main.Protocol),
            CipherSuite: main.CipherSuite,
            Subject: cert.Subject,
            Issuer: cert.Issuer,
            NotBefore: new DateTimeOffset(cert.NotBefore.ToUniversalTime(), TimeSpan.Zero),
            NotAfter: new DateTimeOffset(cert.NotAfter.ToUniversalTime(), TimeSpan.Zero),
            SignatureAlgorithm: cert.SignatureAlgorithm.FriendlyName ?? cert.SignatureAlgorithm.Value ?? "unknown",
            PublicKeyAlgorithm: cert.PublicKey.Oid.FriendlyName ?? "unknown",
            KeySize: KeySize(cert),
            SubjectAltNames: SubjectAltNames(cert),
            HostnameMismatch: main.PolicyErrors.HasFlag(System.Net.Security.SslPolicyErrors.RemoteCertificateNameMismatch),
            ChainTrusted: !main.PolicyErrors.HasFlag(System.Net.Security.SslPolicyErrors.RemoteCertificateChainErrors),
            IsSelfSigned: cert.Subject == cert.Issuer,
            LegacyProtocolsAccepted: legacy);
    }

    /// <summary>Scope gate + DNS pin + SSRF policy. Logs and throws if refused; no packet is sent.</summary>
    private async Task<IPAddress> AuthorizeAsync(Uri url, string method, string purpose, CancellationToken ct)
    {
        var decision = await _scope.EvaluateAsync(url, ct);
        if (!decision.Allowed)
        {
            Log(method, url, null, purpose, "blocked: " + decision.Reason);
            throw new OutOfScopeException(decision.Reason);
        }
        try
        {
            return await _pins.GetOrAdd(url.IdnHost, h => new Lazy<Task<IPAddress>>(() => ResolveAndValidateAsync(h, ct))).Value;
        }
        catch (RequestBlockedException ex)
        {
            Log(method, url, null, purpose, "blocked: " + ex.Message);
            throw;
        }
    }

    private async Task<IPAddress> ResolveAndValidateAsync(string host, CancellationToken ct)
    {
        IPAddress[] addresses;
        try { addresses = await _dns.ResolveAsync(host, ct); }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            throw new RequestBlockedException($"DNS resolution failed for {host}: {ex.Message}");
        }
        if (addresses.Length == 0) throw new RequestBlockedException($"{host} did not resolve.");
        // Refuse if ANY answer is non-public: mixed answers are a classic rebinding setup.
        var blocked = addresses.FirstOrDefault(a => !NetworkPolicy.IsPublic(a));
        if (blocked is not null) throw new RequestBlockedException($"{host} resolves to non-public address {blocked}; refusing (SSRF protection).");
        return addresses[0];
    }

    private static async Task<(byte[] Body, bool Truncated)> ReadBoundedAsync(HttpContent content, int limit, CancellationToken ct)
    {
        await using var stream = await content.ReadAsStreamAsync(ct);
        var buffer = new byte[Math.Min(limit + 1, 81920)];
        using var ms = new MemoryStream();
        int read;
        while ((read = await stream.ReadAsync(buffer, ct)) > 0)
        {
            var take = Math.Min(read, limit - (int)ms.Length);
            ms.Write(buffer, 0, take);
            if (ms.Length >= limit) return (ms.ToArray(), take < read || await stream.ReadAsync(buffer.AsMemory(0, 1), ct) > 0);
        }
        return (ms.ToArray(), false);
    }

    private void Log(string method, Uri url, int? status, string purpose, string? error) =>
        _log.Enqueue(new RequestLogEntry(_clock.GetUtcNow(), method, SecretRedactor.Redact(url.ToString(), 300), status, purpose, error));

    private static string ProtocolName(SslProtocols p) => p switch
    {
        SslProtocols.Tls13 => "TLS 1.3",
        SslProtocols.Tls12 => "TLS 1.2",
#pragma warning disable SYSLIB0039
        SslProtocols.Tls11 => "TLS 1.1",
        SslProtocols.Tls => "TLS 1.0",
#pragma warning restore SYSLIB0039
        _ => p.ToString(),
    };

    private static int KeySize(X509Certificate2 cert) =>
        cert.GetRSAPublicKey()?.KeySize ?? cert.GetECDsaPublicKey()?.KeySize ?? cert.GetDSAPublicKey()?.KeySize ?? 0;

    private static IReadOnlyList<string> SubjectAltNames(X509Certificate2 cert)
    {
        var ext = cert.Extensions.OfType<X509SubjectAlternativeNameExtension>().FirstOrDefault();
        return ext is null ? [] : ext.EnumerateDnsNames().ToList();
    }

    public void Dispose() => _invoker.Dispose();
}

public interface IScanHttpClientFactory
{
    /// <summary>Creates a client for one scan; DNS pins and the request log are scoped to it.</summary>
    ScopedHttpClient Create();
}

public sealed class ScanHttpClientFactory(
    IScopeGate scope, IDnsResolver dns, HostRateLimiter rateLimiter, ITlsHandshaker tls, ScannerOptions options, TimeProvider clock)
    : IScanHttpClientFactory, IDisposable
{
    private readonly SocketsHttpHandler _handler = PinnedSocketsHandlerFactory.Create(options);

    public ScopedHttpClient Create() => new(scope, dns, rateLimiter, _handler, tls, options, clock);

    public void Dispose() => _handler.Dispose();
}
