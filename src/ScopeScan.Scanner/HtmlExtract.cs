using System.Net;
using System.Text.RegularExpressions;

namespace ScopeScan.Scanner;

/// <summary>Lightweight, regex-based extraction from HTML. Good enough for passive discovery; never executes anything.</summary>
public static partial class HtmlExtract
{
    public static IEnumerable<Uri> ScriptSources(string html, Uri baseUri) =>
        Resolve(ScriptSrcRegex().Matches(html).Select(m => m.Groups["v"].Value), baseUri);

    public static IEnumerable<Uri> Links(string html, Uri baseUri) =>
        Resolve(HrefRegex().Matches(html).Select(m => m.Groups["v"].Value), baseUri);

    public static IEnumerable<string> InlineScripts(string html) =>
        InlineScriptRegex().Matches(html).Select(m => m.Groups["body"].Value).Where(s => s.Length > 0);

    public static string? MetaGenerator(string html) =>
        MetaGeneratorRegex().Match(html) is { Success: true } m ? WebUtility.HtmlDecode(m.Groups["v"].Value) : null;

    public static string? Title(string html) =>
        TitleRegex().Match(html) is { Success: true } m ? WebUtility.HtmlDecode(m.Groups["v"].Value.Trim()) : null;

    private static IEnumerable<Uri> Resolve(IEnumerable<string> values, Uri baseUri)
    {
        var seen = new HashSet<string>();
        foreach (var raw in values)
        {
            var v = WebUtility.HtmlDecode(raw.Trim());
            if (v.Length == 0 || v.StartsWith('#') || v.StartsWith("javascript:", StringComparison.OrdinalIgnoreCase) ||
                v.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase) || v.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
                continue;
            if (!Uri.TryCreate(baseUri, v, out var uri) || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps)) continue;
            if (seen.Add(uri.AbsoluteUri)) yield return uri;
        }
    }

    [GeneratedRegex(@"<script\b[^>]*?\bsrc\s*=\s*[""']?(?<v>[^""'\s>]+)", RegexOptions.IgnoreCase)]
    private static partial Regex ScriptSrcRegex();

    [GeneratedRegex(@"<a\b[^>]*?\bhref\s*=\s*[""']?(?<v>[^""'\s>]+)", RegexOptions.IgnoreCase)]
    private static partial Regex HrefRegex();

    [GeneratedRegex(@"<script\b(?![^>]*\bsrc\s*=)[^>]*>(?<body>[\s\S]*?)</script>", RegexOptions.IgnoreCase)]
    private static partial Regex InlineScriptRegex();

    [GeneratedRegex(@"<meta\b[^>]*name\s*=\s*[""']generator[""'][^>]*content\s*=\s*[""'](?<v>[^""']+)|<meta\b[^>]*content\s*=\s*[""'](?<v>[^""']+)[""'][^>]*name\s*=\s*[""']generator[""']", RegexOptions.IgnoreCase)]
    private static partial Regex MetaGeneratorRegex();

    [GeneratedRegex(@"<title[^>]*>(?<v>[^<]{0,300})</title>", RegexOptions.IgnoreCase)]
    private static partial Regex TitleRegex();
}
