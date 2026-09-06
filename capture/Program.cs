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

    // A low-level hook's callbacks are dispatched to the message queue of the
    // thread that INSTALLED it. The stdin reader never pumps messages, so a
    // keyboard hook installed from there is silently inert - which is exactly
    // what happened. Installation is therefore posted to the pumping thread.
    private const uint WM_APP_KEYS_ON  = 0x8000 + 1;
    private const uint WM_APP_KEYS_OFF = 0x8000 + 2;

    private static HashSet<string> _pendingChords = new(StringComparer.OrdinalIgnoreCase);

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
            // So a stale engine cannot hide behind a freshly built interface:
            // the two are compiled separately and drift apart in development.
            built = BuildTime(),
        });

        var stdin = new Thread(ReadCommands) { IsBackground = true, Name = "stdin" };
        stdin.Start();

        // A low-level hook only fires while its installing thread pumps messages.
        // This loop is not optional decoration; without it nothing is ever recorded.
        while (Win32.GetMessage(out var msg, IntPtr.Zero, 0, 0) > 0)
        {
            // Thread messages carry no window, so they are handled here rather
            // than dispatched.
            if (msg.hwnd == IntPtr.Zero)
            {
                if (msg.message == WM_APP_KEYS_ON) { SetKeyboardHook(true); continue; }
                if (msg.message == WM_APP_KEYS_OFF) { SetKeyboardHook(false); continue; }
            }

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
                hook.SuppressedChords = _pendingChords;
                _keyboard = hook;
                Protocol.Log("info", "keyboard capture on");
            }
            else
            {
                Protocol.Error("HOOK_FAILED", "SetWindowsHookEx(WH_KEYBOARD_LL) failed.");
            }
        }
        else if (enabled && _keyboard is not null)
        {
            // Already installed; just refresh what it must ignore.
            _keyboard.SuppressedChords = _pendingChords;
        }
        else if (!enabled && _keyboard is not null)
        {
            _keyboard.Dispose();
            _keyboard = null;
            Protocol.Log("info", "keyboard capture off");
        }
    }

    /// <summary>When this engine was built, taken from its own file on disk.</summary>
    private static string BuildTime()
    {
        try
        {
            var exe = Environment.ProcessPath;
            return exe is null
                ? "unknown"
                : File.GetLastWriteTimeUtc(exe).ToString("o");
        }
        catch
        {
            return "unknown";
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
                            CaptureOptions.Clamp(fmt, q, sc,
                                root.TryGetProperty("imageFrame", out var fr) ? fr.GetString() : null),
                            allowed);

                        if (allowed.Count > 0)
                            Protocol.Log("info", $"scoped to pids {string.Join(",", allowed)}");

                        // The keyboard hook is installed only while it is wanted.
                        // A global key hook that exists but is "switched off" is
                        // indefensible to a security team, and to antivirus.
                        var wantKeys = !root.TryGetProperty("recordKeyboard", out var rk)
                                       || rk.ValueKind != JsonValueKind.False;

                        _pendingChords = root.TryGetProperty("hotkeys", out var hk)
                                         && hk.ValueKind == JsonValueKind.Array
                            ? new HashSet<string>(
                                hk.EnumerateArray().Select(x => x.GetString() ?? "")
                                  .Where(x => x.Length > 0),
                                StringComparer.OrdinalIgnoreCase)
                            : new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                        // Must run on the thread that pumps messages, or the
                        // hook is installed and never fires.
                        Win32.PostThreadMessage(_mainThreadId,
                            wantKeys ? WM_APP_KEYS_ON : WM_APP_KEYS_OFF, IntPtr.Zero, IntPtr.Zero);
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

                    case "verify":
                        // Runs off the reader thread: a tree walk across a
                        // large application takes seconds, and blocking here
                        // would stall every other command including stop.
                        var payload = root.TryGetProperty("items", out var vi)
                                      && vi.ValueKind == JsonValueKind.Array
                            ? vi.EnumerateArray().Select(x => new Verifier.Item(
                                x.TryGetProperty("id", out var xi) ? xi.GetString() ?? "" : "",
                                x.TryGetProperty("process", out var xp) ? xp.GetString() : null,
                                x.TryGetProperty("windowTitle", out var xw) ? xw.GetString() : null,
                                x.TryGetProperty("automationId", out var xa) ? xa.GetString() : null,
                                x.TryGetProperty("name", out var xn) ? xn.GetString() : null,
                                x.TryGetProperty("controlType", out var xc) ? xc.GetString() : null))
                              .ToList()
                            : new List<Verifier.Item>();

                        var verifyId = root.TryGetProperty("id", out var vid)
                                       ? vid.GetString() : null;

                        new Thread(() =>
                        {
                            try
                            {
                                var results = Verifier.Verify(payload);
                                Protocol.Emit(new
                                {
                                    v = 1,
                                    type = "verified",
                                    id = verifyId ?? Guid.NewGuid().ToString(),
                                    items = results,
                                });
                            }
                            catch (Exception ex)
                            {
                                Protocol.Error("VERIFY_FAILED", ex.Message);
                            }
                        })
                        { IsBackground = true, Name = "verify" }.Start();
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
            catch (Exception ex)
            {
                // A command that fails must not take the engine down with it.
                // Only malformed JSON was caught here, so a session directory
                // that could not be created - a full disk, a path that went
                // away - killed the process mid-recording, taking the hooks and
                // any unflushed typing with it. Report it and keep listening.
                Protocol.Error("COMMAND_FAILED", ex.Message);
            }
        }

        // stdin closed: the UI died. Do not linger as an orphan with a global hook.
        Win32.PostThreadMessage(_mainThreadId, Win32.WM_QUIT, IntPtr.Zero, IntPtr.Zero);
    }
}
