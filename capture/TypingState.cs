using System.Text;
using System.Linq;

namespace BetterSteps.Capture;

/// <summary>
/// The typing buffer and, more importantly, the rule about what is safe to keep.
/// </summary>
/// <remarks>
/// Whether a field masks input is a property of the FIELD, not of the buffer.
/// Conflating the two is a real leak: flushing on idle used to clear the secret
/// flag, so continuing to type in the same password box afterwards was recorded
/// in plain text. Only a change of focus may re-decide secrecy, and only a
/// fresh UI Automation answer may clear it.
///
/// Pure, so that path can be tested without a keyboard.
/// </remarks>
internal sealed class TypingState
{
    private readonly StringBuilder _buffer = new();

    /// <summary>The control the buffer belongs to.</summary>
    internal IntPtr Focus { get; private set; }

    /// <summary>Whether that control masks its input. Survives a flush.</summary>
    internal bool FocusIsSecret { get; private set; }

    /// <summary>
    /// Whether that control is somewhere text is entered. When it is not, the
    /// keys are commands to the application rather than a value, and the
    /// sequence is counted instead of transcribed.
    /// </summary>
    internal bool FocusAcceptsText { get; private set; } = true;

    /// <summary>
    /// Whether the control belongs to an application this recording covers.
    /// </summary>
    /// <remarks>
    /// A property of the field, like secrecy, and for the same reason: it is
    /// decided once when focus moves and must not be re-decided per keystroke.
    ///
    /// Scope used to be applied when a step was emitted, which meant every
    /// character typed into every other application on the desktop was
    /// accumulated here first and thrown away afterwards. Nothing reached
    /// disk - but "documenting one system does not capture your mail and chat"
    /// is the promise, and holding somebody's password in a buffer for the
    /// length of a flush is not keeping it. Out of scope, nothing is kept.
    /// </remarks>
    internal bool FocusInScope { get; private set; } = true;

    /// <summary>Which keys were used, and how many times, when not transcribing.</summary>
    private readonly SortedSet<char> _keys = new();
    private int _presses;

    /// <summary>Whether anything has been typed since the last flush.</summary>
    private bool _secretActivity;

    internal DateTime LastUtc { get; private set; }

    internal bool HasPending => _buffer.Length > 0 || _secretActivity || _presses > 0;

    /// <summary>Moves to a new control, deciding secrecy and kind afresh.</summary>
    internal void BeginFocus(IntPtr focus, bool isSecret, bool acceptsText = true,
                             bool inScope = true)
    {
        Focus = focus;
        FocusIsSecret = isSecret;
        FocusAcceptsText = acceptsText;
        FocusInScope = inScope;
        _secretActivity = false;
        _buffer.Clear();
        _keys.Clear();
        _presses = 0;
    }

    /// <summary>Marks the current field secret, e.g. a Win32 ES_PASSWORD control.</summary>
    internal void MarkSecret(DateTime utc)
    {
        if (!FocusInScope) return;
        FocusIsSecret = true;
        _secretActivity = true;
        // Anything buffered before we learned this must not survive.
        _buffer.Clear();
        LastUtc = utc;
    }

    internal void Append(char c, DateTime utc)
    {
        // Before everything: an application this recording does not cover has
        // nothing kept about it, not even that a key was pressed.
        if (!FocusInScope) return;

        if (FocusIsSecret)
        {
            _secretActivity = true;
        }
        else if (!FocusAcceptsText)
        {
            // Not a value being entered: a command being given. Keep which keys
            // and how many, not the order - "wddad" tells a reader nothing.
            _keys.Add(char.ToUpperInvariant(c));
            _presses++;
        }
        else
        {
            _buffer.Append(c);
        }
        LastUtc = utc;
    }

    internal void Backspace(DateTime utc)
    {
        if (!FocusInScope) return;
        if (FocusIsSecret) _secretActivity = true;
        else if (!FocusAcceptsText) { _keys.Add('\u232B'); _presses++; }
        else if (_buffer.Length > 0) _buffer.Length--;
        LastUtc = utc;
    }

    internal bool IsIdle(DateTime now, TimeSpan idle) => HasPending && now - LastUtc >= idle;

    /// <summary>
    /// Empties the buffer and reports what it held. Secrecy of the field itself
    /// is deliberately NOT cleared: the user may keep typing into it.
    /// </summary>
    internal (bool WasSecret, string Text, string Keys, int Presses) Take()
    {
        var wasSecret = _secretActivity && FocusIsSecret;
        var text = _buffer.ToString();
        var keys = string.Join(", ", _keys);
        var presses = _presses;

        _buffer.Clear();
        _secretActivity = false;
        _keys.Clear();
        _presses = 0;

        return (wasSecret, text, keys, presses);
    }
}
