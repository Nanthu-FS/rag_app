using System.Net;
using System.Net.Sockets;

namespace ScopeScan.Core.Scope;

/// <summary>SSRF protection: only globally routable unicast addresses may be contacted.</summary>
public static class NetworkPolicy
{
    private static readonly (IPAddress Network, int Prefix)[] BlockedV4 =
    [
        (IPAddress.Parse("0.0.0.0"), 8),        // "this" network
        (IPAddress.Parse("10.0.0.0"), 8),       // private
        (IPAddress.Parse("100.64.0.0"), 10),    // carrier-grade NAT
        (IPAddress.Parse("127.0.0.0"), 8),      // loopback
        (IPAddress.Parse("169.254.0.0"), 16),   // link-local / cloud metadata
        (IPAddress.Parse("172.16.0.0"), 12),    // private
        (IPAddress.Parse("192.0.0.0"), 24),     // IETF protocol assignments
        (IPAddress.Parse("192.0.2.0"), 24),     // TEST-NET-1
        (IPAddress.Parse("192.168.0.0"), 16),   // private
        (IPAddress.Parse("198.18.0.0"), 15),    // benchmarking
        (IPAddress.Parse("198.51.100.0"), 24),  // TEST-NET-2
        (IPAddress.Parse("203.0.113.0"), 24),   // TEST-NET-3
        (IPAddress.Parse("224.0.0.0"), 4),      // multicast
        (IPAddress.Parse("240.0.0.0"), 4),      // reserved + broadcast
    ];

    private static readonly (IPAddress Network, int Prefix)[] BlockedV6 =
    [
        (IPAddress.Parse("::"), 128),           // unspecified
        (IPAddress.Parse("::1"), 128),          // loopback
        (IPAddress.Parse("64:ff9b:1::"), 48),   // local-use NAT64
        (IPAddress.Parse("100::"), 64),         // discard
        (IPAddress.Parse("2001:db8::"), 32),    // documentation
        (IPAddress.Parse("fc00::"), 7),         // unique local
        (IPAddress.Parse("fe80::"), 10),        // link-local
        (IPAddress.Parse("fec0::"), 10),        // site-local (deprecated)
        (IPAddress.Parse("ff00::"), 8),         // multicast
    ];

    public static bool IsPublic(IPAddress address)
    {
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        if (address.AddressFamily == AddressFamily.InterNetwork)
            return !BlockedV4.Any(b => InRange(address, b.Network, b.Prefix));
        if (address.AddressFamily == AddressFamily.InterNetworkV6)
        {
            // IPv4-compatible (::a.b.c.d) and 6to4/Teredo embeddings are rejected outright.
            var bytes = address.GetAddressBytes();
            if (bytes.Take(12).All(b => b == 0)) return false;
            if (bytes[0] == 0x20 && bytes[1] == 0x02) return false;                     // 2002::/16 6to4
            if (bytes[0] == 0x20 && bytes[1] == 0x01 && bytes[2] == 0 && bytes[3] == 0) return false; // Teredo
            return !BlockedV6.Any(b => InRange(address, b.Network, b.Prefix));
        }
        return false;
    }

    private static bool InRange(IPAddress address, IPAddress network, int prefix)
    {
        var a = address.GetAddressBytes();
        var n = network.GetAddressBytes();
        if (a.Length != n.Length) return false;
        var full = prefix / 8;
        for (var i = 0; i < full; i++)
            if (a[i] != n[i]) return false;
        var rem = prefix % 8;
        if (rem == 0) return true;
        var mask = (byte)(0xFF << (8 - rem));
        return (a[full] & mask) == (n[full] & mask);
    }
}
