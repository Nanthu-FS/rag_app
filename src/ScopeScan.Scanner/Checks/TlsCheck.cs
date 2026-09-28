using ScopeScan.Core.Models;
using ScopeScan.Scanner.Http;

namespace ScopeScan.Scanner.Checks;

/// <summary>Certificate validity/expiry, hostname match, trust, key strength, signature and protocol versions.</summary>
public sealed class TlsCheck(TimeProvider? clock = null) : IScanCheck
{
    private readonly TimeProvider _clock = clock ?? TimeProvider.System;

    public string Id => "tls";
    public string Name => "TLS / certificate";

    public async Task<IReadOnlyList<Finding>> RunAsync(ScanContext ctx, CancellationToken ct)
    {
        // Inspect the HTTPS origin the site actually lands on (http targets usually redirect).
        var baseline = await ctx.GetBaselineAsync();
        var https = baseline.FinalUrl.Scheme == Uri.UriSchemeHttps ? baseline.FinalUrl
            : ctx.Target.Scheme == Uri.UriSchemeHttps ? ctx.Target : null;
        if (https is null) return []; // plain-HTTP delivery is reported by the security-headers check

        var origin = new Uri(https.GetLeftPart(UriPartial.Authority));
        var tls = await ctx.Http.InspectTlsAsync(origin, ct);
        var now = _clock.GetUtcNow();
        var findings = new List<Finding>();
        var certSummary = $"Subject: {tls.Subject}\nIssuer: {tls.Issuer}\nValid: {tls.NotBefore:yyyy-MM-dd} to {tls.NotAfter:yyyy-MM-dd}\n" +
                          $"Protocol: {tls.NegotiatedProtocol}, Cipher: {tls.CipherSuite}\nKey: {tls.PublicKeyAlgorithm} {tls.KeySize} bits, Signature: {tls.SignatureAlgorithm}";
        Finding F(string code, string title, Severity s, string cwe, string d, string fix, string? ev = null) =>
            FindingFactory.Create(Id, code, title, s, cwe, origin, d, ev ?? certSummary, fix);

        var daysLeft = (tls.NotAfter - now).TotalDays;
        if (daysLeft < 0)
            findings.Add(F("cert-expired", "TLS certificate has expired", Severity.High, "CWE-298",
                $"The certificate expired on {tls.NotAfter:yyyy-MM-dd}. Browsers show a full-page warning, and users trained to click through are exposed to interception.",
                "Renew the certificate and automate renewal (e.g. ACME)."));
        else if (daysLeft < 14)
            findings.Add(F("cert-expiring", "TLS certificate expires within 14 days", Severity.Medium, "CWE-298",
                $"The certificate expires on {tls.NotAfter:yyyy-MM-dd} ({daysLeft:0} days).", "Renew the certificate now and automate renewal."));
        else if (daysLeft < 30)
            findings.Add(F("cert-expiring-soon", "TLS certificate expires within 30 days", Severity.Low, "CWE-298",
                $"The certificate expires on {tls.NotAfter:yyyy-MM-dd} ({daysLeft:0} days).", "Schedule renewal and confirm auto-renewal works."));
        if (tls.NotBefore > now)
            findings.Add(F("cert-not-yet-valid", "TLS certificate is not yet valid", Severity.High, "CWE-298",
                $"The certificate is only valid from {tls.NotBefore:yyyy-MM-dd}.", "Check server clock and certificate issuance."));

        if (tls.HostnameMismatch)
            findings.Add(F("cert-name-mismatch", "TLS certificate does not match host name", Severity.High, "CWE-297",
                $"The certificate is not valid for {origin.Host}. SANs: {string.Join(", ", tls.SubjectAltNames.Take(10))}",
                "Issue a certificate that covers this host name."));

        if (tls.IsSelfSigned)
            findings.Add(F("cert-self-signed", "Self-signed TLS certificate", Severity.High, "CWE-295",
                "The certificate is self-signed, so clients cannot authenticate the server.",
                "Use a certificate from a publicly trusted CA."));
        else if (!tls.ChainTrusted)
            findings.Add(F("cert-untrusted", "TLS certificate chain is not trusted", Severity.High, "CWE-295",
                "The certificate chain could not be validated (untrusted root or missing intermediate).",
                "Serve the full chain and use a publicly trusted CA."));

        if (tls.PublicKeyAlgorithm.Contains("RSA", StringComparison.OrdinalIgnoreCase) && tls.KeySize is > 0 and < 2048)
            findings.Add(F("weak-key", "Weak RSA key", Severity.Medium, "CWE-326",
                $"The certificate uses a {tls.KeySize}-bit RSA key; at least 2048 bits is required.", "Re-issue with RSA 2048+ or ECDSA P-256."));

        if (tls.SignatureAlgorithm.Contains("sha1", StringComparison.OrdinalIgnoreCase) || tls.SignatureAlgorithm.Contains("md5", StringComparison.OrdinalIgnoreCase))
            findings.Add(F("weak-signature", "Weak certificate signature algorithm", Severity.Medium, "CWE-327",
                $"The certificate is signed with {tls.SignatureAlgorithm}, which is deprecated.", "Re-issue with a SHA-256 (or stronger) signature."));

        if (tls.NegotiatedProtocol is "TLS 1.0" or "TLS 1.1")
            findings.Add(F("weak-protocol-negotiated", $"Server negotiates {tls.NegotiatedProtocol}", Severity.Medium, "CWE-326",
                "The server's preferred protocol is deprecated (RFC 8996).", "Enable TLS 1.2 and 1.3 and disable older versions."));
        else if (tls.LegacyProtocolsAccepted.Count > 0)
            findings.Add(F("legacy-protocols", "Deprecated TLS versions accepted", Severity.Medium, "CWE-326",
                $"The server still accepts {string.Join(" and ", tls.LegacyProtocolsAccepted)}, which are deprecated (RFC 8996).",
                "Disable TLS 1.0 and 1.1; support only TLS 1.2 and 1.3.",
                $"Accepted: {string.Join(", ", tls.LegacyProtocolsAccepted)}"));

        return findings;
    }
}
