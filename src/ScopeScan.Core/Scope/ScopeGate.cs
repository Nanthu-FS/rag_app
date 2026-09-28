using System.Net;

namespace ScopeScan.Core.Scope;

/// <summary>
/// Decides whether a URL may be contacted. Must be consulted before every request,
/// including each redirect hop. DNS/SSRF checks happen separately at connection time.
/// </summary>
public sealed class ScopeGate(IScopeRepository scope) : IScopeGate
{
    public async Task<ScopeDecision> EvaluateAsync(Uri uri, CancellationToken ct = default)
    {
        if (!uri.IsAbsoluteUri)
            return ScopeDecision.Deny("URL must be absolute.");
        if (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)
            return ScopeDecision.Deny($"Scheme '{uri.Scheme}' is not allowed; only http and https.");
        if (!string.IsNullOrEmpty(uri.UserInfo))
            return ScopeDecision.Deny("URLs with embedded credentials are not allowed.");

        var host = ScopePattern.NormalizeHost(uri.IdnHost);
        if (host is null)
            return ScopeDecision.Deny("Host name is invalid.");

        if (IPAddress.TryParse(host, out var ip) && !NetworkPolicy.IsPublic(ip))
            return ScopeDecision.Deny($"{host} is a private, loopback or reserved address.");

        foreach (var entry in await scope.GetAllAsync(ct))
        {
            if (ScopePattern.TryParse(entry.Pattern, out var pattern, out _) && pattern!.Matches(host))
                return new ScopeDecision(true, $"Host matches scope entry '{pattern.Value}'.", pattern.Value);
        }

        return ScopeDecision.Deny($"{host} is not in scope. Add it to the scope list only if you are authorized to test it.");
    }
}

public static class ScopeGateExtensions
{
    public static async Task EnsureInScopeAsync(this IScopeGate gate, Uri uri, CancellationToken ct = default)
    {
        var decision = await gate.EvaluateAsync(uri, ct);
        if (!decision.Allowed) throw new OutOfScopeException(decision.Reason);
    }
}
