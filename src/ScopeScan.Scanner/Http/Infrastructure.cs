using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Net.Sockets;
using System.Security.Authentication;
using System.Security.Cryptography.X509Certificates;

namespace ScopeScan.Scanner.Http;

public interface IDnsResolver
{
    Task<IPAddress[]> ResolveAsync(string host, CancellationToken ct);
}

public sealed class SystemDnsResolver : IDnsResolver
{
    public Task<IPAddress[]> ResolveAsync(string host, CancellationToken ct) =>
        IPAddress.TryParse(host, out var ip) ? Task.FromResult(new[] { ip }) : Dns.GetHostAddressesAsync(host, ct);
}

/// <summary>Spaces requests to the same host by at least <see cref="ScannerOptions.MinRequestInterval"/>.</summary>
public sealed class HostRateLimiter(ScannerOptions options, TimeProvider? clock = null)
{
    private sealed class Slot
    {
        public readonly SemaphoreSlim Gate = new(1, 1);
        public DateTimeOffset NextAllowed = DateTimeOffset.MinValue;
    }

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, Slot> _slots = new(StringComparer.OrdinalIgnoreCase);

    public async Task WaitTurnAsync(string host, CancellationToken ct)
    {
        var slot = _slots.GetOrAdd(host, _ => new Slot());
        await slot.Gate.WaitAsync(ct);
        try
        {
            var wait = slot.NextAllowed - _clock.GetUtcNow();
            if (wait > TimeSpan.Zero) await Task.Delay(wait, _clock, ct);
            slot.NextAllowed = _clock.GetUtcNow() + options.MinRequestInterval;
        }
        finally { slot.Gate.Release(); }
    }
}

/// <summary>Allows at most one concurrent scan per host.</summary>
public sealed class HostScanGuard
{
    private readonly ConcurrentDictionary<string, byte> _active = new(StringComparer.OrdinalIgnoreCase);

    public bool TryAcquire(string host, out IDisposable? lease)
    {
        lease = null;
        if (!_active.TryAdd(host, 0)) return false;
        lease = new Lease(() => _active.TryRemove(host, out _));
        return true;
    }

    public bool IsActive(string host) => _active.ContainsKey(host);

    private sealed class Lease(Action release) : IDisposable
    {
        private int _disposed;
        public void Dispose() { if (Interlocked.Exchange(ref _disposed, 1) == 0) release(); }
    }
}

public sealed record TlsHandshakeResult(
    SslProtocols Protocol,
    string? CipherSuite,
    X509Certificate2 Certificate,
    SslPolicyErrors PolicyErrors);

public interface ITlsHandshaker
{
    /// <summary>Performs a TLS handshake against a pinned IP. Throws if the handshake fails.</summary>
    Task<TlsHandshakeResult> HandshakeAsync(IPAddress address, int port, string host, SslProtocols protocols, TimeSpan timeout, CancellationToken ct);
}

public sealed class SocketTlsHandshaker : ITlsHandshaker
{
    public async Task<TlsHandshakeResult> HandshakeAsync(IPAddress address, int port, string host, SslProtocols protocols, TimeSpan timeout, CancellationToken ct)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);
        using var socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
        await socket.ConnectAsync(new IPEndPoint(address, port), cts.Token);
        await using var stream = new NetworkStream(socket, ownsSocket: false);

        var errors = SslPolicyErrors.None;
        await using var ssl = new SslStream(stream, false, (_, _, _, e) => { errors = e; return true; });
        await ssl.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
        {
            TargetHost = host,
            EnabledSslProtocols = protocols,
            CertificateRevocationCheckMode = X509RevocationMode.NoCheck,
        }, cts.Token);

        var cert = ssl.RemoteCertificate is X509Certificate2 c2 ? new X509Certificate2(c2) : new X509Certificate2(ssl.RemoteCertificate!);
        return new TlsHandshakeResult(ssl.SslProtocol, ssl.NegotiatedCipherSuite.ToString(), cert, errors);
    }
}

/// <summary>Builds the shared socket handler. Connections go only to the IP pinned on each request.</summary>
public static class PinnedSocketsHandlerFactory
{
    public static readonly HttpRequestOptionsKey<IPAddress> PinnedAddressKey = new("ScopeScan.PinnedAddress");

    public static SocketsHttpHandler Create(ScannerOptions options) => new()
    {
        AllowAutoRedirect = false,             // redirects are followed manually so each hop is scope-checked
        UseCookies = false,                    // never persist target cookies
        UseProxy = false,                      // we connect to pinned IPs directly
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = options.RequestTimeout,
        PooledConnectionLifetime = TimeSpan.FromMinutes(2),
        // Certificate problems are reported by the TLS check rather than aborting the scan.
        SslOptions = { RemoteCertificateValidationCallback = (_, _, _, _) => true },
        ConnectCallback = async (context, ct) =>
        {
            if (!context.InitialRequestMessage.Options.TryGetValue(PinnedAddressKey, out var ip))
                throw new InvalidOperationException("Refusing to connect: request has no pinned, validated address.");
            var socket = new Socket(ip.AddressFamily, SocketType.Stream, ProtocolType.Tcp) { NoDelay = true };
            try
            {
                await socket.ConnectAsync(new IPEndPoint(ip, context.DnsEndPoint.Port), ct);
                return new NetworkStream(socket, ownsSocket: true);
            }
            catch
            {
                socket.Dispose();
                throw;
            }
        },
    };
}
