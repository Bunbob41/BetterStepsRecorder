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
                    Press(data.pt, now);
                    break;

                case Win32.WM_LBUTTONUP when _leftDown:
                    _leftDown = false;
                    var moved = Math.Abs(data.pt.X - _downPoint.X) > DragThresholdPx
                             || Math.Abs(data.pt.Y - _downPoint.Y) > DragThresholdPx;
                    _recorder.Offer(new RawEvent(
                        moved ? "drag" : "leftClick", _downPoint, data.pt, now));
                    break;

                case Win32.WM_RBUTTONDOWN:
                    Press(data.pt, now);
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

    /// <summary>
    /// A button going down: copy the screen now, before this callback returns.
    ///
    /// The one moment guaranteed to come before the application sees the click,
    /// because Windows does not deliver it until every low-level hook has
    /// returned. Doing the work on the worker thread instead - even a few
    /// milliseconds after the press - measurably lost to tabs and menus, which
    /// act on the way down: the picture showed the tab already switched.
    ///
    /// The cost is one monitor's pixels copied into a reused buffer, about 20ms
    /// measured on a 1920x1080 display. Nothing else happens here - no window
    /// lookup (WindowFromPoint can wait on a hung application), no UI Automation,
    /// no encoding, no file - and none of it at all unless a recording wants it.
    /// </summary>
    private void Press(Win32.POINT pt, DateTime now)
    {
        if (!_recorder.WantsPress) return;
        // Asked once, before the copy: whether to copy at all depends on it (a
        // full-screen game is not copied), and the worker needs the same answer.
        var foreground = Win32.GetForegroundWindow();
        var shot = PressShots.Take(pt, foreground);
        if (!_recorder.OfferPress(new RawPress(pt, now, shot, foreground)))
            shot?.Release();
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
