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
    internal static Rectangle ResolveBounds(IntPtr hwnd, Win32.POINT click)
    {
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

    internal static void CaptureTo(Rectangle bounds, string path, CaptureOptions options)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        using var shot = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(shot))
        {
            // CopyFromScreen over PrintWindow: PrintWindow returns black for many
            // GPU-composited apps (Chrome, Electron, anything hardware accelerated).
            g.CopyFromScreen(bounds.Location, System.Drawing.Point.Empty, bounds.Size);
        }

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

    private static Rectangle FromRect(Win32.RECT r) =>
        new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
}
