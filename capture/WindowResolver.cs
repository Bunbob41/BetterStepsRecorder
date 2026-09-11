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

    /// <summary>
    /// The window a step should be framed as, given the window under the pointer.
    ///
    /// Usually the same window. Not when that window is a menu or a dropdown
    /// list: those are windows of their own, and framed by themselves they came
    /// out as slivers - a dropdown 224 pixels by 51, a menu with no application
    /// around it - which is no use in a procedure. Framed as the window they
    /// belong to, they appear where they were, open, over it.
    ///
    /// Followed through OWNERS rather than parents, one popup at a time, and only
    /// while the window is a popup: a dropdown in a dialog is framed as the
    /// dialog, not as the application that owns the dialog.
    /// </summary>
    internal static IntPtr FrameWindowFor(IntPtr under, IntPtr foreground)
    {
        var current = under;
        for (var hops = 0; hops < 8 && current != IntPtr.Zero && IsTransientPopup(current); hops++)
        {
            // A popup menu usually has no owner at all; the window that opened it
            // is the one that was active when the button went down.
            var owner = Win32.GetWindow(current, Win32.GW_OWNER);
            if (owner == IntPtr.Zero) owner = foreground;
            if (owner == IntPtr.Zero) break;

            var root = Win32.GetAncestor(owner, Win32.GA_ROOT);
            if (root == IntPtr.Zero) root = owner;
            if (root == current) break;
            current = root;
        }
        return current == IntPtr.Zero ? under : current;
    }

    /// <summary>
    /// A window that exists to be dismissed: a menu, a dropdown list, a tooltip.
    ///
    /// Recognised by class where Windows gives it one, and otherwise by shape - a
    /// popup that has an owner and no title bar. A dialog is ALSO an owned popup,
    /// and it is the step rather than a decoration on it; the title bar is what
    /// tells the two apart.
    /// </summary>
    internal static bool IsTransientPopup(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;

        var cls = ClassOf(hwnd);
        if (cls is "#32768" or "ComboLBox" or "tooltips_class32") return true;

        var style = (long)Win32.GetWindowLongPtr(hwnd, Win32.GWL_STYLE);
        var popup = (style & Win32.WS_POPUP) != 0;
        var titled = (style & Win32.WS_CAPTION) == Win32.WS_CAPTION;
        var owned = Win32.GetWindow(hwnd, Win32.GW_OWNER) != IntPtr.Zero;
        return popup && owned && !titled;
    }

    private static string ClassOf(IntPtr hwnd)
    {
        var buffer = new char[256];
        var len = Win32.GetClassName(hwnd, buffer, buffer.Length);
        return len > 0 ? new string(buffer, 0, len) : "";
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
