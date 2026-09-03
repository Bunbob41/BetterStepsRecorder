using System.Diagnostics;
using System.Drawing;

namespace BetterSteps.Capture;

internal static class WindowResolver
{
    internal static IntPtr RootWindowAt(Win32.POINT pt)
    {
        var hwnd = Win32.WindowFromPoint(pt);
        if (hwnd == IntPtr.Zero) return IntPtr.Zero;
        // WindowFromPoint returns the child control; we want the top-level frame.
        var root = Win32.GetAncestor(hwnd, Win32.GA_ROOT);
        return root != IntPtr.Zero ? root : hwnd;
    }

    internal static WindowInfo? Describe(IntPtr hwnd, Rectangle bounds)
    {
        if (hwnd == IntPtr.Zero) return null;

        var buffer = new char[512];
        var len = Win32.GetWindowText(hwnd, buffer, buffer.Length);
        var title = len > 0 ? new string(buffer, 0, len) : "";

        var process = "";
        try
        {
            Win32.GetWindowThreadProcessId(hwnd, out var pid);
            if (pid != 0) process = Process.GetProcessById((int)pid).ProcessName + ".exe";
        }
        catch
        {
            // Process exited, or protected (elevated target from a normal
            // process). A missing name must not cost us the step.
        }

        return new WindowInfo(title, process,
            new RectInfo(bounds.X, bounds.Y, bounds.Width, bounds.Height));
    }

    /// <summary>Monitor index and DPI scale for the monitor the click landed on.</summary>
    internal static MonitorInfo DescribeMonitor(Win32.POINT pt)
    {
        var scale = 1.0;
        var index = 0;

        var hmon = Win32.MonitorFromPoint(pt, Win32.MONITOR_DEFAULTTONEAREST);
        if (hmon != IntPtr.Zero)
        {
            if (Win32.GetDpiForMonitor(hmon, Win32.MDT_EFFECTIVE_DPI, out var dpiX, out _) == 0 && dpiX > 0)
                scale = dpiX / 96.0;

            var mi = new Win32.MONITORINFOEX
            {
                cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Win32.MONITORINFOEX>()
            };
            if (Win32.GetMonitorInfo(hmon, ref mi))
            {
                var screens = Screen.AllScreens;
                for (var i = 0; i < screens.Length; i++)
                {
                    if (screens[i].DeviceName == mi.szDevice) { index = i; break; }
                }
            }
        }

        return new MonitorInfo(index, scale);
    }
}
