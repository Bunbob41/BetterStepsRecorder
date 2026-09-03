using System.Runtime.InteropServices;

namespace BetterSteps.Capture;

/// <summary>Raw Win32 surface. Nothing in here makes decisions; it only marshals.</summary>
internal static class Win32
{
    // ---- DPI ----------------------------------------------------------------
    // PER_MONITOR_AWARE_V2. Set before any window/DC work or every coordinate
    // we report gets silently scaled by the OS and lands in the wrong place.
    internal static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new(-4);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    [DllImport("shcore.dll")]
    internal static extern int GetDpiForMonitor(IntPtr hmonitor, int dpiType, out uint dpiX, out uint dpiY);

    internal const int MDT_EFFECTIVE_DPI = 0;

    // ---- Monitors -----------------------------------------------------------
    [DllImport("user32.dll")]
    internal static extern IntPtr MonitorFromPoint(POINT pt, uint flags);

    internal const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX lpmi);

    // ---- Hooks --------------------------------------------------------------
    internal const int WH_MOUSE_LL = 14;
    internal const int WM_LBUTTONDOWN = 0x0201;
    internal const int WM_LBUTTONUP   = 0x0202;
    internal const int WM_RBUTTONDOWN = 0x0204;
    internal const int WM_RBUTTONUP   = 0x0205;

    internal delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    internal static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    internal static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern IntPtr GetModuleHandle(string? lpModuleName);

    // ---- Message pump -------------------------------------------------------
    [DllImport("user32.dll")]
    internal static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    internal static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    internal static extern IntPtr DispatchMessage(ref MSG lpMsg);

    [DllImport("user32.dll")]
    internal static extern bool PostThreadMessage(uint idThread, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll")]
    internal static extern uint GetCurrentThreadId();

    internal const uint WM_QUIT = 0x0012;

    // ---- Windows ------------------------------------------------------------
    [DllImport("user32.dll")]
    internal static extern IntPtr WindowFromPoint(POINT pt);

    [DllImport("user32.dll")]
    internal static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

    internal const uint GA_ROOT = 2;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    internal static extern int GetWindowText(IntPtr hWnd, char[] lpString, int nMaxCount);

    [DllImport("user32.dll")]
    internal static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll")]
    internal static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    internal static extern int GetDoubleClickTime();

    // Real visible bounds. GetWindowRect includes the invisible resize border on
    // composited windows, which shows up as dead space around every screenshot.
    [DllImport("dwmapi.dll")]
    internal static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out RECT value, int size);

    internal const int DWMWA_EXTENDED_FRAME_BOUNDS = 9;

    [StructLayout(LayoutKind.Sequential)]
    internal struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MSG
    {
        public IntPtr hwnd; public uint message; public IntPtr wParam;
        public IntPtr lParam; public uint time; public POINT pt;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct MSLLHOOKSTRUCT
    {
        public POINT pt; public uint mouseData; public uint flags;
        public uint time; public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    internal struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string szDevice;
    }
}
