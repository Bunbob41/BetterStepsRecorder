using System.IO;
using System.Text;
using System.Text.Json;

namespace BetterSteps.Capture;

internal static class Program
{
    private static Recorder? _recorder;
    private static MouseHook? _hook;
    private static KeyboardHook? _keyboard;
    private static uint _mainThreadId;

    [STAThread]
    private static int Main()
    {
        // Before anything else. Once a DC or window exists the process DPI mode
        // is locked in, and every coordinate we report would be virtualised.
        var dpiOk = Win32.SetProcessDpiAwarenessContext(
            Win32.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

        Console.OutputEncoding = new UTF8Encoding(false);
        _mainThreadId = Win32.GetCurrentThreadId();

        _recorder = new Recorder();
        _hook = new MouseHook(_recorder);

        if (!_hook.Install())
        {
            Protocol.Error("HOOK_FAILED",
                "SetWindowsHookEx(WH_MOUSE_LL) failed. Another process may have " +
                "exhausted the hook chain, or the desktop denied access.");
            return 2;
        }

        Protocol.Emit(new
        {
            v = 1,
            type = "ready",
            id = Guid.NewGuid().ToString(),
            pid = Environment.ProcessId,
            dpiAware = dpiOk,
        });

        var stdin = new Thread(ReadCommands) { IsBackground = true, Name = "stdin" };
        stdin.Start();

        // A low-level hook only fires while its installing thread pumps messages.
        // This loop is not optional decoration; without it nothing is ever recorded.
        while (Win32.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            Win32.TranslateMessage(ref msg);
            Win32.DispatchMessage(ref msg);
        }

        _hook.Dispose();
        _keyboard?.Dispose();
        _recorder.Dispose();
        return 0;
    }

    private static void SetKeyboardHook(bool enabled)
    {
        if (enabled && _keyboard is null)
        {
            var hook = new KeyboardHook(_recorder!);
            if (hook.Install())
            {
                _keyboard = hook;
                Protocol.Log("info", "keyboard capture on");
            }
            else
            {
                Protocol.Error("HOOK_FAILED", "SetWindowsHookEx(WH_KEYBOARD_LL) failed.");
            }
        }
        else if (!enabled && _keyboard is not null)
        {
            _keyboard.Dispose();
            _keyboard = null;
            Protocol.Log("info", "keyboard capture off");
        }
    }

    private static void ReadCommands()
    {
        string? line;
        while ((line = Console.In.ReadLine()) is not null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            try
            {
                using var doc = JsonDocument.Parse(line);
                var root = doc.RootElement;
                var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;

                switch (type)
                {
                    case "start":
                        var dir = root.TryGetProperty("sessionDir", out var d) ? d.GetString() : null;
                        if (string.IsNullOrWhiteSpace(dir))
                        {
                            Protocol.Error("BAD_COMMAND", "start requires sessionDir");
                            break;
                        }
                        var ignored = new List<uint>();
                        if (root.TryGetProperty("ignorePids", out var ip)
                            && ip.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var v in ip.EnumerateArray())
                                if (v.TryGetUInt32(out var pid)) ignored.Add(pid);
                        }
                        string? fmt = root.TryGetProperty("imageFormat", out var f) ? f.GetString() : null;
                        int? q = root.TryGetProperty("imageQuality", out var qq)
                                 && qq.TryGetInt32(out var qv) ? qv : null;
                        double? sc = root.TryGetProperty("imageScale", out var scp)
                                     && scp.TryGetDouble(out var scv) ? scv : null;

                        var allowed = new List<uint>();
                        if (root.TryGetProperty("allowPids", out var ap)
                            && ap.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var v in ap.EnumerateArray())
                                if (v.TryGetUInt32(out var pid)) allowed.Add(pid);
                        }

                        _recorder!.StartSession(dir, ignored,
                            CaptureOptions.Clamp(fmt, q, sc), allowed);

                        if (allowed.Count > 0)
                            Protocol.Log("info", $"scoped to pids {string.Join(",", allowed)}");

                        // The keyboard hook is installed only while it is wanted.
                        // A global key hook that exists but is "switched off" is
                        // indefensible to a security team, and to antivirus.
                        var wantKeys = !root.TryGetProperty("recordKeyboard", out var rk)
                                       || rk.ValueKind != JsonValueKind.False;
                        SetKeyboardHook(wantKeys);

                        if (_keyboard is not null && root.TryGetProperty("hotkeys", out var hk)
                            && hk.ValueKind == JsonValueKind.Array)
                        {
                            _keyboard.SuppressedChords = new HashSet<string>(
                                hk.EnumerateArray().Select(x => x.GetString() ?? "")
                                  .Where(x => x.Length > 0),
                                StringComparer.OrdinalIgnoreCase);
                        }
                        Protocol.Log("info", $"recording to {dir}");
                        break;

                    case "armOnce":
                        var replaceId = root.TryGetProperty("replaceId", out var rid)
                                        ? rid.GetString() : null;
                        if (string.IsNullOrWhiteSpace(replaceId))
                        {
                            Protocol.Error("BAD_COMMAND", "armOnce requires replaceId");
                            break;
                        }
                        _recorder!.ArmOnce(replaceId);
                        Protocol.Log("info", $"armed single capture to replace {replaceId}");
                        break;

                    case "pause":
                        _recorder!.State = RecordingState.Paused;
                        break;

                    case "resume":
                        _recorder!.State = RecordingState.Recording;
                        break;

                    case "listWindows":
                        var exclude = new HashSet<uint> { (uint)Environment.ProcessId };
                        if (root.TryGetProperty("excludePids", out var xp)
                            && xp.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var v in xp.EnumerateArray())
                                if (v.TryGetUInt32(out var pid)) exclude.Add(pid);
                        }
                        Protocol.Emit(new
                        {
                            v = 1,
                            type = "windows",
                            id = Guid.NewGuid().ToString(),
                            items = WindowLister.List(exclude),
                        });
                        break;

                    case "ping":
                        Protocol.Emit(new { v = 1, type = "pong", id = Guid.NewGuid().ToString() });
                        break;

                    case "stop":
                        _recorder!.State = RecordingState.Idle;
                        Win32.PostThreadMessage(_mainThreadId, Win32.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
                        return;

                    default:
                        // Forward compatible: an unknown verb from a newer UI is
                        // ignored, not fatal.
                        Protocol.Log("warn", $"ignoring unknown command '{type}'");
                        break;
                }
            }
            catch (JsonException ex)
            {
                Protocol.Error("BAD_JSON", ex.Message);
            }
        }

        // stdin closed: the UI died. Do not linger as an orphan with a global hook.
        Win32.PostThreadMessage(_mainThreadId, Win32.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }
}
