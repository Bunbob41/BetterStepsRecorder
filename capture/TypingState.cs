using System.Text;

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

    /// <summary>Whether anything has been typed since the last flush.</summary>
    private bool _secretActivity;

    internal DateTime LastUtc { get; private set; }

    internal bool HasPending => _buffer.Length > 0 || _secretActivity;

    /// <summary>Moves to a new control, deciding secrecy afresh.</summary>
    internal void BeginFocus(IntPtr focus, bool isSecret)
    {
        Focus = focus;
        FocusIsSecret = isSecret;
        _secretActivity = false;
        _buffer.Clear();
    }

    /// <summary>Marks the current field secret, e.g. a Win32 ES_PASSWORD control.</summary>
    internal void MarkSecret(DateTime utc)
    {
        FocusIsSecret = true;
        _secretActivity = true;
        // Anything buffered before we learned this must not survive.
        _buffer.Clear();
        LastUtc = utc;
    }

    internal void Append(char c, DateTime utc)
    {
        if (FocusIsSecret) _secretActivity = true;
        else _buffer.Append(c);
        LastUtc = utc;
    }

    internal void Backspace(DateTime utc)
    {
        if (FocusIsSecret) _secretActivity = true;
        else if (_buffer.Length > 0) _buffer.Length--;
        LastUtc = utc;
    }

    internal bool IsIdle(DateTime now, TimeSpan idle) => HasPending && now - LastUtc >= idle;

    /// <summary>
    /// Empties the buffer and reports what it held. Secrecy of the field itself
    /// is deliberately NOT cleared: the user may keep typing into it.
    /// </summary>
    internal (bool WasSecret, string Text) Take()
    {
        var wasSecret = _secretActivity && FocusIsSecret;
        var text = _buffer.ToString();

        _buffer.Clear();
        _secretActivity = false;

        return (wasSecret, text);
    }
}
