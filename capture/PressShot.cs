using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace BetterSteps.Capture;

/// <summary>
/// The screen, copied from inside the mouse hook before the click was delivered.
///
/// This is the only moment guaranteed to come first. Windows hands a click to
/// the application only after every low-level hook has returned, so pixels
/// copied here cannot show anything the click did - not a tab that has
/// switched, not a menu that has opened, not a dialog that has closed.
///
/// Measured before this existed: a picture taken on the worker thread a few
/// milliseconds after the press still showed the tab already selected, because
/// tabs and menus act when the button goes DOWN and the application handles the
/// press before any other thread gets a look (D-71).
/// </summary>
internal sealed class PressShot
{
    private int _released;

    internal PressShot(Bitmap pixels, Rectangle area)
    {
        Pixels = pixels;
        Area = area;
    }

    /// <summary>The monitor's pixels, in physical screen pixels.</summary>
    internal Bitmap Pixels { get; }

    /// <summary>Where on the virtual screen those pixels came from.</summary>
    internal Rectangle Area { get; }

    /// <summary>Gives the buffer back for the next click. Safe to call twice.</summary>
    internal void Release()
    {
        if (Interlocked.Exchange(ref _released, 1) == 1) return;
        PressShots.Return(Pixels);
    }
}

/// <summary>Takes press shots, and keeps the buffers they are taken into.</summary>
internal static class PressShots
{
    /// <summary>
    /// Beyond this, a copy stops being attempted for the rest of the recording.
    ///
    /// Windows removes a low-level hook that is too slow, silently, and the
    /// recording then captures nothing at all while looking perfectly healthy.
    /// Measured on a 1920x1080 display: about 20ms, 33ms at the worst of sixty.
    /// A copy several times slower than that means something is wrong with the
    /// machine, and the recorder falls back to capturing just after the press
    /// rather than risk being evicted.
    /// </summary>
    private const double TooSlowMs = 150;

    // Two, because a press can be taken while the previous one is still being
    // written out; a third is allocated and thrown away rather than held.
    // Allocating a monitor's worth of pixels on every click would hand the
    // garbage collector a pause to take in the one place it must not.
    private static readonly Bitmap?[] Spares = new Bitmap?[2];

    private static volatile bool _disabled;
    private static double _slowMs;   // reported by the worker, never from the hook

    /// <summary>A slow machine gets a fresh chance with each recording.</summary>
    internal static void Enable() => _disabled = false;

    /// <summary>
    /// How slow the copy was that switched press shots off, once, for the worker
    /// to report. Nothing is written from inside the hook.
    /// </summary>
    internal static double? TakeSlowReport()
    {
        var ms = Interlocked.Exchange(ref _slowMs, 0);
        return ms > 0 ? ms : null;
    }

    /// <summary>
    /// Copies the monitor under the pointer. Called inside the hook, so it does
    /// nothing that can wait on another process: no window lookup, no UI
    /// Automation, no file.
    /// </summary>
    internal static PressShot? Take(Win32.POINT at) => Take(at, timed: true);

    /// <summary>
    /// Runs a copy once, off the hook, so the first real click does not pay for
    /// compiling this code and starting GDI+ - which, timed, would switch press
    /// shots off before the recording had begun.
    /// </summary>
    internal static void Warm(Win32.POINT at) => Take(at, timed: false)?.Release();

    private static PressShot? Take(Win32.POINT at, bool timed)
    {
        if (_disabled) return null;
        var clock = Stopwatch.StartNew();
        Bitmap? pixels = null;
        try
        {
            var monitor = Win32.MonitorFromPoint(at, Win32.MONITOR_DEFAULTTONEAREST);
            if (monitor == IntPtr.Zero) return null;
            var info = new Win32.MONITORINFOEX { cbSize = Marshal.SizeOf<Win32.MONITORINFOEX>() };
            if (!Win32.GetMonitorInfo(monitor, ref info)) return null;

            var area = Rectangle.FromLTRB(info.rcMonitor.Left, info.rcMonitor.Top,
                                          info.rcMonitor.Right, info.rcMonitor.Bottom);
            if (area.Width <= 0 || area.Height <= 0) return null;

            pixels = Borrow(area.Size);
            var screen = Win32.GetDC(IntPtr.Zero);
            if (screen == IntPtr.Zero) return null;

            bool copied;
            try
            {
                using var g = Graphics.FromImage(pixels);
                var hdc = g.GetHdc();
                try
                {
                    copied = Win32.BitBlt(hdc, 0, 0, area.Width, area.Height,
                                          screen, area.X, area.Y, Win32.SRCCOPY);
                }
                finally { g.ReleaseHdc(hdc); }
            }
            finally { Win32.ReleaseDC(IntPtr.Zero, screen); }

            if (!copied) return null;

            var shot = new PressShot(pixels, area);
            pixels = null;       // the shot owns it now
            return shot;
        }
        catch
        {
            // Never into the hook chain. A press without a picture falls back to
            // the worker's capture, which is a late picture and not a lost step.
            return null;
        }
        finally
        {
            if (pixels is not null) Return(pixels);
            if (timed && clock.Elapsed.TotalMilliseconds > TooSlowMs)
            {
                _disabled = true;
                Interlocked.Exchange(ref _slowMs, clock.Elapsed.TotalMilliseconds);
            }
        }
    }

    private static Bitmap Borrow(Size size)
    {
        for (var i = 0; i < Spares.Length; i++)
        {
            var spare = Interlocked.Exchange(ref Spares[i], null);
            if (spare is null) continue;
            if (spare.Width == size.Width && spare.Height == size.Height) return spare;
            spare.Dispose();   // sized for a different monitor
        }
        return new Bitmap(size.Width, size.Height, PixelFormat.Format32bppArgb);
    }

    internal static void Return(Bitmap pixels)
    {
        for (var i = 0; i < Spares.Length; i++)
        {
            if (Interlocked.CompareExchange(ref Spares[i], pixels, null) is null) return;
        }
        pixels.Dispose();
    }
}
