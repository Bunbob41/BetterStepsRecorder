using System.Text.RegularExpressions;

namespace BetterSteps.Capture;

internal enum KeyKind
{
    /// <summary>A printable character destined for the typing buffer.</summary>
    Text,
    /// <summary>A named key: Enter, Tab, F5, an arrow.</summary>
    Named,
    /// <summary>A modifier chord, i.e. a command rather than typing.</summary>
    Chord,
    /// <summary>Typing happened in a password field. Carries no character.</summary>
    Secret,
}

/// <summary>
/// One keystroke as the hook saw it. A Secret carries no character at all:
/// the point is that what was typed never exists past the hook.
/// </summary>
internal readonly record struct RawKey(
    KeyKind Kind, IntPtr Focus, char Char, string? Label, DateTime Utc)
{
    internal static RawKey Text(IntPtr focus, char c) =>
        new(KeyKind.Text, focus, c, null, DateTime.UtcNow);

    internal static RawKey Named(IntPtr focus, string label) =>
        new(KeyKind.Named, focus, '\0', label, DateTime.UtcNow);

    internal static RawKey Chord(IntPtr focus, string label) =>
        new(KeyKind.Chord, focus, '\0', label, DateTime.UtcNow);

    internal static RawKey Secret(IntPtr focus) =>
        new(KeyKind.Secret, focus, '\0', null, DateTime.UtcNow);
}

/// <summary>
/// Heuristic masking for things that should not survive into a document even
/// when they were typed into an ordinary, non-password field. An SOP is written
/// against a live system, so real card and account numbers get typed during
/// recording as a matter of course.
/// </summary>
internal static class Redactor
{
    private static readonly Regex LongDigits = new(@"\b(?:\d[ -]?){12,19}\b", RegexOptions.Compiled);
    private static readonly Regex Ssn = new(@"\b\d{3}-\d{2}-\d{4}\b", RegexOptions.Compiled);

    internal static string Apply(string text)
    {
        text = Ssn.Replace(text, "[redacted]");
        text = LongDigits.Replace(text, m => Luhn(m.Value) ? "[redacted]" : m.Value);
        return text;
    }

    /// <summary>
    /// Card numbers satisfy the Luhn checksum; order numbers and part numbers of
    /// the same length generally do not. Cheap way to redact far fewer false
    /// positives than a bare length rule would.
    /// </summary>
    private static bool Luhn(string candidate)
    {
        var digits = candidate.Where(char.IsDigit).ToArray();
        if (digits.Length is < 13 or > 19) return false;

        var sum = 0;
        var alternate = false;
        for (var i = digits.Length - 1; i >= 0; i--)
        {
            var n = digits[i] - '0';
            if (alternate)
            {
                n *= 2;
                if (n > 9) n -= 9;
            }
            sum += n;
            alternate = !alternate;
        }
        return sum % 10 == 0;
    }
}
