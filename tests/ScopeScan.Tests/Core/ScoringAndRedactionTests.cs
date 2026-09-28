using ScopeScan.Core.Evidence;
using ScopeScan.Core.Models;
using ScopeScan.Core.Scoring;

namespace ScopeScan.Tests.Core;

public class ScoringAndRedactionTests
{
    private static Finding F(Severity s, Confidence c = Confidence.High, string title = "t") =>
        new("id", title, s, null, "https://x.example.com/", "d", null, [], "r", c);

    [Fact]
    public void Score_WeightsBySeverityAndCapsAt100()
    {
        Assert.Equal(0, SeverityScorer.Score([]));
        Assert.Equal(0, SeverityScorer.Score([F(Severity.Info)]));
        Assert.Equal(31, SeverityScorer.Score([F(Severity.High), F(Severity.Medium), F(Severity.Low)]));
        Assert.Equal(100, SeverityScorer.Score(Enumerable.Repeat(F(Severity.Critical), 5)));
    }

    [Fact]
    public void Score_HalvesLowConfidenceFindings()
    {
        Assert.Equal(10, SeverityScorer.Score([F(Severity.High, Confidence.Low)]));
    }

    [Fact]
    public void Summarize_CountsEachSeverity()
    {
        var s = SeverityScorer.Summarize([F(Severity.High), F(Severity.High), F(Severity.Low), F(Severity.Info)]);
        Assert.Equal(new SeveritySummary(0, 2, 0, 1, 1), s);
        Assert.Equal(4, s.Total);
    }

    [Theory]
    [InlineData(0, "A")]
    [InlineData(8, "B")]
    [InlineData(28, "C")]
    [InlineData(60, "D")]
    [InlineData(61, "F")]
    public void Grade_Bands(int score, string grade) => Assert.Equal(grade, SeverityScorer.Grade(score));

    [Fact]
    public void Order_PutsMostSevereFirst()
    {
        var ordered = SeverityScorer.Order([F(Severity.Low, title: "b"), F(Severity.Critical), F(Severity.Low, title: "a")]);
        Assert.Equal(Severity.Critical, ordered[0].Severity);
        Assert.Equal("a", ordered[1].Title);
        Assert.Equal(Severity.Critical, SeverityScorer.Highest(ordered));
        Assert.Null(SeverityScorer.Highest([]));
    }

    [Theory]
    [InlineData("DB_PASSWORD=hunter2", "hunter2")]
    [InlineData("API_KEY: abcdef123456", "abcdef123456")]
    [InlineData("\"client_secret\": \"s3cr3t\"", "s3cr3t")]
    [InlineData("postgres://admin:topsecret@db.internal/app", "topsecret")]
    [InlineData("Authorization: Bearer abcdefghijklmnop", "abcdefghijklmnop")]
    [InlineData("key AKIAABCDEFGHIJKLMNOP here", "AKIAABCDEFGHIJKLMNOP")]
    [InlineData("tok eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpM", "SflKxwRJSMeKKF2QT4fwpM")]
    [InlineData("-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----", "MIIEow")]
    public void Redact_MasksSecrets(string input, string secret)
    {
        var redacted = SecretRedactor.Redact(input);
        Assert.DoesNotContain(secret, redacted);
        Assert.Contains(SecretRedactor.Mask, redacted);
    }

    [Fact]
    public void Redact_KeepsBenignTextAndTruncates()
    {
        Assert.Equal("ref: refs/heads/main", SecretRedactor.Redact("ref: refs/heads/main"));
        Assert.EndsWith("…[truncated]", SecretRedactor.Redact(string.Concat(Enumerable.Repeat("hello world ", 50)), 100));
        Assert.Equal(SecretRedactor.Mask, SecretRedactor.Redact(new string('b', 64)));
    }

    [Fact]
    public void RedactSetCookie_RemovesValueKeepsAttributes()
    {
        var r = SecretRedactor.RedactSetCookie("sessionid=abc123; Path=/; HttpOnly");
        Assert.Equal("sessionid=[REDACTED]; Path=/; HttpOnly", r);
    }
}
