using ScopeScan.Core;
using ScopeScan.Core.Models;

namespace ScopeScan.Tests;

/// <summary>A temp data root that is deleted on dispose.</summary>
public sealed class TempDir : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "scopescan-tests", Guid.NewGuid().ToString("N"));
    public TempDir() => Directory.CreateDirectory(Path);
    public void Dispose()
    {
        try { Directory.Delete(Path, recursive: true); } catch (IOException) { }
    }
}

/// <summary>In-memory scope list for tests that don't exercise persistence.</summary>
public sealed class StaticScope(params string[] patterns) : IScopeRepository
{
    private readonly List<ScopeEntry> _entries = patterns
        .Select((p, i) => new ScopeEntry(i.ToString(), p, null, DateTimeOffset.UnixEpoch)).ToList();

    public Task<IReadOnlyList<ScopeEntry>> GetAllAsync(CancellationToken ct = default) => Task.FromResult<IReadOnlyList<ScopeEntry>>(_entries);
    public Task<ScopeEntry> AddAsync(string pattern, string? notes, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ScopeEntry?> UpdateAsync(string id, string pattern, string? notes, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> RemoveAsync(string id, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<IReadOnlyList<ScopeEntry>> ReplaceAllAsync(IEnumerable<(string Pattern, string? Notes)> entries, CancellationToken ct = default) => throw new NotSupportedException();
}
