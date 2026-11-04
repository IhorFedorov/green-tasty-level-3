using System;
using System.Linq;

namespace APIHandler.Helpers;

public static class CatalogImageUrl
{
    public static string FromKey(string key)
    {
        var decoded = Uri.UnescapeDataString(key);
        if (!(decoded.StartsWith("assets/img/dishes/", StringComparison.Ordinal) || decoded.StartsWith("assets/img/locations/", StringComparison.Ordinal)) ||
            decoded.Split('/').Any(part => part is "." or "..") || decoded.Contains('\\') || decoded.Contains('?') || decoded.Contains('#'))
            throw new ArgumentException("Only catalog image prefixes may use the images CDN.", nameof(key));
        var configured = Environment.GetEnvironmentVariable("IMAGES_CDN_BASE_URL");
        if (!Uri.TryCreate(configured, UriKind.Absolute, out var origin) || origin.Scheme != "https" ||
            !origin.Host.EndsWith(".cloudfront.net", StringComparison.OrdinalIgnoreCase) || !origin.IsDefaultPort ||
            origin.UserInfo.Length != 0 || origin.AbsolutePath != "/" || origin.Query.Length != 0 || origin.Fragment.Length != 0)
            throw new InvalidOperationException("IMAGES_CDN_BASE_URL must be the HTTPS Terraform CloudFront origin.");
        return origin.GetLeftPart(UriPartial.Authority) + "/" + string.Join("/", decoded.Split('/').Select(Uri.EscapeDataString));
    }

    // Map owned legacy URLs only when returning DTOs; no persistence migration.
    public static string? Resolve(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return null;
        if (!Uri.TryCreate(stored, UriKind.Absolute, out var url) || !(url.Scheme is "https" or "http")) return stored;
        var bucket = Environment.GetEnvironmentVariable("imagesBucketName");
        if (string.IsNullOrWhiteSpace(bucket)) return stored;
        var region = Environment.GetEnvironmentVariable("REGION");
        string? key = null;
        if (new[] { $"{bucket}.s3.amazonaws.com", $"{bucket}.s3.{region}.amazonaws.com", $"{bucket}.s3-{region}.amazonaws.com" }.Contains(url.Host, StringComparer.OrdinalIgnoreCase))
            key = url.AbsolutePath.TrimStart('/');
        else if (new[] { "s3.amazonaws.com", $"s3.{region}.amazonaws.com", $"s3-{region}.amazonaws.com" }.Contains(url.Host, StringComparer.OrdinalIgnoreCase) && url.AbsolutePath.StartsWith("/" + bucket + "/", StringComparison.Ordinal))
            key = url.AbsolutePath[(bucket.Length + 2)..];
        if (key is null || !(key.StartsWith("assets/img/dishes/", StringComparison.Ordinal) || key.StartsWith("assets/img/locations/", StringComparison.Ordinal))) return stored;
        return FromKey(key);
    }
}
