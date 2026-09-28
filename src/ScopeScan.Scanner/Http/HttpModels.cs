using System.Text;
using ScopeScan.Core.Models;

namespace ScopeScan.Scanner.Http;

public sealed class ScannerOptions
{
    public string UserAgent { get; set; } = "ScopeScan/1.0 (+authorized passive security scan; scope-gated)";
    public TimeSpan RequestTimeout { get; set; } = TimeSpan.FromSeconds(10);
    /// <summary>Minimum spacing between requests to one host (500 ms = 2 req/s).</summary>
    public TimeSpan MinRequestInterval { get; set; } = TimeSpan.FromMilliseconds(500);
    public int MaxRedirects { get; set; } = 5;
    public int MaxBodyBytes { get; set; } = 1024 * 1024;
}

public sealed record ScanHttpRequest(Uri Url, string Purpose)
{
    public HttpMethod Method { get; init; } = HttpMethod.Get;
    public bool FollowRedirects { get; init; } = true;
    public IReadOnlyDictionary<string, string>? Headers { get; init; }
    public int? MaxBodyBytes { get; init; }
}

public sealed record RedirectHop(Uri Url, int StatusCode, HeaderMap Headers);

/// <summary>Case-insensitive multi-value header map (response + content headers).</summary>
public sealed class HeaderMap
{
    private readonly Dictionary<string, List<string>> _values = new(StringComparer.OrdinalIgnoreCase);

    public HeaderMap() { }

    public HeaderMap(IEnumerable<KeyValuePair<string, IEnumerable<string>>> headers)
    {
        foreach (var (name, values) in headers)
            foreach (var v in values) Add(name, v);
    }

    public void Add(string name, string value)
    {
        if (!_values.TryGetValue(name, out var list)) _values[name] = list = [];
        list.Add(value);
    }

    public string? Get(string name) => _values.TryGetValue(name, out var v) ? v[0] : null;
    public IReadOnlyList<string> GetAll(string name) => _values.TryGetValue(name, out var v) ? v : [];
    public bool Contains(string name) => _values.ContainsKey(name);
    public IEnumerable<string> Names => _values.Keys;
}

public sealed record ScanResponse
{
    public required Uri RequestedUrl { get; init; }
    public required Uri FinalUrl { get; init; }
    public required int StatusCode { get; init; }
    public required HeaderMap Headers { get; init; }
    public byte[] Body { get; init; } = [];
    public bool BodyTruncated { get; init; }
    public IReadOnlyList<RedirectHop> Redirects { get; init; } = [];

    public string? ContentType => Headers.Get("Content-Type");
    public bool IsHtml => ContentType?.Contains("html", StringComparison.OrdinalIgnoreCase) == true;
    public bool IsRedirect => StatusCode is 301 or 302 or 303 or 307 or 308;
    public string BodyText => _bodyText ??= Encoding.UTF8.GetString(Body);
    private string? _bodyText;
}

public sealed record TlsInfo(
    string NegotiatedProtocol,
    string? CipherSuite,
    string Subject,
    string Issuer,
    DateTimeOffset NotBefore,
    DateTimeOffset NotAfter,
    string SignatureAlgorithm,
    string PublicKeyAlgorithm,
    int KeySize,
    IReadOnlyList<string> SubjectAltNames,
    bool HostnameMismatch,
    bool ChainTrusted,
    bool IsSelfSigned,
    IReadOnlyList<string> LegacyProtocolsAccepted);

/// <summary>The only way checks may contact a target. Enforces scope, SSRF, pinning, rate limits and logging.</summary>
public interface IScanHttpClient
{
    Task<ScanResponse> SendAsync(ScanHttpRequest request, CancellationToken ct = default);
    Task<TlsInfo> InspectTlsAsync(Uri url, CancellationToken ct = default);
    IReadOnlyList<RequestLogEntry> RequestLog { get; }
}
