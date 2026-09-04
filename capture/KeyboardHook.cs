using System.Text;

namespace BetterSteps.Capture;

/// <summary>
/// Low-level keyboard hook. Translates keystrokes but never accumulates them:
/// aggregation and every privacy decision happen on the worker, and the hook
/// itself refuses to translate anything typed into a classic password control.
/// </summary>
internal sealed class KeyboardHook : IDisposable
{
    private readonly Recorder _recorder;
    private readonly Win32.HookProc _proc;   // field, not local: GC would collect it
    private IntPtr _handle;

    /// <summary>
    /// Chords the UI has claimed as global hotkeys. Pressing "stop recording"
    /// must not be the last thing the recording contains.
    /// </summary>
    internal HashSet<string> SuppressedChords { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    internal KeyboardHook(Recorder recorder)
    {
        _recorder = recorder;
        _proc = Callback;
    }

    internal bool Install()
    {
        _handle = Win32.SetWindowsHookEx(
            Win32.WH_KEYBOARD_LL, _proc, Win32.GetModuleHandle(null), 0);
        return _handle != IntPtr.Zero;
    }

    private IntPtr Callback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0) return Win32.CallNextHookEx(_handle, nCode, wParam, lParam);

        try
        {
            var msg = (int)wParam;
            if (msg == Win32.WM_KEYDOWN || msg == Win32.WM_SYSKEYDOWN)
            {
                var data = System.Runtime.InteropServices.Marshal
                    .PtrToStructure<Win32.KBDLLHOOKSTRUCT>(lParam);
                Handle(data);
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

    private void Handle(Win32.KBDLLHOOKSTRUCT data)
    {
        var vk = (int)data.vkCode;

        // Modifier keys are context for other keys, never steps of their own.
        if (vk is Win32.VK_SHIFT or Win32.VK_CONTROL or Win32.VK_MENU
               or Win32.VK_CAPITAL or Win32.VK_LWIN or Win32.VK_RWIN
               or 0xA0 or 0xA1 or 0xA2 or 0xA3 or 0xA4 or 0xA5) return;

        var focus = FocusedControl();
        var ctrl = Down(Win32.VK_CONTROL);
        var alt = Down(Win32.VK_MENU);
        var win = Down(Win32.VK_LWIN) || Down(Win32.VK_RWIN);
        var shift = Down(Win32.VK_SHIFT);

        var named = KeyNames.Name(vk);
        var scan = data.scanCode;

        // A chord is a command, not typing.
        if (ctrl || alt || win)
        {
            var label = named ?? Printable(vk, scan, shift) ?? "?";
            var chord = Modifiers(ctrl, alt, win, shift) + label.ToUpperInvariant();
            if (!SuppressedChords.Contains(chord)) _recorder.OfferKey(RawKey.Chord(focus, chord));
            return;
        }

        if (named is not null)
        {
            _recorder.OfferKey(RawKey.Named(focus, named));
            return;
        }

        // Cheap structural check before translating: a classic Win32 password
        // box is knowable without COM, so those characters are never produced
        // at all. UI Automation covers the rest, on the worker.
        if (IsPasswordStyle(focus))
        {
            _recorder.OfferKey(RawKey.Secret(focus));
            return;
        }

        var ch = Printable(vk, scan, shift);
        if (ch is not null) _recorder.OfferKey(RawKey.Text(focus, ch[0]));
    }

    private static bool Down(int vk) => (Win32.GetAsyncKeyState(vk) & 0x8000) != 0;

    private static string Modifiers(bool ctrl, bool alt, bool win, bool shift)
    {
        var sb = new StringBuilder();
        if (ctrl) sb.Append("Ctrl+");
        if (alt) sb.Append("Alt+");
        if (win) sb.Append("Win+");
        if (shift) sb.Append("Shift+");
        return sb.ToString();
    }

    /// <summary>The control with keyboard focus in the foreground window.</summary>
    private static IntPtr FocusedControl()
    {
        var fg = Win32.GetForegroundWindow();
        if (fg == IntPtr.Zero) return IntPtr.Zero;

        var tid = Win32.GetWindowThreadProcessId(fg, out _);
        var info = new Win32.GUITHREADINFO
        {
            cbSize = System.Runtime.InteropServices.Marshal.SizeOf<Win32.GUITHREADINFO>()
        };
        if (Win32.GetGUIThreadInfo(tid, ref info) && info.hwndFocus != IntPtr.Zero)
            return info.hwndFocus;

        return fg;
    }

    private static bool IsPasswordStyle(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        try
        {
            var cls = new char[64];
            var len = Win32.GetClassName(hwnd, cls, cls.Length);
            var name = len > 0 ? new string(cls, 0, len) : "";
            if (!name.Equals("Edit", StringComparison.OrdinalIgnoreCase)
                && !name.Contains("RichEdit", StringComparison.OrdinalIgnoreCase)) return false;

            var style = (long)Win32.GetWindowLongPtr(hwnd, Win32.GWL_STYLE);
            return (style & Win32.ES_PASSWORD) != 0;
        }
        catch { return false; }
    }

    /// <summary>Layout-correct character for a key, or null if it produces none.</summary>
    private static string? Printable(int vk, uint scanCode, bool shift)
    {
        var state = new byte[256];
        if (shift) state[Win32.VK_SHIFT] = 0x80;
        if ((Win32.GetKeyState(Win32.VK_CAPITAL) & 1) != 0) state[Win32.VK_CAPITAL] = 0x01;

        var fg = Win32.GetForegroundWindow();
        var layout = Win32.GetKeyboardLayout(
            fg == IntPtr.Zero ? 0 : Win32.GetWindowThreadProcessId(fg, out _));

        var buf = new StringBuilder(8);
        // wFlags bit 2 means "do not disturb the kernel keyboard state". Without
        // it this call corrupts dead-key sequences in the app being recorded,
        // so accented characters silently break while a recording is running.
        // The real scan code matters: passing 0 makes ToUnicodeEx fail for most
        // keys, which silently produced a keyboard hook that captured nothing.
        var n = Win32.ToUnicodeEx((uint)vk, scanCode, state, buf, buf.Capacity, 0x4, layout);
        if (n <= 0) return null;

        var s = buf.ToString();
        return s.Length > 0 && !char.IsControl(s[0]) ? s[..1] : null;
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

internal static class KeyNames
{
    internal static string? Name(int vk) => vk switch
    {
        0x08 => "Backspace",
        0x0D => "Enter", 0x09 => "Tab", 0x1B => "Esc",
        0x21 => "Page Up", 0x22 => "Page Down", 0x23 => "End", 0x24 => "Home",
        0x25 => "Left", 0x26 => "Up", 0x27 => "Right", 0x28 => "Down",
        0x2D => "Insert", 0x2E => "Delete",
        >= 0x70 and <= 0x87 => $"F{vk - 0x6F}",
        _ => null,
    };
}
