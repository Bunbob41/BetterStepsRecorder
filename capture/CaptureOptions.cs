namespace BetterSteps.Capture;

/// <summary>How screenshots are encoded. Sent by the UI on the start command.</summary>
internal sealed class CaptureOptions
{
    /// <summary>"png" or "jpeg".</summary>
    public string Format { get; init; } = "png";

    /// <summary>JPEG quality 1-100. Ignored for PNG.</summary>
    public int Quality { get; init; } = 85;

    /// <summary>
    /// Downscale factor, 0.25-1.0. The honest way to shrink a recording:
    /// unlike JPEG quality it degrades text predictably rather than smearing it.
    /// </summary>
    public double Scale { get; init; } = 1.0;

    /// <summary>
    /// What each screenshot frames: "window" (just the window under the click),
    /// "monitor" (the whole display it landed on) or "screen" (every monitor).
    /// Window is the default because it crops the noise and keeps images small;
    /// the others matter when the context around the click is the point, or when
    /// the click has no window at all - the desktop, the taskbar, a tray icon.
    /// </summary>
    public string Frame { get; init; } = "window";

    public string Extension => Format.Equals("jpeg", StringComparison.OrdinalIgnoreCase) ? "jpg" : "png";

    public static CaptureOptions Clamp(string? format, int? quality, double? scale,
                                       string? frame = null) => new()
    {
        Format = format?.ToLowerInvariant() is "jpeg" or "jpg" ? "jpeg" : "png",
        Quality = Math.Clamp(quality ?? 85, 1, 100),
        Scale = Math.Clamp(scale ?? 1.0, 0.25, 1.0),
        Frame = frame?.ToLowerInvariant() switch
        {
            "monitor" => "monitor",
            "screen" => "screen",
            _ => "window",
        },
    };
}
