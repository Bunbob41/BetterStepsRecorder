using System.IO;
using System.Text;
using System.Text.Json;

namespace BetterSteps.Capture;

internal static class Program
{
    private static Recorder? _recorder;
    private static MouseHook? _hook;
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
        _recorder.Dispose();
        return 0;
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
                        _recorder!.StartSession(dir);
                        Protocol.Log("info", $"recording to {dir}");
                        break;

                    case "pause":
                        _recorder!.State = RecordingState.Paused;
                        break;

                    case "resume":
                        _recorder!.State = RecordingState.Recording;
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
