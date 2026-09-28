using Microsoft.Extensions.Time.Testing;
using ScopeScan.Core.Models;
using ScopeScan.Core.Scope;
using ScopeScan.Core.Storage;

namespace ScopeScan.Tests.Core;

public class StorageTests : IDisposable
{
    private readonly TempDir _dir = new();
    private readonly FileStorageService _storage;
    private readonly FakeTimeProvider _clock = new(new DateTimeOffset(2026, 9, 28, 12, 0, 0, TimeSpan.Zero));

    public StorageTests() => _storage = new FileStorageService(_dir.Path);
    public void Dispose() => _dir.Dispose();

    [Fact]
    public async Task AtomicWrite_ReplacesContentAndLeavesNoTempFiles()
    {
        await _storage.WriteTextAtomicAsync("a/b.json", "one");
        await _storage.WriteTextAtomicAsync("a/b.json", "two");
        Assert.Equal("two", await _storage.ReadTextAsync("a/b.json"));
        Assert.Empty(Directory.GetFiles(Path.Combine(_dir.Path, "a"), "*.tmp"));
    }

    [Theory]
    [InlineData("../outside.txt")]
    [InlineData("scans/../../x")]
    [InlineData("/etc/passwd")]
    public void PathTraversal_IsRejected(string path)
    {
        Assert.Throws<ArgumentException>(() => _storage.GetFullPath(path));
    }

    [Fact]
    public async Task ScanRepository_CreatesDatedFolderAndRoundTrips()
    {
        var repo = new FileScanRepository(_storage, _clock);
        var scan = await repo.CreateAsync("https://app.example.com/", "app.example.com", true);

        Assert.Matches(@"^2026-09-28_app-example-com_[a-f0-9]{8}$", scan.Id);
        Assert.True(File.Exists(Path.Combine(_dir.Path, "scans", scan.Id, "scan.json")));

        var finding = new Finding("f1", "Missing CSP", Severity.Medium, "CWE-693", "https://app.example.com/", "d", "e", [], "r", Confidence.High);
        await repo.SaveAsync(scan with { Status = ScanStatus.Completed, Findings = [finding] });

        var loaded = await repo.GetAsync(scan.Id);
        Assert.NotNull(loaded);
        Assert.Equal(ScanStatus.Completed, loaded!.Status);
        Assert.True(loaded.PermissionConfirmed);
        Assert.Equal(Severity.Medium, Assert.Single(loaded.Findings).Severity);
        Assert.Contains("\"Medium\"", await File.ReadAllTextAsync(Path.Combine(_dir.Path, "scans", scan.Id, "scan.json")));
    }

    [Fact]
    public async Task ScanRepository_ConcurrentUpdatesAreSerialized()
    {
        var repo = new FileScanRepository(_storage, _clock);
        var scan = await repo.CreateAsync("https://app.example.com/", "app.example.com", true);

        await Task.WhenAll(Enumerable.Range(0, 20).Select(i => repo.UpdateAsync(scan.Id, s => s with
        {
            Requests = [.. s.Requests, new RequestLogEntry(DateTimeOffset.UnixEpoch, "GET", $"https://app.example.com/{i}", 200, "t", null)],
        })));

        Assert.Equal(20, (await repo.GetAsync(scan.Id))!.Requests.Count);
    }

    [Fact]
    public async Task ScanRepository_ListsNewestFirstAndRejectsBadIds()
    {
        var repo = new FileScanRepository(_storage, _clock);
        var first = await repo.CreateAsync("https://a.example.com/", "a.example.com", true);
        _clock.Advance(TimeSpan.FromDays(1));
        var second = await repo.CreateAsync("https://b.example.com/", "b.example.com", true);
        Directory.CreateDirectory(Path.Combine(_dir.Path, "scans", "not-a-scan"));

        var list = await repo.ListAsync();
        Assert.Equal([second.Id, first.Id], list.Select(s => s.Id));
        Assert.Null(await repo.GetAsync("../scope"));
        Assert.Null(repo.GetScanFilePath(first.Id, "../../scope.json"));
    }

    [Fact]
    public async Task ScanRepository_SavesScreenshots()
    {
        var repo = new FileScanRepository(_storage, _clock);
        var scan = await repo.CreateAsync("https://a.example.com/", "a.example.com", true);
        var rel = await repo.SaveScreenshotAsync(scan.Id, "full-page.png", [0x89, 0x50]);
        Assert.Equal("screenshots/full-page.png", rel);
        Assert.True(File.Exists(repo.GetScanFilePath(scan.Id, rel)));
        await Assert.ThrowsAsync<ArgumentException>(() => repo.SaveScreenshotAsync(scan.Id, "../x.png", [1]));
    }

    [Fact]
    public async Task ScopeRepository_ValidatesNormalizesAndPersists()
    {
        var repo = new FileScopeRepository(_storage, _clock);
        var entry = await repo.AddAsync("  App.Example.com ", "prod");
        Assert.Equal("app.example.com", entry.Pattern);
        await Assert.ThrowsAsync<ArgumentException>(() => repo.AddAsync("app.example.com", null));
        await Assert.ThrowsAsync<ArgumentException>(() => repo.AddAsync("*.com", null));

        var updated = await repo.UpdateAsync(entry.Id, "*.example.com", "all subs");
        Assert.Equal("*.example.com", updated!.Pattern);

        var reloaded = await new FileScopeRepository(_storage).GetAllAsync();
        Assert.Equal("*.example.com", Assert.Single(reloaded).Pattern);

        Assert.True(await repo.RemoveAsync(entry.Id));
        Assert.Empty(await repo.GetAllAsync());
    }

    [Fact]
    public async Task ScopeRepository_ImportIsAllOrNothing()
    {
        var repo = new FileScopeRepository(_storage, _clock);
        await repo.AddAsync("keep.example.com", null);

        await Assert.ThrowsAsync<ArgumentException>(() => repo.ReplaceAllAsync([("a.example.com", null), ("*", null)]));
        Assert.Equal("keep.example.com", Assert.Single(await repo.GetAllAsync()).Pattern);

        var imported = await repo.ReplaceAllAsync([("a.example.com", null), ("A.example.com", "dup"), ("*.b.example.com", null)]);
        Assert.Equal(2, imported.Count);
    }

    [Fact]
    public async Task ScopeGate_ReadsFromPersistedScope()
    {
        var repo = new FileScopeRepository(_storage, _clock);
        var gate = new ScopeGate(repo);
        Assert.False((await gate.EvaluateAsync(new Uri("https://app.example.com/"))).Allowed);
        await repo.AddAsync("app.example.com", null);
        Assert.True((await gate.EvaluateAsync(new Uri("https://app.example.com/"))).Allowed);
    }
}
