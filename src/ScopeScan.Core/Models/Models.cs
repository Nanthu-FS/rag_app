using System.Text.Json.Serialization;

namespace ScopeScan.Core.Models;

[JsonConverter(typeof(JsonStringEnumConverter<Severity>))]
public enum Severity
{
    Info = 0,
    Low = 1,
    Medium = 2,
    High = 3,
    Critical = 4,
}

[JsonConverter(typeof(JsonStringEnumConverter<Confidence>))]
public enum Confidence
{
    Low,
    Medium,
    High,
}

[JsonConverter(typeof(JsonStringEnumConverter<ScanStatus>))]
public enum ScanStatus
{
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

/// <summary>An allowlisted host. Pattern is an exact host ("app.example.com") or "*.example.com".</summary>
public sealed record ScopeEntry(
    string Id,
    string Pattern,
    string? Notes,
    DateTimeOffset CreatedAt);

public sealed record ScanRequest(string Url, bool PermissionConfirmed);

public sealed record Finding(
    string Id,
    string Title,
    Severity Severity,
    string? Cwe,
    string AffectedUrl,
    string Description,
    string? Evidence,
    IReadOnlyList<string> ScreenshotPaths,
    string Remediation,
    Confidence Confidence)
{
    /// <summary>Identifier of the check that produced this finding.</summary>
    public string CheckId { get; init; } = "";
}

public sealed record RequestLogEntry(
    DateTimeOffset At,
    string Method,
    string Url,
    int? StatusCode,
    string Purpose,
    string? Error);

public sealed record CheckRun(
    string CheckId,
    DateTimeOffset StartedAt,
    DateTimeOffset CompletedAt,
    int FindingCount,
    string? Error);

public sealed record SeveritySummary(int Critical, int High, int Medium, int Low, int Info)
{
    public int Total => Critical + High + Medium + Low + Info;
}

public sealed record ScanResult
{
    public required string Id { get; init; }
    public required string TargetUrl { get; init; }
    public required string Host { get; init; }
    public required bool PermissionConfirmed { get; init; }
    public DateTimeOffset CreatedAt { get; init; }
    public DateTimeOffset? CompletedAt { get; init; }
    public ScanStatus Status { get; init; } = ScanStatus.Pending;
    public string? Error { get; init; }
    public IReadOnlyList<Finding> Findings { get; init; } = [];
    public IReadOnlyList<CheckRun> ChecksRun { get; init; } = [];
    public IReadOnlyList<RequestLogEntry> Requests { get; init; } = [];
    public IReadOnlyList<string> Screenshots { get; init; } = [];
    public SeveritySummary? Summary { get; init; }
    public int? RiskScore { get; init; }
}

public sealed record ScanProgress(
    string ScanId,
    string Stage,
    string Message,
    int Percent,
    DateTimeOffset At);
