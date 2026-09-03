namespace BetterSteps.Capture;

internal sealed class MouseHook : IDisposable
{
    private const int DragThresholdPx = 6;

    private readonly Recorder _recorder;
    private readonly Win32.HookProc _proc;   // field, not local: GC would collect it
    private IntPtr _handle;

    private Win32.POINT _downPoint;
    private bool _leftDown;

    internal MouseHook(Recorder recorder)
    {
        _recorder = recorder;
        _proc = Callback;
    }

    internal bool Install()
    {
        _handle = Win32.SetWindowsHookEx(
            Win32.WH_MOUSE_LL, _proc, Win32.GetModuleHandle(null), 0);
        return _handle != IntPtr.Zero;
    }

    private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return Win32.CallNextHookEx(_handle, nCode, wParam, lParam);

        try
        {
            var data = System.Runtime.InteropServices.Marshal
                .PtrToStructure<Win32.MSLLHOOKSTRUCT>(lParam);
            var now = DateTime.UtcNow;

            switch ((int)wParam)
            {
                case Win32.WM_LBUTTONDOWN:
                    _downPoint = data.pt;
                    _leftDown = true;
                    break;

                case Win32.WM_LBUTTONUP when _leftDown:
                    _leftDown = false;
                    var moved = Math.Abs(data.pt.X - _downPoint.X) > DragThresholdPx
                             || Math.Abs(data.pt.Y - _downPoint.Y) > DragThresholdPx;
                    _recorder.Offer(new RawEvent(
                        moved ? "drag" : "leftClick", _downPoint, data.pt, now));
                    break;

                case Win32.WM_RBUTTONUP:
                    _recorder.Offer(new RawEvent("rightClick", data.pt, data.pt, now));
                    break;
            }
        }
        catch (Exception ex)
        {
            // Never let an exception escape into the hook chain; that takes the
            // hook down for every application on the desktop, not just ours.
            Protocol.Error("HOOK_CALLBACK", ex.Message);
        }

        return Win32.CallNextHookEx(_handle, nCode, wParam, lParam);
    }

    public void Dispose()
    {
        if (_handle != IntPtr.Zero)
        {
            Win32.UnhookWindowsHookEx(_handle);
            _handle = IntPtr.Zero;
        }
    }
}
