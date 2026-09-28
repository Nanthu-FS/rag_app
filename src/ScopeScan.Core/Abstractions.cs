using ScopeScan.Core.Models;

namespace ScopeScan.Core;

/// <summary>Low-level file persistence rooted at the data directory. All paths are relative to that root.</summary>
public interface IStorageService
{
    string DataRoot { get; }

    /// <summary>Resolves a relative path under the data root; throws if it escapes the root.</summary>
    string GetFullPath(string relativePath);

    Task WriteTextAtomicAsync(string relativePath, string content, CancellationToken ct = default);
    Task WriteBytesAtomicAsync(string relativePath, byte[] content, CancellationToken ct = default);
    Task<string?> ReadTextAsync(string relativePath, CancellationToken ct = default);
    Task<byte[]?> ReadBytesAsync(string relativePath, CancellationToken ct = default);
    bool Exists(string relativePath);
    IReadOnlyList<string> ListDirectories(string relativePath);
}

public interface IScanRepository
{
    /// <summary>Allocates a scan folder ({yyyy-MM-dd}_{host}_{shortid}) and persists the initial scan.json.</summary>
    Task<ScanResult> CreateAsync(string targetUrl, string host, bool permissionConfirmed, CancellationToken ct = default);

    Task SaveAsync(ScanResult scan, CancellationToken ct = default);

    /// <summary>Loads, transforms and saves a scan under the per-scan lock.</summary>
    Task<ScanResult> UpdateAsync(string scanId, Func<ScanResult, ScanResult> update, CancellationToken ct = default);

    Task<ScanResult?> GetAsync(string scanId, CancellationToken ct = default);
    Task<IReadOnlyList<ScanResult>> ListAsync(CancellationToken ct = default);

    /// <summary>Saves a PNG under the scan's screenshots folder; returns the path relative to the scan folder.</summary>
    Task<string> SaveScreenshotAsync(string scanId, string fileName, byte[] png, CancellationToken ct = default);

    /// <summary>Absolute path to a file inside a scan folder, or null if the id/name is invalid.</summary>
    string? GetScanFilePath(string scanId, string relativeName);
}

public interface IScopeRepository
{
    Task<IReadOnlyList<ScopeEntry>> GetAllAsync(CancellationToken ct = default);
    Task<ScopeEntry> AddAsync(string pattern, string? notes, CancellationToken ct = default);
    Task<ScopeEntry?> UpdateAsync(string id, string pattern, string? notes, CancellationToken ct = default);
    Task<bool> RemoveAsync(string id, CancellationToken ct = default);
    Task<IReadOnlyList<ScopeEntry>> ReplaceAllAsync(IEnumerable<(string Pattern, string? Notes)> entries, CancellationToken ct = default);
}

public sealed record ScopeDecision(bool Allowed, string Reason, string? MatchedPattern = null)
{
    public static ScopeDecision Deny(string reason) => new(false, reason);
}

public interface IScopeGate
{
    Task<ScopeDecision> EvaluateAsync(Uri uri, CancellationToken ct = default);
}

/// <summary>A request was refused before being sent (scope, SSRF, method policy).</summary>
public class RequestBlockedException(string message) : Exception(message);

public sealed class OutOfScopeException(string message) : RequestBlockedException(message);
