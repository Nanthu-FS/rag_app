using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using ScopeScan.Core.Models;
using ScopeScan.Core.Scope;
using ScopeScan.Scanner;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Tests.Scanner;

/// <summary>Mock HTTP handler: routes by absolute URL (or path+query) to canned responses and records every request.</summary>
public sealed class FixtureHandler : HttpMessageHandler
{
    private readonly Dictionary<string, Func<HttpRequestMessage, HttpResponseMessage>> _routes = new(StringComparer.Ordinal);
    public ConcurrentQueue<HttpRequestMessage> Requests { get; } = new();
    public TimeSpan Delay { get; set; }

    public FixtureHandler On(string url, Func<HttpRequestMessage, HttpResponseMessage> respond) { _routes[url] = respond; return this; }
    private readonly List<(Func<string, bool> Match, Func<HttpRequestMessage, HttpResponseMessage> Respond)> _predicates = [];
    public FixtureHandler On(Func<string, bool> match, Func<HttpRequestMessage, HttpResponseMessage> respond) { _predicates.Add((match, respond)); return this; }
    public FixtureHandler On(string url, string fixtureName) => On(url, _ => Fixtures.Load(fixtureName));
    public FixtureHandler OnRaw(string url, string rawHttp) => On(url, _ => Fixtures.Parse(rawHttp));

    public IEnumerable<string> RequestedUrls => Requests.Select(r => r.RequestUri!.ToString());

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Requests.Enqueue(request);
        if (Delay > TimeSpan.Zero) await Task.Delay(Delay, ct);
        var url = request.RequestUri!.ToString();
        if (_routes.TryGetValue(url, out var respond) || _routes.TryGetValue(request.RequestUri.PathAndQuery, out respond))
            return respond(request);
        foreach (var (match, r) in _predicates)
            if (match(url)) return r(request);
        return new HttpResponseMessage(HttpStatusCode.NotFound) { Content = new StringContent("<html><body>Not found</body></html>", Encoding.UTF8, "text/html") };
    }
}

/// <summary>Loads recorded raw HTTP responses from the Fixtures folder.</summary>
public static class Fixtures
{
    public static HttpResponseMessage Load(string name) =>
        Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "Fixtures", name)));

    public static HttpResponseMessage Parse(string raw)
    {
        raw = raw.Replace("\r\n", "\n");
        var split = raw.IndexOf("\n\n", StringComparison.Ordinal);
        var head = split < 0 ? raw : raw[..split];
        var body = split < 0 ? "" : raw[(split + 2)..];
        var lines = head.Split('\n');
        var status = int.Parse(lines[0].Split(' ')[1]);
        var response = new HttpResponseMessage((HttpStatusCode)status) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(body)) };
        foreach (var line in lines.Skip(1).Where(l => l.Contains(':')))
        {
            var name = line[..line.IndexOf(':')].Trim();
            var value = line[(line.IndexOf(':') + 1)..].Trim();
            if (!response.Headers.TryAddWithoutValidation(name, value))
                response.Content.Headers.TryAddWithoutValidation(name, value);
        }
        return response;
    }
}

public sealed class FakeDns : IDnsResolver
{
    public Dictionary<string, IPAddress[]> Answers { get; } = new(StringComparer.OrdinalIgnoreCase);
    public int Calls;

    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken ct)
    {
        Interlocked.Increment(ref Calls);
        return Task.FromResult(Answers.TryGetValue(host, out var a) ? a : [IPAddress.Parse("93.184.216.34")]);
    }
}

/// <summary>Returns a generated certificate; configurable expiry, key size, self-signed, errors and accepted protocols.</summary>
public sealed class FakeTlsHandshaker : ITlsHandshaker
{
    public DateTimeOffset NotBefore { get; set; } = DateTimeOffset.UtcNow.AddDays(-30);
    public DateTimeOffset NotAfter { get; set; } = DateTimeOffset.UtcNow.AddDays(200);
    public int RsaKeySize { get; set; } = 2048;
    public bool SelfSigned { get; set; }
    public SslPolicyErrors Errors { get; set; }
    public SslProtocols Negotiated { get; set; } = SslProtocols.Tls13;
    public HashSet<SslProtocols> LegacyAccepted { get; } = [];
    public List<(IPAddress, SslProtocols)> Calls { get; } = [];

    public Task<TlsHandshakeResult> HandshakeAsync(IPAddress address, int port, string host, SslProtocols protocols, TimeSpan timeout, CancellationToken ct)
    {
        Calls.Add((address, protocols));
        if (protocols != SslProtocols.None && !LegacyAccepted.Contains(protocols))
            throw new AuthenticationException("protocol not accepted");

        using var key = RSA.Create(RsaKeySize);
        var req = new CertificateRequest($"CN={host}", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName(host);
        req.CertificateExtensions.Add(san.Build());
        X509Certificate2 cert;
        if (SelfSigned)
        {
            cert = req.CreateSelfSigned(NotBefore, NotAfter);
        }
        else
        {
            using var caKey = RSA.Create(2048);
            var caReq = new CertificateRequest("CN=Fake Test CA", caKey, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
            caReq.CertificateExtensions.Add(new X509BasicConstraintsExtension(true, false, 0, true));
            using var ca = caReq.CreateSelfSigned(NotBefore.AddDays(-1), NotAfter.AddDays(1));
            cert = req.Create(ca, NotBefore, NotAfter, [1, 2, 3, 4]);
        }
        var negotiated = protocols == SslProtocols.None ? Negotiated : protocols;
        return Task.FromResult(new TlsHandshakeResult(negotiated, "TLS_AES_128_GCM_SHA256", cert, Errors));
    }
}

/// <summary>Wires a ScopedHttpClient + ScanContext against mocks. Scope defaults to app.example.com.</summary>
public sealed class ScanHarness : IDisposable
{
    public FixtureHandler Handler { get; } = new();
    public FakeDns Dns { get; } = new();
    public FakeTlsHandshaker Tls { get; } = new();
    public ScannerOptions Options { get; } = new() { MinRequestInterval = TimeSpan.Zero };
    public string[] Scope { get; set; } = ["app.example.com"];

    private ScopedHttpClient? _client;
    public ScopedHttpClient Client => _client ??= new ScopedHttpClient(
        new ScopeGate(new StaticScope(Scope)), Dns, new HostRateLimiter(Options), Handler, Tls, Options);

    public ScanContext Context(string target = "https://app.example.com/") => new("test-scan", new Uri(target), Client);

    public Task<IReadOnlyList<Finding>> Run(IScanCheck check, string target = "https://app.example.com/") =>
        check.RunAsync(Context(target), CancellationToken.None);

    public void Dispose() => _client?.Dispose();
}

public static class FindingAssertions
{
    public static Finding Has(this IReadOnlyList<Finding> findings, string idSuffix) =>
        Assert.Single(findings, f => f.Id.EndsWith(idSuffix, StringComparison.Ordinal));

    public static void Lacks(this IReadOnlyList<Finding> findings, string idPart) =>
        Assert.DoesNotContain(findings, f => f.Id.Contains(idPart, StringComparison.Ordinal));
}
