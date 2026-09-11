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

/// <summary>
/// A button going down, which is where a step now begins.
///
/// Smaller still than a RawEvent, and for the same reason: the hook does
/// nothing but hand this over. See <see cref="PressPairing"/> for why the
/// press is the moment that matters.
/// </summary>
internal readonly record struct RawPress(
    Win32.POINT Point, DateTime Utc, PressShot? Shot, IntPtr Foreground);

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

    /// <summary>
    /// The screenshot written most recently, and where it went.
    ///
    /// A typed step's screenshot is taken when the text flushes, and what
    /// flushes it is usually the click that follows - so the two steps are
    /// captured at the same instant and produce byte-identical files. Left
    /// alone that is the same picture printed twice in a guide, and twice the
    /// disk for every "type something, then click" pair, which is most of what
    /// a procedure is made of.
    /// </summary>
    private byte[]? _lastShot;
    private string? _lastShotRelative;

    /// <summary>
    /// The screen as it was when the button went down, waiting for the button
    /// to come up.
    ///
    /// Worker-thread only. At most one: a second press means the first never
    /// became a step, and its picture is deleted rather than left behind.
    /// </summary>
    private Pending? _pending;

    /// <summary>Everything a step needs, taken before the click landed.</summary>
    private sealed class Pending
    {
        internal Win32.POINT Point;
        internal DateTime Utc;
        internal IntPtr Hwnd;
        internal Rectangle Bounds;
        /// <summary>The temporary file the picture went into, or "" if it could
        /// not be taken - in which case the release captures as it used to,
        /// which still gets the window and the name from the right moment.</summary>
        internal string Picture = "";
        internal WindowInfo? Window;
        internal TargetInfo? Target;

        internal void Discard()
        {
            if (Picture.Length == 0) return;
            try { System.IO.File.Delete(Picture); } catch { /* a temp file */ }
            Picture = "";
        }
    }

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
        // Before recording starts, not on the first click: a slow machine gets a
        // fresh chance, and the first press does not pay for starting the copy up.
        PressShots.Enable();
        PressShots.Warm(CursorPoint());
        State = RecordingState.Recording;
    }

    /// <summary>
    /// Arms a single capture that will replace an existing step, then parks.
    /// Used to refresh one step of an ageing guide without re-recording the rest.
    /// </summary>
    internal void ArmOnce(string replaceId)
    {
        _replaceId = replaceId;
        PressShots.Enable();
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
    /// Called on the hook thread when a button goes down.
    ///
    /// Deliberately does NOT consume a single-shot re-recording: pressing is
    /// not clicking, and a press that never becomes a release must leave the
    /// arm where it was.
    /// </summary>
    internal bool OfferPress(RawPress p)
    {
        var state = State;
        if (state != RecordingState.Recording && state != RecordingState.RecordingOnce) return false;
        if (_queue.IsAddingCompleted) return false;
        try { _queue.Add(p); return true; }
        catch (InvalidOperationException) { return false; }   // closed between the check and the add
    }

    /// <summary>
    /// Whether a press is worth copying the screen for. Asked by the hook before
    /// it spends twenty milliseconds on a click nobody is recording.
    /// </summary>
    internal bool WantsPress
    {
        get
        {
            var state = State;
            return state == RecordingState.Recording || state == RecordingState.RecordingOnce;
        }
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
                    AbandonStalePress();
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

                    case RawPress press:
                        Prepare(press);
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

            // Scope first, and once per field. An application this recording
            // does not cover gets nothing asked of it and nothing kept from
            // it - not its characters, and not a UI Automation call reaching
            // across into it to find out what kind of field is focused.
            var root = k.Focus != IntPtr.Zero
                ? Win32.GetAncestor(k.Focus, Win32.GA_ROOT)
                : IntPtr.Zero;
            var inScope = InScope(WindowResolver.ProcessIdOf(root));

            // Resolve once per field, not per keystroke: UI Automation is a
            // cross-process COM call and would be ruinous on every character.
            _typing.BeginFocus(k.Focus,
                               inScope && UiaResolver.IsPasswordField(k.Focus),
                               !inScope || UiaResolver.FocusAcceptsText(k.Focus),
                               inScope);
        }

        // A named key or a chord in another application is not this recording's
        // business either. EmitKeyStep would refuse it, but refusing it here is
        // the difference between discarding an event and never taking it.
        if (!_typing.FocusInScope) return;

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
        var (wasSecret, text, keys, presses) = _typing.Take();

        if (!wasSecret && string.IsNullOrEmpty(text) && presses == 0) return;

        if (wasSecret)
        {
            // Deliberately says nothing about length or content.
            EmitKeyStep("password", "Entered password", _typing.Focus, DateTime.UtcNow);
            return;
        }

        if (presses > 0)
        {
            // Keys sent to the application rather than into a field. Which keys
            // and how many is the useful part; the order is not - a reader
            // gains nothing from "wddad" and a great deal from knowing that
            // W, A, S and D drove the thing.
            var times = presses == 1 ? "once" : $"{presses} times";
            EmitKeyStep("keyPress", $"Pressed {keys} ({times})",
                        _typing.Focus, DateTime.UtcNow);
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

        // Asked before the screenshot, collected after it. Typing rarely moves
        // anything under the pointer, but the two paths should agree about when
        // the question is asked.
        var pending = UiaResolver.Begin(point.X, point.Y);

        var bounds = ScreenCapture.ResolveBounds(hwnd, point, _options.Frame);
        var seq = ++_seq;
        var relative = CaptureOrReuse(
            bounds, $"steps/{seq:D4}.{_options.Extension}", hwnd, mayReuse: true);

        var window = WindowResolver.Describe(hwnd, bounds);
        var target = UiaResolver.End(pending);

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

    /// <summary>
    /// The button has gone down. Take everything a step is made of now, while
    /// the screen still shows what is being clicked.
    ///
    /// The order is the same as it always was - ask UI Automation, capture,
    /// then read the answer - so the hit test runs alongside the screenshot
    /// rather than after it. What has changed is when: this happens with the
    /// button still held, rather than after the application has acted on the
    /// click, opened a menu over the control, or destroyed the dialog the step
    /// was about.
    /// </summary>
    private void Prepare(RawPress p)
    {
        // The borrowed pixels go back for the next click whatever happens here.
        try { PrepareFrom(p); }
        finally { p.Shot?.Release(); }

        if (PressShots.TakeSlowReport() is double slow)
        {
            // A warning. Sent as an error, this ended a recording of a
            // full-screen game in the interface while the engine went on
            // recording underneath it.
            Protocol.Warn("PRESS_COPY_SLOW",
                $"Copying the screen at a click took {slow:0}ms, so for the rest of this "
                + "recording the picture is taken just after each click instead.");
        }
    }

    private void PrepareFrom(RawPress p)
    {
        // One press at a time. A second means the first never became a step.
        _pending?.Discard();
        _pending = null;

        // Whatever was being typed ended when this button went down, not when
        // it came up - so the typed step's own picture is taken here too,
        // before the click has changed anything.
        FlushTyping();

        // The window under the pointer may be a menu or a dropdown list - a window
        // of its own, and a sliver of one. Framed by itself it came out 224 pixels
        // by 51 with nothing around it; framed as the window it belongs to, it
        // appears in place, open, over it.
        var under = WindowResolver.RootWindowAt(p.Point);
        var hwnd = WindowResolver.FrameWindowFor(under, p.Foreground);
        if (!InScope(WindowResolver.ProcessIdOf(hwnd))) return;

        var asking = UiaResolver.Begin(p.Point.X, p.Point.Y);
        var bounds = ScreenCapture.ResolveBounds(hwnd, p.Point, _options.Frame);
        if (under != hwnd) bounds = ScreenCapture.Including(bounds, under);

        // Into a temporary name: at this point nobody knows whether this press
        // will become a step at all, let alone which number it is. The dot
        // keeps it out of the way of anything that lists the folder.
        var picture = Path.Combine(
            _sessionDir, "steps", $".press-{DateTime.UtcNow.Ticks:x}.{_options.Extension}");
        try
        {
            // The pixels copied inside the hook, before the click was delivered,
            // whenever they can show this frame truthfully. Only when the window
            // was the active one: a click that activates a window behind another
            // would otherwise be pictured with the other window across it, and
            // asking that window to draw itself is the better picture there.
            var area = p.Shot is not null && ShowsItself(hwnd, p.Foreground)
                ? ScreenCapture.PressCrop(p.Shot.Area, bounds)
                : null;
            if (area is Rectangle fromPress)
            {
                bounds = fromPress;
                ScreenCapture.SaveCrop(p.Shot!.Pixels, p.Shot.Area, fromPress, picture, _options);
            }
            else
            {
                ScreenCapture.CaptureTo(bounds, picture, _options, hwnd);
            }
        }
        catch (Exception ex)
        {
            // A step with a late picture beats no step: the release will
            // capture the way it always did, and the window and the name are
            // still the ones from this moment.
            Protocol.Error("PRESS_CAPTURE_FAILED", ex.Message);
            picture = "";
        }

        _pending = new Pending
        {
            Point = p.Point,
            Utc = p.Utc,
            Hwnd = hwnd,
            Bounds = bounds,
            Picture = picture,
            Window = WindowResolver.Describe(hwnd, bounds),
            Target = UiaResolver.End(asking),
        };
    }

    /// <summary>
    /// Whether a copy of the screen at the press shows this window, rather than
    /// whatever was in front of it. True when it was the active window - which a
    /// menu or a dropdown does not change, since neither takes activation.
    /// </summary>
    private static bool ShowsItself(IntPtr frame, IntPtr foreground)
    {
        if (frame == IntPtr.Zero || foreground == IntPtr.Zero) return false;
        var active = Win32.GetAncestor(foreground, Win32.GA_ROOT);
        return (active != IntPtr.Zero ? active : foreground) == frame;
    }

    /// <summary>The press that belongs to this release, if there is one.</summary>
    private Pending? TakePending(Win32.POINT at)
    {
        var pre = _pending;
        if (pre is null) return null;
        _pending = null;

        if (PressPairing.SameClick(pre.Point, pre.Utc, at, DateTime.UtcNow)) return pre;
        pre.Discard();
        return null;
    }

    /// <summary>
    /// A press whose release never arrived - the recording was stopped between
    /// the two, or a window took the mouse. Left alone it would be adopted by
    /// whatever click came next, hours later, and put that step's picture back
    /// in time.
    /// </summary>
    private void AbandonStalePress()
    {
        var pre = _pending;
        if (pre is null) return;
        if (!PressPairing.Abandoned(pre.Utc, DateTime.UtcNow)) return;
        _pending = null;
        pre.Discard();
    }

    /// <summary>
    /// Captures to <paramref name="relative"/>, or points at the previous
    /// screenshot when the pixels have not changed at all.
    /// </summary>
    ///
    /// <remarks>
    /// Two steps then share one file, which the UI is built for: it refuses to
    /// delete a screenshot another step still refers to, and gives a step a
    /// copy of its own before editing one. Comparing bytes rather than hashing
    /// because the answer is nearly always "different" and a length check
    /// settles that immediately.
    ///
    /// Never applied to a re-record, which is a deliberate replacement and must
    /// own its file.
    /// </remarks>
    private string CaptureOrReuse(Rectangle bounds, string relative, IntPtr hwnd,
                                  bool mayReuse)
    {
        var full = Path.Combine(_sessionDir, relative);
        ScreenCapture.CaptureTo(bounds, full, _options, hwnd);
        return Settle(full, relative, mayReuse);
    }

    /// <summary>
    /// Takes the picture already captured at the press and gives it the name
    /// the step will refer to. The same reuse rule then applies to it as to one
    /// captured here, because two steps sharing a file is about the pixels, not
    /// about when they were taken.
    /// </summary>
    private string AdoptOrReuse(Pending pre, string relative, bool mayReuse)
    {
        var full = Path.Combine(_sessionDir, relative);
        try
        {
            if (pre.Picture.Length == 0 || !File.Exists(pre.Picture)) throw new FileNotFoundException();
            File.Move(pre.Picture, full, overwrite: true);
            pre.Picture = "";
        }
        catch
        {
            // Whatever went wrong with a file, a step is worth more than the
            // improvement: capture now, the way this always did.
            return CaptureOrReuse(pre.Bounds, relative, pre.Hwnd, mayReuse);
        }
        return Settle(full, relative, mayReuse);
    }

    /// <summary>
    /// Decides whether a freshly written picture is worth keeping as its own
    /// file, shared by both callers above.
    /// </summary>
    private string Settle(string full, string relative, bool mayReuse)
    {
        if (!mayReuse) { _lastShot = null; _lastShotRelative = null; return relative; }

        try
        {
            var bytes = File.ReadAllBytes(full);
            if (_lastShotRelative is not null && _lastShot is not null
                && _lastShot.Length == bytes.Length
                && _lastShot.AsSpan().SequenceEqual(bytes))
            {
                File.Delete(full);
                return _lastShotRelative;
            }
            _lastShot = bytes;
            _lastShotRelative = relative;
        }
        catch
        {
            // Reading a screenshot back is an optimisation and must never cost
            // a step. Forget the comparison and keep the file that was written.
            _lastShot = null;
            _lastShotRelative = null;
        }
        return relative;
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

        // The screen as it was when the button went down. Everything a step is
        // made of comes from there when it is available - the window, the
        // picture and the name - because by the time the button comes up the
        // application has acted: the menu is open over the control, the dialog
        // is drawn, or the window that was clicked no longer exists.
        var pre = TakePending(e.Point);

        var hwnd = pre?.Hwnd ?? WindowResolver.RootWindowAt(e.Point);

        // Checked before any screenshot or UIA work: cheapest possible bail-out.
        if (!InScope(WindowResolver.ProcessIdOf(hwnd))) { pre?.Discard(); return; }

        // Only when the press was missed - a recording started with the button
        // already down, a release with no press of its own. Started before the
        // screenshot so the hit test runs alongside it.
        var asking = pre is null ? UiaResolver.Begin(e.Point.X, e.Point.Y) : null;

        var bounds = pre?.Bounds ?? ScreenCapture.ResolveBounds(hwnd, e.Point, _options.Frame);

        // A replacement keeps its own numbering namespace so it cannot collide
        // with an existing screenshot file.
        var seq = replaces is null ? ++_seq : _seq;
        var name = replaces is null
            ? $"steps/{seq:D4}.{_options.Extension}"
            : $"steps/redo-{DateTime.UtcNow:yyyyMMddHHmmssfff}.{_options.Extension}";   // forward slashes: the UI treats this as a URL
        var relative = pre is not null
            ? AdoptOrReuse(pre, name, mayReuse: replaces is null)
            : CaptureOrReuse(bounds, name, hwnd, mayReuse: replaces is null);

        var window = pre?.Window ?? WindowResolver.Describe(hwnd, bounds);
        var monitor = WindowResolver.DescribeMonitor(e.Point);
        var target = pre is not null ? pre.Target : UiaResolver.End(asking);

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
        _pending?.Discard();
        _pending = null;
        _queue.CompleteAdding();
        _worker.Join(TimeSpan.FromSeconds(5));   // let in-flight screenshots land
        _queue.Dispose();
    }
}
