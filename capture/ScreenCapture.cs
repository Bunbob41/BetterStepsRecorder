using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Linq;

namespace BetterSteps.Capture;

internal static class ScreenCapture
{
    /// <summary>
    /// Grabs the window under the click. Falls back to a region around the
    /// cursor when the window is offscreen, minimised or degenerate, so a step
    /// is never lost just because we could not resolve a frame.
    /// </summary>
    internal static Rectangle ResolveBounds(IntPtr hwnd, Win32.POINT click,
                                            string frame = "window")
    {
        var virtualScreenAll = SystemInformation.VirtualScreen;

        if (frame == "screen") return virtualScreenAll;
        if (frame == "monitor") return MonitorBounds(click, virtualScreenAll);

        Rectangle rect = Rectangle.Empty;

        // Extended frame bounds first: excludes the invisible resize border that
        // GetWindowRect reports, which otherwise pads every shot with desktop.
        if (hwnd != IntPtr.Zero &&
            Win32.DwmGetWindowAttribute(hwnd, Win32.DWMWA_EXTENDED_FRAME_BOUNDS,
                out var dwm, System.Runtime.InteropServices.Marshal.SizeOf<Win32.RECT>()) == 0)
        {
            rect = FromRect(dwm);
        }

        if (rect.Width <= 0 || rect.Height <= 0)
        {
            if (hwnd != IntPtr.Zero && Win32.GetWindowRect(hwnd, out var wr))
                rect = FromRect(wr);
        }

        var virtualScreen = SystemInformation.VirtualScreen;
        rect.Intersect(virtualScreen);

        if (rect.Width <= 0 || rect.Height <= 0)
        {
            // Last resort: a fixed window around the click point.
            rect = new Rectangle(click.X - 400, click.Y - 300, 800, 600);
            rect.Intersect(virtualScreen);
        }

        return rect;
    }

    /// <summary>
    /// Captures a step.
    /// </summary>
    /// <remarks>
    /// When framing a window, the window is asked to draw itself rather than
    /// copied off the screen. Copying the screen takes whatever is physically in
    /// that rectangle, which includes anything sitting on top of the window -
    /// and this application's own recording strip is always on top, so it landed
    /// in the middle of the screenshots of the very procedure being documented.
    /// A reader then sees Pause and Stop buttons that are not part of the
    /// software the guide is about.
    ///
    /// PrintWindow renders only that window's content, so overlapping windows
    /// are excluded by construction - our strip, notification toasts, and any
    /// other application's tooltips alike. It needs PW_RENDERFULLCONTENT to work
    /// on GPU-composited applications; without that flag it does return black,
    /// which is what the previous comment here recorded.
    ///
    /// It is still best-effort. Some windows report success and draw nothing, so
    /// the result is checked and the screen copy used when it looks empty.
    /// Monitor and full-screen framing have no single window to ask and are
    /// always copied from the screen.
    /// </remarks>
    internal static void CaptureTo(Rectangle bounds, string path, CaptureOptions options,
                                   IntPtr hwnd = default)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        var drawn = options.Frame == "window" ? CaptureWindow(hwnd, bounds) : null;

        using var shot = drawn ?? new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        if (drawn is null)
        {
            using var g = Graphics.FromImage(shot);
            g.CopyFromScreen(bounds.Location, System.Drawing.Point.Empty, bounds.Size);
        }

        Encode(shot, path, options);
    }

    /// <summary>Writes a picture the way every capture is written, whatever took it.</summary>
    private static void Encode(Bitmap shot, string path, CaptureOptions options)
    {
        // Only dispose a downscaled copy: at the default scale `image` IS `shot`,
        // and declaring both with `using` disposed the same Bitmap twice.
        var scaled = options.Scale < 1.0 ? Downscale(shot, options.Scale) : null;
        var image = scaled ?? shot;

        try
        {
            if (options.Format == "jpeg")
            {
                SaveJpeg(image, path, options.Quality);
            }
            else
            {
                image.Save(path, ImageFormat.Png);
            }
        }
        finally
        {
            scaled?.Dispose();
        }
    }

    /// <summary>
    /// The part of a frame the pixels copied at the press can supply, or null
    /// when they cannot supply enough of it.
    ///
    /// A maximised window's frame overhangs its monitor by a few pixels of
    /// invisible border - HYPACK reported 9,0 1922x1031 on a 1920-wide display -
    /// so "entirely inside" would refuse the commonest window there is. The
    /// overhang is trimmed instead. A window dragged half onto the next monitor
    /// is another matter: half a dialog is not a picture of it, so below nine
    /// tenths the caller captures the usual way.
    /// </summary>
    internal static Rectangle? PressCrop(Rectangle copied, Rectangle frame)
    {
        if (frame.Width <= 0 || frame.Height <= 0) return null;
        var kept = frame;
        kept.Intersect(copied);
        if (kept.Width <= 0 || kept.Height <= 0) return null;
        return (long)kept.Width * kept.Height * 10 >= (long)frame.Width * frame.Height * 9
            ? kept
            : null;
    }

    /// <summary>
    /// Writes part of the pixels copied at the press. `copiedArea` is where on the
    /// virtual screen they came from; a second monitor starts at 1920, not 0, and
    /// forgetting that cuts the wrong rectangle without failing.
    /// </summary>
    internal static void SaveCrop(Bitmap copied, Rectangle copiedArea, Rectangle crop,
                                  string path, CaptureOptions options)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var local = crop;
        local.Offset(-copiedArea.X, -copiedArea.Y);
        using var shot = copied.Clone(local, PixelFormat.Format32bppArgb);
        Encode(shot, path, options);
    }

    /// <summary>
    /// A frame widened to take in a popup that belongs to it. A menu hangs off
    /// the bottom of a small window, and a dropdown can open past a dialog's
    /// edge; framed as the window alone, the thing that was clicked is cut off.
    /// </summary>
    internal static Rectangle Including(Rectangle frame, IntPtr popup)
    {
        if (popup == IntPtr.Zero || !Win32.GetWindowRect(popup, out var r)) return frame;
        var extra = FromRect(r);
        if (extra.Width <= 0 || extra.Height <= 0) return frame;
        var both = Rectangle.Union(frame, extra);
        both.Intersect(SystemInformation.VirtualScreen);
        return both;
    }

    /// <summary>
    /// Asks a window to draw itself. Returns null when that is not possible, so
    /// the caller falls back to copying the screen and a step is never lost.
    /// </summary>
    private static Bitmap? CaptureWindow(IntPtr hwnd, Rectangle bounds)
    {
        if (hwnd == IntPtr.Zero) return null;
        if (!Win32.GetWindowRect(hwnd, out var wr)) return null;

        // PrintWindow draws the whole window rect, which includes the invisible
        // resize border; `bounds` is the DWM frame. Render the former, return
        // the latter, so framing matches what copying the screen produced.
        var full = FromRect(wr);
        if (full.Width <= 0 || full.Height <= 0) return null;
        if (full.Width > 20000 || full.Height > 20000) return null;

        Bitmap? bmp = null;
        try
        {
            bmp = new Bitmap(full.Width, full.Height, PixelFormat.Format32bppArgb);
            bool ok;
            using (var g = Graphics.FromImage(bmp))
            {
                var hdc = g.GetHdc();
                try { ok = Win32.PrintWindow(hwnd, hdc, Win32.PW_RENDERFULLCONTENT); }
                finally { g.ReleaseHdc(hdc); }
            }

            // The window drew itself at ITS dpi, into a bitmap sized at the
            // monitor's. Correct that before anything else looks at the pixels
            // - including the blank test, which would otherwise be counting a
            // quarter of untouched bitmap as though it were part of the render.
            var render = RenderScale(hwnd);
            if (render > 1.01) bmp = ScaleDrawnPart(bmp, render);

            if (!ok || IsBlank(bmp)) { bmp.Dispose(); return null; }

            var crop = bounds;
            crop.Offset(-full.X, -full.Y);
            crop.Intersect(new Rectangle(0, 0, bmp.Width, bmp.Height));
            if (crop.Width <= 0 || crop.Height <= 0) return bmp;
            if (crop.Width == bmp.Width && crop.Height == bmp.Height) return bmp;

            var cropped = bmp.Clone(crop, bmp.PixelFormat);
            bmp.Dispose();
            return cropped;
        }
        catch
        {
            // A window that cannot be drawn is not a reason to lose the step.
            bmp?.Dispose();
            return null;
        }
    }

    /// <summary>
    /// How much larger a window's rectangle is than the window's own drawing.
    ///
    /// This process is per-monitor DPI aware, so a window's rectangle is in real
    /// screen pixels. An application that never declared itself DPI aware does
    /// not draw in those: Windows renders it at 96 dpi and the desktop scales
    /// the result up on the way to the screen. `PrintWindow` hands back what the
    /// application drew, not what the desktop showed - so on a display at 125%
    /// the picture arrives three quarters the size of the bitmap it was asked
    /// for, sitting in the top-left corner with the rest untouched.
    ///
    /// Every consequence of that looked like a different bug. A quarter of each
    /// screenshot was blank. The click marker, which is a percentage of the
    /// frame, was displaced by a quarter of its distance from the corner - a few
    /// pixels near the top-left, a hundred at the bottom right, and nothing at
    /// all on a display at 100%, which is why it seemed to come and go.
    ///
    /// Returns 1.0 when the two agree, which is the case for a DPI-aware
    /// application and for any monitor at 100%.
    /// </summary>
    private static double RenderScale(IntPtr hwnd)
    {
        try
        {
            var windowDpi = Win32.GetDpiForWindow(hwnd);
            if (windowDpi == 0) return 1.0;

            var hmon = Win32.MonitorFromWindow(hwnd, Win32.MONITOR_DEFAULTTONEAREST);
            if (hmon == IntPtr.Zero) return 1.0;
            if (Win32.GetDpiForMonitor(hmon, Win32.MDT_EFFECTIVE_DPI, out var monitorDpi, out _) != 0)
                return 1.0;
            if (monitorDpi == 0) return 1.0;

            var scale = (double)monitorDpi / windowDpi;
            // Anything outside this is not a scaling factor, it is a bad answer.
            return scale > 1.01 && scale < 8.0 ? scale : 1.0;
        }
        catch
        {
            return 1.0;
        }
    }

    /// <summary>
    /// Takes the part of the bitmap the window actually drew into and stretches
    /// it to fill the frame.
    ///
    /// Scaling up rather than cropping down on purpose: the frame recorded with
    /// the step has to stay the size of the picture, because the marker and
    /// every mark are percentages of it, and because this is what the person saw
    /// - the desktop was scaling this window up for them too.
    /// </summary>
    private static Bitmap ScaleDrawnPart(Bitmap bmp, double scale)
    {
        var w = Math.Max(1, Math.Min(bmp.Width, (int)Math.Round(bmp.Width / scale)));
        var h = Math.Max(1, Math.Min(bmp.Height, (int)Math.Round(bmp.Height / scale)));
        if (w == bmp.Width && h == bmp.Height) return bmp;

        Bitmap? full = null;
        try
        {
            using var drawn = bmp.Clone(new Rectangle(0, 0, w, h), bmp.PixelFormat);
            full = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(full))
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                g.DrawImage(drawn, new Rectangle(0, 0, bmp.Width, bmp.Height));
            }
            bmp.Dispose();
            return full;
        }
        catch
        {
            // A correction that fails is not worth losing the step over.
            full?.Dispose();
            return bmp;
        }
    }

    /// <summary>
    /// Whether PrintWindow drew nothing. A failed render leaves the bitmap as it
    /// was allocated, which is pure black, so a grid of samples finding no
    /// colour at all means the window did not draw. A real window is never
    /// uniformly black across its whole frame - it has a title bar and borders.
    /// </summary>
    private static bool IsBlank(Bitmap bmp)
    {
        const int Steps = 24;
        var dx = Math.Max(1, bmp.Width / Steps);
        var dy = Math.Max(1, bmp.Height / Steps);

        var dark = 0;
        var seen = 0;
        for (var y = 0; y < bmp.Height; y += dy)
        {
            for (var x = 0; x < bmp.Width; x += dx)
            {
                seen++;
                var c = bmp.GetPixel(x, y);
                if (c.R <= 24 && c.G <= 24 && c.B <= 24) dark++;
            }
        }

        if (seen == 0) return true;

        // Nearly all of it, not all of it. A window drawing through the graphics
        // card gives back its title bar and border with a black hole where the
        // content should be - which passed a test that asked whether the whole
        // bitmap was black, and went into somebody's guide as a black rectangle.
        //
        // A window that is genuinely almost pure black is rare, and the cost of
        // being wrong is small: the caller copies that region of the screen
        // instead, which is a correct picture by another route.
        return dark >= seen * 0.9;
    }

    private static Bitmap Downscale(Bitmap source, double scale)
    {
        var w = Math.Max(1, (int)Math.Round(source.Width * scale));
        var h = Math.Max(1, (int)Math.Round(source.Height * scale));

        var scaled = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(scaled);
        // HighQualityBicubic: screenshots are mostly text and thin borders, which
        // the cheaper filters turn to mush.
        g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
        g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
        g.DrawImage(source, 0, 0, w, h);
        return scaled;
    }

    private static void SaveJpeg(Bitmap image, string path, int quality)
    {
        var codec = ImageCodecInfo.GetImageEncoders()
            .FirstOrDefault(c => c.FormatID == ImageFormat.Jpeg.Guid);

        if (codec is null) { image.Save(path, ImageFormat.Png); return; }

        using var parameters = new EncoderParameters(1);
        parameters.Param[0] = new EncoderParameter(Encoder.Quality, (long)quality);

        // JPEG has no alpha channel; compositing onto white avoids black fringes
        // where the window had transparent corners.
        using var flat = new Bitmap(image.Width, image.Height, PixelFormat.Format24bppRgb);
        using (var g = Graphics.FromImage(flat))
        {
            g.Clear(Color.White);
            g.DrawImageUnscaled(image, 0, 0);
        }

        flat.Save(path, codec, parameters);
    }

    /// <summary>The display the click landed on, or the whole desktop if unknown.</summary>
    private static Rectangle MonitorBounds(Win32.POINT click, Rectangle fallback)
    {
        var hmon = Win32.MonitorFromPoint(click, Win32.MONITOR_DEFAULTTONEAREST);
        if (hmon == IntPtr.Zero) return fallback;

        var mi = new Win32.MONITORINFOEX
        {
            cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Win32.MONITORINFOEX>()
        };
        if (!Win32.GetMonitorInfo(hmon, ref mi)) return fallback;

        var r = FromRect(mi.rcMonitor);
        return r.Width > 0 && r.Height > 0 ? r : fallback;
    }

    private static Rectangle FromRect(Win32.RECT r) =>
        new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
}
