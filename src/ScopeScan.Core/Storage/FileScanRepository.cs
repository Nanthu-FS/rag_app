using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using ScopeScan.Core.Models;

namespace ScopeScan.Core.Storage;

/// <summary>Stores each scan as data/scans/{yyyy-MM-dd}_{host}_{shortid}/scan.json with a per-scan lock.</summary>
public sealed partial class FileScanRepository(IStorageService storage, TimeProvider? clock = null) : IScanRepository
{
    public const string ScansFolder = "scans";
    public const string ScanFile = "scan.json";
    public const string ScreenshotsFolder = "screenshots";

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly ConcurrentDictionary<string, SemaphoreSlim> _locks = new();

    public static bool IsValidScanId(string? id) => id is not null && ScanIdRegex().IsMatch(id);

    public async Task<ScanResult> CreateAsync(string targetUrl, string host, bool permissionConfirmed, CancellationToken ct = default)
    {
        var now = _clock.GetUtcNow();
        var safeHost = HostSlugRegex().Replace(host.ToLowerInvariant(), "-").Trim('-');
        if (safeHost.Length == 0) safeHost = "target";
        if (safeHost.Length > 80) safeHost = safeHost[..80];

        for (var attempt = 0; attempt < 5; attempt++)
        {
            var id = $"{now:yyyy-MM-dd}_{safeHost}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant()}";
            var dir = Path.Combine(ScansFolder, id);
            if (storage.Exists(dir)) continue;

            var scan = new ScanResult
            {
                Id = id,
                TargetUrl = targetUrl,
                Host = host,
                PermissionConfirmed = permissionConfirmed,
                CreatedAt = now,
                Status = ScanStatus.Pending,
            };
            await SaveAsync(scan, ct);
            return scan;
        }
        throw new IOException("Could not allocate a unique scan id.");
    }

    public async Task SaveAsync(ScanResult scan, CancellationToken ct = default)
    {
        var gate = LockFor(scan.Id);
        await gate.WaitAsync(ct);
        try { await WriteAsync(scan, ct); }
        finally { gate.Release(); }
    }

    public async Task<ScanResult> UpdateAsync(string scanId, Func<ScanResult, ScanResult> update, CancellationToken ct = default)
    {
        var gate = LockFor(scanId);
        await gate.WaitAsync(ct);
        try
        {
            var current = await ReadAsync(scanId, ct) ?? throw new KeyNotFoundException($"Scan '{scanId}' not found.");
            var updated = update(current);
            if (updated.Id != scanId) throw new InvalidOperationException("Scan id cannot change.");
            await WriteAsync(updated, ct);
            return updated;
        }
        finally { gate.Release(); }
    }

    public Task<ScanResult?> GetAsync(string scanId, CancellationToken ct = default) =>
        IsValidScanId(scanId) ? ReadAsync(scanId, ct) : Task.FromResult<ScanResult?>(null);

    public async Task<IReadOnlyList<ScanResult>> ListAsync(CancellationToken ct = default)
    {
        var results = new List<ScanResult>();
        foreach (var dir in storage.ListDirectories(ScansFolder).Where(IsValidScanId))
        {
            try
            {
                var scan = await ReadAsync(dir, ct);
                if (scan is not null) results.Add(scan);
            }
            catch (JsonException) { /* skip corrupt folders rather than failing the listing */ }
        }
        return results.OrderByDescending(s => s.CreatedAt).ToList();
    }

    public async Task<string> SaveScreenshotAsync(string scanId, string fileName, byte[] png, CancellationToken ct = default)
    {
        if (!IsValidScanId(scanId)) throw new ArgumentException("Invalid scan id.", nameof(scanId));
        if (!FileNameRegex().IsMatch(fileName) || !fileName.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Invalid screenshot file name.", nameof(fileName));
        var relative = $"{ScreenshotsFolder}/{fileName}";
        await storage.WriteBytesAtomicAsync(Path.Combine(ScansFolder, scanId, ScreenshotsFolder, fileName), png, ct);
        return relative;
    }

    public string? GetScanFilePath(string scanId, string relativeName)
    {
        if (!IsValidScanId(scanId)) return null;
        var parts = relativeName.Replace('\\', '/').Split('/');
        if (parts.Length is < 1 or > 2 || parts.Any(p => !FileNameRegex().IsMatch(p))) return null;
        try { return storage.GetFullPath(Path.Combine([ScansFolder, scanId, .. parts])); }
        catch (ArgumentException) { return null; }
    }

    private async Task<ScanResult?> ReadAsync(string scanId, CancellationToken ct)
    {
        var json = await storage.ReadTextAsync(Path.Combine(ScansFolder, scanId, ScanFile), ct);
        return json is null ? null : JsonSerializer.Deserialize<ScanResult>(json, JsonDefaults.Options);
    }

    private Task WriteAsync(ScanResult scan, CancellationToken ct)
    {
        if (!IsValidScanId(scan.Id)) throw new ArgumentException("Invalid scan id.");
        var json = JsonSerializer.Serialize(scan, JsonDefaults.Options);
        return storage.WriteTextAtomicAsync(Path.Combine(ScansFolder, scan.Id, ScanFile), json, ct);
    }

    private SemaphoreSlim LockFor(string scanId) => _locks.GetOrAdd(scanId, _ => new SemaphoreSlim(1, 1));

    [GeneratedRegex(@"^\d{4}-\d{2}-\d{2}_[a-z0-9-]{1,80}_[a-f0-9]{8}$")]
    private static partial Regex ScanIdRegex();

    [GeneratedRegex(@"[^a-z0-9]+")]
    private static partial Regex HostSlugRegex();

    [GeneratedRegex(@"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")]
    private static partial Regex FileNameRegex();
}
