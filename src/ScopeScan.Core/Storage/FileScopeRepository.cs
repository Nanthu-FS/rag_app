using System.Text.Json;
using ScopeScan.Core.Models;
using ScopeScan.Core.Scope;

namespace ScopeScan.Core.Storage;

/// <summary>Scope allowlist persisted at data/scope.json. Patterns are validated and normalized on write.</summary>
public sealed class FileScopeRepository(IStorageService storage, TimeProvider? clock = null) : IScopeRepository
{
    public const string ScopeFile = "scope.json";

    private sealed record ScopeDocument(IReadOnlyList<ScopeEntry> Entries);

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly SemaphoreSlim _lock = new(1, 1);

    public async Task<IReadOnlyList<ScopeEntry>> GetAllAsync(CancellationToken ct = default)
    {
        var json = await storage.ReadTextAsync(ScopeFile, ct);
        if (string.IsNullOrWhiteSpace(json)) return [];
        return JsonSerializer.Deserialize<ScopeDocument>(json, JsonDefaults.Options)?.Entries ?? [];
    }

    public Task<ScopeEntry> AddAsync(string pattern, string? notes, CancellationToken ct = default) =>
        MutateAsync(entries =>
        {
            var normalized = Normalize(pattern);
            if (entries.Any(e => e.Pattern == normalized))
                throw new ArgumentException($"'{normalized}' is already in scope.");
            var entry = new ScopeEntry(Guid.NewGuid().ToString(), normalized, Clean(notes), _clock.GetUtcNow());
            entries.Add(entry);
            return entry;
        }, ct);

    public Task<ScopeEntry?> UpdateAsync(string id, string pattern, string? notes, CancellationToken ct = default) =>
        MutateAsync(entries =>
        {
            var index = entries.FindIndex(e => e.Id == id);
            if (index < 0) return null;
            var normalized = Normalize(pattern);
            if (entries.Any(e => e.Id != id && e.Pattern == normalized))
                throw new ArgumentException($"'{normalized}' is already in scope.");
            entries[index] = entries[index] with { Pattern = normalized, Notes = Clean(notes) };
            return (ScopeEntry?)entries[index];
        }, ct);

    public Task<bool> RemoveAsync(string id, CancellationToken ct = default) =>
        MutateAsync(entries => entries.RemoveAll(e => e.Id == id) > 0, ct);

    public Task<IReadOnlyList<ScopeEntry>> ReplaceAllAsync(IEnumerable<(string Pattern, string? Notes)> newEntries, CancellationToken ct = default) =>
        MutateAsync(entries =>
        {
            // Validate everything first so a bad import leaves the file untouched.
            var parsed = newEntries.Select(e => (Pattern: Normalize(e.Pattern), e.Notes)).DistinctBy(e => e.Pattern).ToList();
            entries.Clear();
            entries.AddRange(parsed.Select(e => new ScopeEntry(Guid.NewGuid().ToString(), e.Pattern, Clean(e.Notes), _clock.GetUtcNow())));
            return (IReadOnlyList<ScopeEntry>)entries.ToList();
        }, ct);

    private async Task<T> MutateAsync<T>(Func<List<ScopeEntry>, T> mutate, CancellationToken ct)
    {
        await _lock.WaitAsync(ct);
        try
        {
            var entries = (await GetAllAsync(ct)).ToList();
            var result = mutate(entries);
            var json = JsonSerializer.Serialize(new ScopeDocument(entries), JsonDefaults.Options);
            await storage.WriteTextAtomicAsync(ScopeFile, json, ct);
            return result;
        }
        finally { _lock.Release(); }
    }

    private static string Normalize(string pattern) =>
        ScopePattern.TryParse(pattern, out var parsed, out var error) ? parsed!.Value : throw new ArgumentException(error);

    private static string? Clean(string? notes)
    {
        var n = notes?.Trim();
        return string.IsNullOrEmpty(n) ? null : n.Length > 500 ? n[..500] : n;
    }
}
