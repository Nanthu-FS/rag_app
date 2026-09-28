using System.Globalization;
using System.Net;
using System.Text.RegularExpressions;

namespace ScopeScan.Core.Scope;

/// <summary>
/// A parsed allowlist entry. Either an exact host ("app.example.com", "203.0.113.10")
/// or an explicit wildcard ("*.example.com") that matches subdomains only, never the apex.
/// </summary>
public sealed partial class ScopePattern
{
    private static readonly IdnMapping Idn = new();

    public string Value { get; }
    public bool IsWildcard { get; }
    private readonly string _suffix; // ".example.com" for wildcards

    private ScopePattern(string value, bool wildcard)
    {
        Value = value;
        IsWildcard = wildcard;
        _suffix = wildcard ? value[1..] : "";
    }

    public bool Matches(string normalizedHost) => IsWildcard
        ? normalizedHost.Length > _suffix.Length && normalizedHost.EndsWith(_suffix, StringComparison.Ordinal)
        : string.Equals(normalizedHost, Value, StringComparison.Ordinal);

    public static bool TryParse(string? input, out ScopePattern? pattern, out string error)
    {
        pattern = null;
        error = "";
        var raw = input?.Trim() ?? "";
        if (raw.Length == 0) { error = "Pattern is empty."; return false; }
        if (raw.Contains("://") || raw.Contains('/') || raw.Contains('?') || raw.Contains('@'))
        {
            error = "Enter a host name only (no scheme, path or credentials).";
            return false;
        }
        if (raw.Contains(':') && !IPAddress.TryParse(raw.Trim('[', ']'), out _))
        {
            error = "Ports are not part of scope; enter the host only.";
            return false;
        }

        var wildcard = raw.StartsWith("*.", StringComparison.Ordinal);
        var body = wildcard ? raw[2..] : raw;
        if (body.Contains('*')) { error = "Only a single leading '*.' wildcard is allowed."; return false; }

        if (IPAddress.TryParse(body.Trim('[', ']'), out var ip))
        {
            if (wildcard) { error = "Wildcards cannot be combined with IP addresses."; return false; }
            pattern = new ScopePattern(ip.ToString(), false);
            return true;
        }

        var host = NormalizeHost(body);
        if (host is null || !HostRegex().IsMatch(host)) { error = $"'{raw}' is not a valid host name."; return false; }
        if (wildcard && host.Split('.').Length < 2)
        {
            error = "Wildcard must cover a registrable domain (e.g. *.example.com), not a TLD.";
            return false;
        }
        if (!wildcard && !host.Contains('.'))
        {
            error = "Host must be fully qualified (e.g. app.example.com).";
            return false;
        }

        pattern = new ScopePattern(wildcard ? "*." + host : host, wildcard);
        return true;
    }

    /// <summary>Lower-cases, strips a trailing dot and converts IDN to punycode. Returns null if invalid.</summary>
    public static string? NormalizeHost(string host)
    {
        var h = host.Trim().TrimEnd('.').ToLowerInvariant();
        if (h.Length == 0) return null;
        if (IPAddress.TryParse(h.Trim('[', ']'), out var ip)) return ip.ToString();
        try { return Idn.GetAscii(h); }
        catch (ArgumentException) { return null; }
    }

    [GeneratedRegex(@"^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$")]
    private static partial Regex HostRegex();
}
