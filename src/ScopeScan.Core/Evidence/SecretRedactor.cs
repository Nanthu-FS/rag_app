using System.Text.RegularExpressions;

namespace ScopeScan.Core.Evidence;

/// <summary>Masks secret-looking content before anything is stored as evidence.</summary>
public static partial class SecretRedactor
{
    public const string Mask = "[REDACTED]";
    public const int DefaultMaxLength = 500;

    public static string Redact(string? text, int maxLength = DefaultMaxLength)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var s = text;
        s = PrivateKeyRegex().Replace(s, "-----BEGIN $1PRIVATE KEY-----" + Mask + "-----END $1PRIVATE KEY-----");
        s = UrlCredentialsRegex().Replace(s, "$1" + Mask + "@");
        s = AuthHeaderRegex().Replace(s, "$1 " + Mask);
        s = JwtRegex().Replace(s, Mask);
        s = AwsKeyRegex().Replace(s, Mask);
        s = KnownTokenRegex().Replace(s, Mask);
        s = KeyValueRegex().Replace(s, m => m.Groups["key"].Value + m.Groups["sep"].Value + Mask);
        s = LongSecretRegex().Replace(s, Mask);
        return Truncate(s, maxLength);
    }

    /// <summary>Replaces every value in a Set-Cookie header, keeping only the name and attributes.</summary>
    public static string RedactSetCookie(string setCookie)
    {
        var parts = setCookie.Split(';');
        var eq = parts[0].IndexOf('=');
        parts[0] = eq < 0 ? parts[0] : parts[0][..eq] + "=" + Mask;
        return string.Join(";", parts);
    }

    public static string Truncate(string s, int maxLength) =>
        s.Length <= maxLength ? s : s[..maxLength] + "…[truncated]";

    [GeneratedRegex(@"-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)")]
    private static partial Regex PrivateKeyRegex();

    [GeneratedRegex(@"(\b[a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+@", RegexOptions.IgnoreCase)]
    private static partial Regex UrlCredentialsRegex();

    [GeneratedRegex(@"\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}", RegexOptions.IgnoreCase)]
    private static partial Regex AuthHeaderRegex();

    [GeneratedRegex(@"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}")]
    private static partial Regex JwtRegex();

    [GeneratedRegex(@"\b(AKIA|ASIA)[A-Z0-9]{16}\b")]
    private static partial Regex AwsKeyRegex();

    [GeneratedRegex(@"\b(gh[pousr]_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk_(live|test)_[A-Za-z0-9]{10,}|sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{30,})")]
    private static partial Regex KnownTokenRegex();

    // KEY=value / "key": "value" where the key name suggests a secret.
    [GeneratedRegex(@"(?<key>[""']?[A-Za-z0-9_.-]*(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|auth|dsn|conn(ection)?[_-]?string|session|cookie|salt)[A-Za-z0-9_.-]*[""']?)(?<sep>\s*[:=]\s*)(?!\[REDACTED\])[^\s,;&]+", RegexOptions.IgnoreCase)]
    private static partial Regex KeyValueRegex();

    // Any long opaque high-entropy-looking run (hex/base64) left over.
    [GeneratedRegex(@"\b[A-Za-z0-9+/_-]{40,}={0,2}")]
    private static partial Regex LongSecretRegex();
}
