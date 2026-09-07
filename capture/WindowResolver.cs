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

    internal static uint ProcessIdOf(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return 0;
        Win32.GetWindowThreadProcessId(hwnd, out var pid);
        return pid;
    }

    internal static WindowInfo? Describe(IntPtr hwnd, Rectangle bounds)
    {
        if (hwnd == IntPtr.Zero) return null;

        var buffer = new char[512];
        var len = Win32.GetWindowText(hwnd, buffer, buffer.Length);
        var title = len > 0 ? new string(buffer, 0, len) : "";

        var process = "";
        var product = "";
        try
        {
            Win32.GetWindowThreadProcessId(hwnd, out var pid);
            if (pid != 0)
            {
                var p = Process.GetProcessById((int)pid);
                process = p.ProcessName + ".exe";
                product = ProductNameOf(p);
            }
        }
        catch
        {
            // Process exited, or protected (elevated target from a normal
            // process). A missing name must not cost us the step.
        }

        return new WindowInfo(title, process,
            new RectInfo(bounds.X, bounds.Y, bounds.Width, bounds.Height), product);
    }

    /// <summary>
    /// What an executable calls itself: "Google Chrome" for chrome.exe.
    /// </summary>
    /// <remarks>
    /// Windows already knows the good name - it is the FileDescription every
    /// executable carries - and "explorer.exe" is nobody's idea of an answer
    /// when somebody is trying to remember which recording is which.
    ///
    /// Cached by process id. This runs once per captured step, and reading
    /// version information means opening the file on disk; a recording of four
    /// hundred steps in one application would otherwise do it four hundred
    /// times for the same answer.
    /// </remarks>
    private static readonly Dictionary<int, string> ProductCache = new();

    internal static string ProductNameOf(Process p)
    {
        int id;
        try
        {
            // Even reading the id throws for a Process object with nothing
            // behind it, so the cache lookup cannot sit outside the guard.
            id = p.Id;
        }
        catch
        {
            return "";
        }

        if (ProductCache.TryGetValue(id, out var cached)) return cached;

        var name = "";
        try
        {
            // MainModule throws for a protected or elevated process, and for a
            // 64-bit process seen from a 32-bit one. Failing here costs the
            // friendly name and nothing else.
            var file = p.MainModule?.FileName;
            if (!string.IsNullOrEmpty(file))
            {
                var info = FileVersionInfo.GetVersionInfo(file);
                name = (info.FileDescription ?? "").Trim();
                if (name.Length == 0) name = (info.ProductName ?? "").Trim();
            }
        }
        catch
        {
            // Left empty; the interface falls back to the filename.
        }

        // Cached either way, including the empty answer: a process that will
        // not tell us will not tell us on the next step either.
        ProductCache[id] = name;
        return name;
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
