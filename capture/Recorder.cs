using System.IO;
using System.Collections.Concurrent;
using System.Drawing;

namespace BetterSteps.Capture;

internal enum RecordingState { Idle, Recording, Paused }

/// <summary>A click as the hook saw it. Deliberately tiny: the hook callback
/// must return in single-digit milliseconds or Windows silently evicts it.</summary>
internal readonly record struct RawEvent(
    string Action, Win32.POINT Point, Win32.POINT EndPoint, DateTime Utc);

internal sealed class Recorder : IDisposable
{
    private readonly BlockingCollection<RawEvent> _queue = new(new ConcurrentQueue<RawEvent>());
    private readonly Thread _worker;
    private readonly int _doubleClickMs = Win32.GetDoubleClickTime();

    private string _sessionDir = "";
    private HashSet<uint> _ignoredPids = new();
    private CaptureOptions _options = new();
    private int _seq;

    // Worker-thread only; no locking needed.
    private DateTime _lastClickUtc = DateTime.MinValue;
    private Win32.POINT _lastClickPoint;
    private string? _lastStepId;

    internal volatile RecordingState State = RecordingState.Idle;

    internal Recorder()
    {
        _worker = new Thread(Run) { IsBackground = true, Name = "capture-worker" };
        _worker.Start();
    }

    internal void StartSession(string sessionDir, IEnumerable<uint>? ignoredPids = null,
                               CaptureOptions? options = null)
    {
        _sessionDir = sessionDir;
        _options = options ?? new CaptureOptions();
        // The UI's own windows. Without this, the click that ends a recording
        // is itself recorded, and every session finishes with a junk step
        // showing the recorder instead of the user's application.
        _ignoredPids = new HashSet<uint>(ignoredPids ?? Array.Empty<uint>())
        {
            (uint)Environment.ProcessId,
        };
        Directory.CreateDirectory(Path.Combine(_sessionDir, "steps"));
        State = RecordingState.Recording;
    }

    /// <summary>Called on the hook thread. Enqueue and get out.</summary>
    internal void Offer(RawEvent e)
    {
        if (State != RecordingState.Recording) return;
        if (!_queue.IsAddingCompleted) _queue.Add(e);
    }

    private void Run()
    {
        foreach (var e in _queue.GetConsumingEnumerable())
        {
            try { Process(e); }
            catch (Exception ex) { Protocol.Error("STEP_FAILED", ex.Message); }
        }
    }

    private void Process(RawEvent e)
    {
        var action = e.Action;
        string? supersedes = null;

        // Double-click arrives as two clicks. Rather than delaying every single
        // click by the double-click interval to find out, we emit immediately and
        // tell the UI to fold the pair together if a second one shows up.
        if (action == "leftClick"
            && (e.Utc - _lastClickUtc).TotalMilliseconds <= _doubleClickMs
            && Math.Abs(e.Point.X - _lastClickPoint.X) <= 4
            && Math.Abs(e.Point.Y - _lastClickPoint.Y) <= 4
            && _lastStepId is not null)
        {
            action = "doubleClick";
            supersedes = _lastStepId;
        }

        var hwnd = WindowResolver.RootWindowAt(e.Point);

        // Checked before any screenshot or UIA work: cheapest possible bail-out.
        if (_ignoredPids.Contains(WindowResolver.ProcessIdOf(hwnd))) return;

        var bounds = ScreenCapture.ResolveBounds(hwnd, e.Point);

        var seq = ++_seq;
        var relative = $"steps/{seq:D4}.{_options.Extension}";   // forward slashes: the UI treats this as a URL
        ScreenCapture.CaptureTo(bounds, Path.Combine(_sessionDir, relative), _options);

        var window = WindowResolver.Describe(hwnd, bounds);
        var monitor = WindowResolver.DescribeMonitor(e.Point);
        var target = UiaResolver.Resolve(e.Point.X, e.Point.Y);

        var step = new StepMessage
        {
            Seq = seq,
            Ts = e.Utc.ToString("o"),
            Action = action,
            Supersedes = supersedes,
            Point = new Point2(e.Point.X, e.Point.Y),
            EndPoint = action == "drag" ? new Point2(e.EndPoint.X, e.EndPoint.Y) : null,
            Monitor = monitor,
            Window = window,
            Target = target,
            Screenshot = relative,
            Text = StepDescriber.Describe(action, target, window),
        };

        Protocol.Emit(step);

        if (action == "leftClick")
        {
            _lastClickUtc = e.Utc;
            _lastClickPoint = e.Point;
            _lastStepId = step.Id;
        }
        else
        {
            _lastClickUtc = DateTime.MinValue;
            _lastStepId = null;
        }
    }

    public void Dispose()
    {
        _queue.CompleteAdding();
        _worker.Join(TimeSpan.FromSeconds(5));   // let in-flight screenshots land
        _queue.Dispose();
    }
}
