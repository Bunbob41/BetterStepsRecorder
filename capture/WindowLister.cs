using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BetterSteps.Capture;

/// <summary>
/// Enumerates the top-level windows a user could sensibly point at. The UI has
/// no way to do this itself - Electron cannot see other applications' windows -
/// so the engine answers the question.
/// </summary>
internal static class WindowLister
{
    private delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int GetWindowTextLength(IntPtr hwnd);

    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TOOLWINDOW = 0x00000080;
    private const int DWMWA_CLOAKED = 14;

    internal sealed record WindowEntry(long Hwnd, uint Pid, string Title, string Process);

    internal static List<WindowEntry> List(HashSet<uint> excludePids)
    {
        var results = new List<WindowEntry>();

        EnumWindows((hwnd, _) =>
        {
            try
            {
                if (!IsWindowVisible(hwnd)) return true;
                if (GetWindowTextLength(hwnd) == 0) return true;

                // Tool windows are palettes and helpers, never what someone means
                // by "the application I am documenting".
                var ex = (long)Win32.GetWindowLongPtr(hwnd, GWL_EXSTYLE);
                if ((ex & WS_EX_TOOLWINDOW) != 0) return true;

                // Cloaked windows are the big one: every UWP app keeps invisible
                // ghost windows around, and without this the list is mostly junk
                // like "Windows Input Experience".
                if (Win32.DwmGetWindowAttributeInt(hwnd, DWMWA_CLOAKED, out var cloaked) == 0
                    && cloaked != 0) return true;

                Win32.GetWindowThreadProcessId(hwnd, out var pid);
                if (pid == 0 || excludePids.Contains(pid)) return true;

                var buffer = new char[512];
                var len = Win32.GetWindowText(hwnd, buffer, buffer.Length);
                if (len == 0) return true;
                var title = new string(buffer, 0, len).Trim();
                if (title.Length == 0) return true;

                var process = "";
                try { process = Process.GetProcessById((int)pid).ProcessName + ".exe"; }
                catch { /* exited or protected; the title still identifies it */ }

                results.Add(new WindowEntry(hwnd.ToInt64(), pid, title, process));
            }
            catch
            {
                // One awkward window must not abort the whole enumeration.
            }
            return true;
        }, IntPtr.Zero);

        return results
            .OrderBy(w => w.Process, StringComparer.OrdinalIgnoreCase)
            .ThenBy(w => w.Title, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }
}
