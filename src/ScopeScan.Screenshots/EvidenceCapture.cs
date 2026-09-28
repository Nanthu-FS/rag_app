using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using ScopeScan.Core;
using ScopeScan.Core.Models;
using ScopeScan.Scanner;

namespace ScopeScan.Screenshots;

public sealed record EvidenceResult(IReadOnlyList<Finding> Findings, IReadOnlyList<string> ScanScreenshots, IReadOnlyList<string> Errors);

/// <summary>
/// Captures scan evidence and attaches it to findings: a full-page screenshot of the target, a rendered
/// headers-summary panel (attached to header/cookie findings) and highlighted reflection screenshots.
/// A failed capture is recorded but never fails the scan.
/// </summary>
public sealed partial class EvidenceCapture(IScreenshotService screenshots, IScanRepository repository, TimeProvider? clock = null, ILogger<EvidenceCapture>? logger = null)
{
    public const int MaxReflectionShots = 3;
    public const string FullPageFile = "full-page.png";
    public const string HeadersFile = "headers-summary.png";

    private static readonly HashSet<string> HeaderChecks = ["security-headers", "info-leak-headers", "cookie-flags"];

    private readonly TimeProvider _clock = clock ?? TimeProvider.System;
    private readonly ILogger _logger = logger ?? NullLogger<EvidenceCapture>.Instance;

    public async Task<EvidenceResult> CaptureAsync(ScanContext ctx, IReadOnlyList<Finding> findings, CancellationToken ct = default)
    {
        var scanShots = new List<string>();
        var errors = new List<string>();
        var attachments = new Dictionary<string, List<string>>(); // finding id -> paths

        async Task<string?> TryAsync(string what, Func<Task<string>> capture)
        {
            try { return await capture(); }
            catch (Exception ex) when (ex is not OperationCanceledException || !ct.IsCancellationRequested)
            {
                _logger.LogWarning(ex, "Evidence capture '{What}' failed", what);
                errors.Add($"{what}: {ex.Message}");
                return null;
            }
        }

        if (await TryAsync("full-page screenshot", async () =>
            {
                var shot = await screenshots.CaptureFullPageAsync(ctx.Target, ctx.Http, ct);
                return await repository.SaveScreenshotAsync(ctx.ScanId, FullPageFile, shot.Png, ct);
            }) is { } full)
            scanShots.Add(full);

        if (findings.Any(f => HeaderChecks.Contains(f.CheckId)) &&
            await TryAsync("headers panel", async () =>
            {
                var baseline = await ctx.GetBaselineAsync();
                var png = await screenshots.RenderHtmlAsync(HeadersPanelRenderer.Render(baseline, _clock.GetUtcNow()), ct);
                return await repository.SaveScreenshotAsync(ctx.ScanId, HeadersFile, png, ct);
            }) is { } headers)
        {
            scanShots.Add(headers);
            foreach (var f in findings.Where(f => HeaderChecks.Contains(f.CheckId))) Attach(f.Id, headers);
        }

        var index = 0;
        foreach (var f in findings.Where(f => f.CheckId == "reflected-parameters" && f.Severity >= Severity.Low)
                                  .OrderByDescending(f => f.Severity).Take(MaxReflectionShots))
        {
            if (MarkerRegex().Match(f.AffectedUrl) is not { Success: true } m || !Uri.TryCreate(f.AffectedUrl, UriKind.Absolute, out var url)) continue;
            var name = $"reflection-{++index}.png";
            if (await TryAsync($"reflection screenshot {f.Id}", async () =>
                {
                    var shot = await screenshots.CaptureReflectionAsync(url, m.Value, ctx.Http, ct);
                    return await repository.SaveScreenshotAsync(ctx.ScanId, name, shot.Png, ct);
                }) is { } path)
                Attach(f.Id, path);
        }

        var updated = findings.Select(f => attachments.TryGetValue(f.Id, out var paths)
            ? f with { ScreenshotPaths = [.. f.ScreenshotPaths, .. paths] }
            : f).ToList();
        return new EvidenceResult(updated, scanShots, errors);

        void Attach(string id, string path)
        {
            if (!attachments.TryGetValue(id, out var list)) attachments[id] = list = [];
            list.Add(path);
        }
    }

    [GeneratedRegex(ScanContext.MarkerPrefix + "[a-z0-9]+")]
    private static partial Regex MarkerRegex();
}
