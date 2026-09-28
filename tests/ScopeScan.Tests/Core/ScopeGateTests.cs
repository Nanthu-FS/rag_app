using System.Net;
using ScopeScan.Core.Scope;

namespace ScopeScan.Tests.Core;

public class ScopeGateTests
{
    private static ScopeGate Gate(params string[] patterns) => new(new StaticScope(patterns));

    [Theory]
    [InlineData("https://app.example.com/login", true)]
    [InlineData("http://APP.Example.COM./", true)]
    [InlineData("https://app.example.com:8443/", true)]
    [InlineData("https://example.com/", false)]
    [InlineData("https://evil-app.example.com/", false)]
    [InlineData("https://app.example.com.evil.net/", false)]
    public async Task ExactHost_MatchesOnlyThatHost(string url, bool allowed)
    {
        var decision = await Gate("app.example.com").EvaluateAsync(new Uri(url));
        Assert.Equal(allowed, decision.Allowed);
    }

    [Theory]
    [InlineData("https://a.example.com/", true)]
    [InlineData("https://deep.a.example.com/", true)]
    [InlineData("https://example.com/", false)]           // apex not covered by wildcard
    [InlineData("https://notexample.com/", false)]
    [InlineData("https://a.example.com.attacker.io/", false)]
    public async Task Wildcard_MatchesSubdomainsOnly(string url, bool allowed)
    {
        var decision = await Gate("*.example.com").EvaluateAsync(new Uri(url));
        Assert.Equal(allowed, decision.Allowed);
    }

    [Theory]
    [InlineData("ftp://app.example.com/")]
    [InlineData("file:///etc/passwd")]
    [InlineData("https://user:pw@app.example.com/")]
    public async Task RejectsNonHttpSchemesAndCredentials(string url)
    {
        var decision = await Gate("app.example.com").EvaluateAsync(new Uri(url));
        Assert.False(decision.Allowed);
    }

    [Theory]
    [InlineData("http://127.0.0.1/")]
    [InlineData("http://10.1.2.3/")]
    [InlineData("http://169.254.169.254/latest/meta-data/")]
    [InlineData("http://192.168.0.1/")]
    [InlineData("http://[::1]/")]
    [InlineData("http://[fd00::1]/")]
    public async Task PrivateIpLiterals_AreRejectedEvenIfListed(string url)
    {
        var host = new Uri(url).Host.Trim('[', ']');
        var decision = await Gate(host).EvaluateAsync(new Uri(url));
        Assert.False(decision.Allowed);
    }

    [Fact]
    public async Task EmptyScope_DeniesEverything()
    {
        var decision = await Gate().EvaluateAsync(new Uri("https://app.example.com/"));
        Assert.False(decision.Allowed);
        Assert.Contains("not in scope", decision.Reason);
    }

    [Fact]
    public async Task IdnHosts_AreComparedInPunycode()
    {
        var decision = await Gate("bücher.example.com").EvaluateAsync(new Uri("https://xn--bcher-kva.example.com/"));
        Assert.True(decision.Allowed);
    }

    [Theory]
    [InlineData("*")]
    [InlineData("*.com")]
    [InlineData("a*.example.com")]
    [InlineData("https://example.com")]
    [InlineData("example.com/path")]
    [InlineData("example.com:443")]
    [InlineData("*.10.0.0.1")]
    [InlineData("localhost")]
    [InlineData("")]
    public void InvalidPatterns_AreRejected(string pattern)
    {
        Assert.False(ScopePattern.TryParse(pattern, out _, out var error));
        Assert.NotEmpty(error);
    }

    [Theory]
    [InlineData("App.Example.com.", "app.example.com")]
    [InlineData("*.Example.com", "*.example.com")]
    [InlineData("203.0.113.5", "203.0.113.5")]
    public void ValidPatterns_AreNormalized(string input, string expected)
    {
        Assert.True(ScopePattern.TryParse(input, out var p, out _));
        Assert.Equal(expected, p!.Value);
    }

    [Theory]
    [InlineData("127.0.0.1", false)]
    [InlineData("0.0.0.0", false)]
    [InlineData("100.64.1.1", false)]
    [InlineData("172.31.255.255", false)]
    [InlineData("172.32.0.1", true)]
    [InlineData("8.8.8.8", true)]
    [InlineData("224.0.0.1", false)]
    [InlineData("::ffff:127.0.0.1", false)]
    [InlineData("::ffff:10.0.0.1", false)]
    [InlineData("fe80::1", false)]
    [InlineData("2606:4700:4700::1111", true)]
    [InlineData("2002:0a00:0001::1", false)]
    public void NetworkPolicy_ClassifiesAddresses(string ip, bool isPublic)
    {
        Assert.Equal(isPublic, NetworkPolicy.IsPublic(IPAddress.Parse(ip)));
    }
}
