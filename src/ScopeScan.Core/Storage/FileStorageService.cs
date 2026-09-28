using System.Text;

namespace ScopeScan.Core.Storage;

/// <summary>File-system storage under a data root. Writes go to a temp file and are renamed into place.</summary>
public sealed class FileStorageService : IStorageService
{
    public string DataRoot { get; }

    public FileStorageService(string dataRoot)
    {
        DataRoot = Path.GetFullPath(dataRoot);
        Directory.CreateDirectory(DataRoot);
    }

    public string GetFullPath(string relativePath)
    {
        if (Path.IsPathRooted(relativePath))
            throw new ArgumentException("Path must be relative to the data root.", nameof(relativePath));
        var full = Path.GetFullPath(Path.Combine(DataRoot, relativePath));
        var root = DataRoot.EndsWith(Path.DirectorySeparatorChar) ? DataRoot : DataRoot + Path.DirectorySeparatorChar;
        if (!full.StartsWith(root, StringComparison.Ordinal) && full != DataRoot)
            throw new ArgumentException("Path escapes the data root.", nameof(relativePath));
        return full;
    }

    public Task WriteTextAtomicAsync(string relativePath, string content, CancellationToken ct = default) =>
        WriteBytesAtomicAsync(relativePath, Encoding.UTF8.GetBytes(content), ct);

    public async Task WriteBytesAtomicAsync(string relativePath, byte[] content, CancellationToken ct = default)
    {
        var target = GetFullPath(relativePath);
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        var temp = $"{target}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var fs = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None, 4096, FileOptions.WriteThrough))
            {
                await fs.WriteAsync(content, ct);
                await fs.FlushAsync(ct);
            }
            File.Move(temp, target, overwrite: true);
        }
        finally
        {
            if (File.Exists(temp)) File.Delete(temp);
        }
    }

    public async Task<string?> ReadTextAsync(string relativePath, CancellationToken ct = default)
    {
        var path = GetFullPath(relativePath);
        return File.Exists(path) ? await File.ReadAllTextAsync(path, ct) : null;
    }

    public async Task<byte[]?> ReadBytesAsync(string relativePath, CancellationToken ct = default)
    {
        var path = GetFullPath(relativePath);
        return File.Exists(path) ? await File.ReadAllBytesAsync(path, ct) : null;
    }

    public bool Exists(string relativePath)
    {
        var path = GetFullPath(relativePath);
        return File.Exists(path) || Directory.Exists(path);
    }

    public IReadOnlyList<string> ListDirectories(string relativePath)
    {
        var path = GetFullPath(relativePath);
        return Directory.Exists(path)
            ? Directory.GetDirectories(path).Select(Path.GetFileName).OfType<string>().ToList()
            : [];
    }
}
