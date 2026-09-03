using System.IO;
using System.Drawing;
using System.Drawing.Imaging;

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

    internal static void CaptureTo(Rectangle bounds, string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        using var bmp = new Bitmap(bounds.Width, bounds.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            // CopyFromScreen over PrintWindow: PrintWindow returns black for many
            // GPU-composited apps (Chrome, Electron, anything hardware accelerated).
            g.CopyFromScreen(bounds.Location, System.Drawing.Point.Empty, bounds.Size);
        }

        bmp.Save(path, ImageFormat.Png);
    }

    private static Rectangle FromRect(Win32.RECT r) =>
        new(r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top);
}
