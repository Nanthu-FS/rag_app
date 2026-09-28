using System.Net.Security;
using System.Security.Authentication;
using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;
using ScopeScan.Scanner.Checks;

namespace ScopeScan.Tests.Scanner;

public class SecurityHeadersCheckTests
{
    [Fact]
    public async Task MisconfiguredSite_ReportsMissingHeaders()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "misconfigured.http");
        var f = await h.Run(new SecurityHeadersCheck());

        Assert.Equal(Severity.Medium, f.Has("hsts-missing").Severity);
        Assert.Equal(Severity.Medium, f.Has("csp-missing").Severity);
        Assert.Equal("CWE-1021", f.Has("clickjacking").Cwe);
        f.Has("xcto-missing");
        f.Has("referrer-weak");
        f.Has("permissions-missing");
        Assert.All(f, x => Assert.Equal("security-headers", x.CheckId));
    }

    [Fact]
    public async Task HardenedSite_ReportsNothing()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "hardened.http");
        Assert.Empty(await h.Run(new SecurityHeadersCheck()));
    }

    [Fact]
    public async Task WeakCsp_AndShortHsts_AreReported()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "weak-csp.http");
        var f = await h.Run(new SecurityHeadersCheck());

        f.Has("csp-unsafe-inline");
        f.Has("csp-unsafe-eval");
        f.Has("csp-wildcard");
        f.Has("hsts-short");
        f.Has("xfo-invalid");
        f.Lacks("csp-missing");
    }

    [Fact]
    public async Task PlainHttpSite_IsReported()
    {
        using var h = new ScanHarness();
        h.Handler.On("http://app.example.com/", "hardened.http");
        var f = await h.Run(new SecurityHeadersCheck(), "http://app.example.com/");
        f.Has("no-https");
        f.Lacks("hsts");
    }
}

public class InformationLeakHeadersCheckTests
{
    [Fact]
    public async Task VersionedServerAndPoweredBy_AreReported()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "misconfigured.http");
        var f = Assert.Single(await h.Run(new InformationLeakHeadersCheck()));
        Assert.Equal(Severity.Low, f.Severity);
        Assert.Contains("Server: Apache/2.4.29", f.Evidence);
        Assert.Contains("X-Powered-By: PHP/7.2.1", f.Evidence);
    }

    [Fact]
    public async Task DebugHeaders_AreMedium()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "weak-csp.http");
        Assert.Equal(Severity.Medium, Assert.Single(await h.Run(new InformationLeakHeadersCheck())).Severity);
    }

    [Fact]
    public async Task GenericServerHeader_IsFine()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "hardened.http");
        Assert.Empty(await h.Run(new InformationLeakHeadersCheck()));
    }
}

public class CookieFlagsCheckTests
{
    [Fact]
    public async Task SessionCookieWithoutFlags_IsReportedWithoutItsValue()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "misconfigured.http");
        var f = await h.Run(new CookieFlagsCheck());

        Assert.Equal(Severity.Medium, f.Has("secure-missing.phpsessid").Severity);
        Assert.Equal(Severity.Medium, f.Has("httponly-missing.phpsessid").Severity);
        f.Has("samesite-missing.phpsessid");
        f.Lacks(".theme");
        Assert.All(f, x => Assert.DoesNotContain("9f8e7d6c5b4a3f2e1d0c9b8a", x.Evidence));
        Assert.Contains("PHPSESSID=" + SecretRedactor.Mask, f[0].Evidence);
    }

    [Fact]
    public async Task HardenedCookie_IsFine()
    {
        using var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "hardened.http");
        Assert.Empty(await h.Run(new CookieFlagsCheck()));
    }

    [Fact]
    public async Task CookiesOnRedirectHops_AreChecked_AndSameSiteNoneWithoutSecureFlagged()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", "HTTP/1.1 302 Found\nLocation: /home\nSet-Cookie: tracker=1; SameSite=None; HttpOnly\n\n")
                 .On("https://app.example.com/home", "hardened.http");
        var f = await h.Run(new CookieFlagsCheck());
        Assert.Equal(Severity.Medium, f.Has("samesite-none-insecure.tracker").Severity);
        Assert.Equal(Severity.Low, f.Has("secure-missing.tracker").Severity);
    }
}

public class CorsCheckTests
{
    private static string Cors(string acao, bool creds) =>
        $"HTTP/1.1 200 OK\nContent-Type: application/json\nAccess-Control-Allow-Origin: {acao}\n" +
        (creds ? "Access-Control-Allow-Credentials: true\n" : "") + "\n{}";

    [Fact]
    public async Task ReflectedOriginWithCredentials_IsHigh_AndOnlyOneBenignRequestIsSent()
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", Cors(CorsCheck.ProbeOrigin, true));
        var f = Assert.Single(await h.Run(new CorsCheck()));

        Assert.Equal(Severity.High, f.Severity);
        Assert.Equal("CWE-942", f.Cwe);
        var req = Assert.Single(h.Handler.Requests);
        Assert.Equal(CorsCheck.ProbeOrigin, req.Headers.GetValues("Origin").Single());
    }

    [Theory]
    [InlineData(CorsCheck.ProbeOrigin, false, Severity.Low)]
    [InlineData("*", true, Severity.Medium)]
    [InlineData("null", false, Severity.Medium)]
    public async Task OtherMisconfigurations(string acao, bool creds, Severity expected)
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", Cors(acao, creds));
        Assert.Equal(expected, Assert.Single(await h.Run(new CorsCheck())).Severity);
    }

    [Theory]
    [InlineData("*", false)]
    [InlineData("https://app.example.com", true)]
    public async Task SafePolicies_ReportNothing(string acao, bool creds)
    {
        using var h = new ScanHarness();
        h.Handler.OnRaw("https://app.example.com/", Cors(acao, creds));
        Assert.Empty(await h.Run(new CorsCheck()));
    }
}

public class TlsCheckTests
{
    private static ScanHarness Harness()
    {
        var h = new ScanHarness();
        h.Handler.On("https://app.example.com/", "hardened.http");
        return h;
    }

    [Fact]
    public async Task HealthyCertificate_ReportsNothing()
    {
        using var h = Harness();
        Assert.Empty(await h.Run(new TlsCheck()));
        // one main handshake + two legacy probes, all to the pinned IP
        Assert.Equal(3, h.Tls.Calls.Count);
        Assert.All(h.Tls.Calls, c => Assert.Equal("93.184.216.34", c.Item1.ToString()));
    }

    [Fact]
    public async Task ExpiredCertificate_IsHigh()
    {
        using var h = Harness();
        h.Tls.NotBefore = DateTimeOffset.UtcNow.AddDays(-400);
        h.Tls.NotAfter = DateTimeOffset.UtcNow.AddDays(-2);
        Assert.Equal(Severity.High, (await h.Run(new TlsCheck())).Has("cert-expired").Severity);
    }

    [Theory]
    [InlineData(5, "cert-expiring", Severity.Medium)]
    [InlineData(20, "cert-expiring-soon", Severity.Low)]
    public async Task ExpiringCertificate(int days, string code, Severity sev)
    {
        using var h = Harness();
        h.Tls.NotAfter = DateTimeOffset.UtcNow.AddDays(days);
        Assert.Equal(sev, (await h.Run(new TlsCheck())).Has(code).Severity);
    }

    [Fact]
    public async Task SelfSignedMismatchedWeakKey_AreReported()
    {
        using var h = Harness();
        h.Tls.SelfSigned = true;
        h.Tls.RsaKeySize = 1024;
        h.Tls.Errors = SslPolicyErrors.RemoteCertificateNameMismatch | SslPolicyErrors.RemoteCertificateChainErrors;
        var f = await h.Run(new TlsCheck());
        f.Has("cert-self-signed");
        f.Has("cert-name-mismatch");
        f.Has("weak-key");
        f.Lacks("cert-untrusted"); // self-signed already explains the trust failure
    }

    [Fact]
    public async Task UntrustedChain_IsReported()
    {
        using var h = Harness();
        h.Tls.Errors = SslPolicyErrors.RemoteCertificateChainErrors;
        (await h.Run(new TlsCheck())).Has("cert-untrusted");
    }

    [Fact]
    public async Task LegacyProtocolsAccepted_AreReported()
    {
        using var h = Harness();
#pragma warning disable SYSLIB0039
        h.Tls.LegacyAccepted.Add(SslProtocols.Tls);
#pragma warning restore SYSLIB0039
        var f = (await h.Run(new TlsCheck())).Has("legacy-protocols");
        Assert.Contains("TLS 1.0", f.Description);
        Assert.DoesNotContain("TLS 1.1", f.Description);
    }

    [Fact]
    public async Task PlainHttpTarget_SkipsTls()
    {
        using var h = new ScanHarness();
        h.Handler.On("http://app.example.com/", "hardened.http");
        Assert.Empty(await h.Run(new TlsCheck(), "http://app.example.com/"));
        Assert.Empty(h.Tls.Calls);
    }
}
