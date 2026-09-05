using System.IO;
using System.Collections.Concurrent;
using System.Drawing;
using System.Text;

namespace BetterSteps.Capture;

internal enum RecordingState { Idle, Recording, Paused, RecordingOnce }

/// <summary>A click as the hook saw it. Deliberately tiny: the hook callback
/// must return in single-digit milliseconds or Windows silently evicts it.</summary>
internal readonly record struct RawEvent(
    string Action, Win32.POINT Point, Win32.POINT EndPoint, DateTime Utc);

internal sealed class Recorder : IDisposable
{
    /// <summary>Typing is flushed into one step after this much quiet.</summary>
    private static readonly TimeSpan TypingIdle = TimeSpan.FromMilliseconds(1500);

    private readonly BlockingCollection<object> _queue = new(new ConcurrentQueue<object>());
    private readonly Thread _worker;
    private readonly int _doubleClickMs = Win32.GetDoubleClickTime();

    private string _sessionDir = "";
    private HashSet<uint> _ignoredPids = new();
    private HashSet<uint> _allowedPids = new();
    private CaptureOptions _options = new();
    private string? _replaceId;
    private int _seq;

    // Worker-thread only; no locking needed.
    private DateTime _lastClickUtc = DateTime.MinValue;
    private Win32.POINT _lastClickPoint;
    private string? _lastStepId;

    // Typing buffer, worker-thread only.
    private readonly TypingState _typing = new();

    internal volatile RecordingState State = RecordingState.Idle;

    internal Recorder()
    {
        _worker = new Thread(Run) { IsBackground = true, Name = "capture-worker" };
        _worker.Start();
    }

    internal void StartSession(string sessionDir, IEnumerable<uint>? ignoredPids = null,
                               CaptureOptions? options = null,
                               IEnumerable<uint>? allowedPids = null)
    {
        // An empty allow-list means "record everything". A populated one scopes
        // the recording to chosen applications, so documenting one system does
        // not incidentally capture mail, chat, or whatever else is on screen.
        _allowedPids = new HashSet<uint>(allowedPids ?? Array.Empty<uint>());
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

    /// <summary>
    /// Arms a single capture that will replace an existing step, then parks.
    /// Used to refresh one step of an ageing guide without re-recording the rest.
    /// </summary>
    internal void ArmOnce(string replaceId)
    {
        _replaceId = replaceId;
        State = RecordingState.RecordingOnce;
    }

    /// <summary>Called on the hook thread. Enqueue and get out.</summary>
    internal void Offer(RawEvent e)
    {
        var state = State;
        if (state != RecordingState.Recording && state != RecordingState.RecordingOnce) return;

        // Flip before enqueueing: several events can arrive in the time the
        // worker takes to run, and single-shot must mean exactly one.
        if (state == RecordingState.RecordingOnce) State = RecordingState.Paused;

        if (!_queue.IsAddingCompleted) _queue.Add(e);
    }

    /// <summary>
    /// Called on the keyboard hook thread. Single-shot re-recording deliberately
    /// ignores keys: it exists to refresh one click, and consuming the arm on a
    /// stray keystroke would make it unusable.
    /// </summary>
    internal void OfferKey(RawKey k)
    {
        if (State != RecordingState.Recording) return;
        if (!_queue.IsAddingCompleted) _queue.Add(k);
    }

    private void Run()
    {
        while (true)
        {
            object? item;
            try
            {
                // Bounded wait rather than a blocking read: an unfinished typing
                // buffer has to flush on silence, not only on the next event.
                if (!_queue.TryTake(out item, 250))
                {
                    FlushTypingIfIdle();
                    if (_queue.IsAddingCompleted && _queue.Count == 0) break;
                    continue;
                }
            }
            catch (ObjectDisposedException) { break; }
            catch (InvalidOperationException) { break; }

            try
            {
                switch (item)
                {
                    case RawEvent mouse:
                        // Ordering matters: whatever was typed happened before
                        // the click that ended it.
                        FlushTyping();
                        Process(mouse);
                        break;

                    case RawKey key:
                        ProcessKey(key);
                        break;
                }
            }
            catch (Exception ex) { Protocol.Error("STEP_FAILED", ex.Message); }
        }

        FlushTyping();
    }

    // ---- keyboard -----------------------------------------------------------

    private void ProcessKey(RawKey k)
    {
        // Focus moved: the previous field's contents are complete, and secrecy
        // must be decided afresh for the new one.
        if (k.Focus != _typing.Focus)
        {
            FlushTyping();
            // Resolve once per field, not per keystroke: UI Automation is a
            // cross-process COM call and would be ruinous on every character.
            _typing.BeginFocus(k.Focus, UiaResolver.IsPasswordField(k.Focus));
        }

        switch (k.Kind)
        {
            case KeyKind.Secret:
                _typing.MarkSecret(k.Utc);
                break;

            case KeyKind.Text:
                // A password field's characters are noted, never kept.
                _typing.Append(k.Char, k.Utc);
                break;

            case KeyKind.Named when k.Label == "Backspace":
                _typing.Backspace(k.Utc);
                break;

            case KeyKind.Named:
                FlushTyping();
                EmitKeyStep("keyPress", $"Pressed {k.Label}", k.Focus, k.Utc);
                break;

            case KeyKind.Chord:
                FlushTyping();
                EmitKeyStep("keyPress", $"Pressed {k.Label}", k.Focus, k.Utc);
                break;
        }
    }

    private void FlushTypingIfIdle()
    {
        if (_typing.IsIdle(DateTime.UtcNow, TypingIdle)) FlushTyping();
    }

    private void FlushTyping()
    {
        var (wasSecret, text) = _typing.Take();

        if (!wasSecret && string.IsNullOrEmpty(text)) return;

        if (wasSecret)
        {
            // Deliberately says nothing about length or content.
            EmitKeyStep("password", "Entered password", _typing.Focus, DateTime.UtcNow);
            return;
        }

        var safe = Redactor.Apply(text);
        EmitKeyStep("keyText", $"Typed \"{safe}\"", _typing.Focus, DateTime.UtcNow, safe);
    }

    private void EmitKeyStep(string action, string description, IntPtr focus,
                             DateTime utc, string? typed = null)
    {
        // Anchor the step on the focused control if we can, so the indicator
        // lands on the field rather than wherever the mouse happens to rest.
        var point = ControlCentre(focus) ?? CursorPoint();

        var hwnd = focus != IntPtr.Zero
            ? Win32.GetAncestor(focus, Win32.GA_ROOT)
            : WindowResolver.RootWindowAt(point);

        if (!InScope(WindowResolver.ProcessIdOf(hwnd))) return;

        var bounds = ScreenCapture.ResolveBounds(hwnd, point, _options.Frame);
        var seq = ++_seq;
        var relative = $"steps/{seq:D4}.{_options.Extension}";
        ScreenCapture.CaptureTo(bounds, Path.Combine(_sessionDir, relative), _options, hwnd);

        var window = WindowResolver.Describe(hwnd, bounds);
        var target = UiaResolver.Resolve(point.X, point.Y);

        var step = new StepMessage
        {
            Seq = seq,
            Ts = utc.ToString("o"),
            Action = action,
            Point = new Point2(point.X, point.Y),
            Monitor = WindowResolver.DescribeMonitor(point),
            Window = window,
            Frame = new RectInfo(bounds.X, bounds.Y, bounds.Width, bounds.Height),
            Target = target,
            Screenshot = relative,
            Typed = typed,
            Text = StepDescriber.DescribeKey(description, target, window),
        };

        Protocol.Emit(step);

        // Typing breaks any pending double-click pairing.
        _lastClickUtc = DateTime.MinValue;
        _lastStepId = null;
    }

    /// <summary>Whether an event belonging to this process should be recorded.</summary>
    private bool InScope(uint pid) => Scope.Allows(pid, _ignoredPids, _allowedPids);

    private static Win32.POINT CursorPoint() =>
        Win32.GetCursorPos(out var p) ? p : new Win32.POINT { X = 0, Y = 0 };

    private static Win32.POINT? ControlCentre(IntPtr focus)
    {
        if (focus == IntPtr.Zero) return null;
        if (!Win32.GetWindowRect(focus, out var r)) return null;

        var w = r.Right - r.Left;
        var h = r.Bottom - r.Top;
        if (w <= 0 || h <= 0) return null;

        return new Win32.POINT { X = r.Left + w / 2, Y = r.Top + h / 2 };
    }

    // ---- mouse --------------------------------------------------------------

    private void Process(RawEvent e)
    {
        var action = e.Action;
        string? supersedes = null;

        // Consume the pending replacement target, if any.
        var replaces = _replaceId;
        _replaceId = null;

        // Double-click arrives as two clicks. Rather than delaying every single
        // click by the double-click interval to find out, we emit immediately and
        // tell the UI to fold the pair together if a second one shows up.
        if (replaces is null
            && action == "leftClick"
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
        if (!InScope(WindowResolver.ProcessIdOf(hwnd))) return;

        var bounds = ScreenCapture.ResolveBounds(hwnd, e.Point, _options.Frame);

        // A replacement keeps its own numbering namespace so it cannot collide
        // with an existing screenshot file.
        var seq = replaces is null ? ++_seq : _seq;
        var relative = replaces is null
            ? $"steps/{seq:D4}.{_options.Extension}"
            : $"steps/redo-{DateTime.UtcNow:yyyyMMddHHmmssfff}.{_options.Extension}";   // forward slashes: the UI treats this as a URL
        ScreenCapture.CaptureTo(bounds, Path.Combine(_sessionDir, relative), _options, hwnd);

        var window = WindowResolver.Describe(hwnd, bounds);
        var monitor = WindowResolver.DescribeMonitor(e.Point);
        var target = UiaResolver.Resolve(e.Point.X, e.Point.Y);

        var step = new StepMessage
        {
            Seq = seq,
            Ts = e.Utc.ToString("o"),
            Action = action,
            Supersedes = supersedes,
            Replaces = replaces,
            Point = new Point2(e.Point.X, e.Point.Y),
            EndPoint = action == "drag" ? new Point2(e.EndPoint.X, e.EndPoint.Y) : null,
            Monitor = monitor,
            Window = window,
            Frame = new RectInfo(bounds.X, bounds.Y, bounds.Width, bounds.Height),
            Target = target,
            Screenshot = relative,
            Text = StepDescriber.Describe(action, target, window),
        };

        Protocol.Emit(step);

        if (replaces is not null)
        {
            // Do not let a re-recording seed double-click folding for whatever
            // the user does next.
            _lastClickUtc = DateTime.MinValue;
            _lastStepId = null;
        }
        else if (action == "leftClick")
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
