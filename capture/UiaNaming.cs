namespace BetterSteps.Capture;

/// <summary>
/// Decides whether a UI Automation Name is safe to use as a label.
/// </summary>
/// <remarks>
/// For text-entry controls, Name is frequently the control's *contents* rather
/// than a label: a WinForms TextBox with no AccessibleName reports its Text.
/// Left alone, that leaks whatever the user typed into the description of a
/// mere click - which would defeat the password suppression in the keyboard
/// path, since a click on the field afterwards would print what the field holds.
///
/// Pure and separated from the COM calls so it can be tested without UI
/// Automation, a desktop, or synthetic input.
/// </remarks>
internal static class UiaNaming
{
    /// <summary>Control types whose Name may really be their content.</summary>
    internal static bool IsTextEntry(string? controlType) =>
        controlType is "Edit" or "Document" or "ComboBox";

    /// <summary>
    /// The label to show for a control, or null when nothing safe is available.
    /// A null result still yields a useful description ("a text box"), so
    /// dropping a suspect name costs little and keeps content out of the guide.
    /// </summary>
    internal static string? SafeName(string? name, string? value, bool isPassword,
                                     string? controlType, string? labeledBy)
    {
        var label = Clean(labeledBy);

        if (!IsTextEntry(controlType)) return Clean(name) ?? label;

        // A masked field's Name is never trustworthy, whatever it holds.
        if (isPassword) return label;

        var cleanName = Clean(name);
        if (cleanName is null) return label;

        // The decisive test: if Name tracks the field's value, it is content.
        // An explicit label and the text someone typed do not coincide by chance.
        if (LooksLikeContent(cleanName, Clean(value))) return label;

        return cleanName;
    }

    private static bool LooksLikeContent(string name, string? value)
    {
        if (value is null) return false;

        if (string.Equals(name, value, StringComparison.Ordinal)) return true;

        // Partial matches catch controls that report a truncated or decorated
        // version of their contents.
        return value.Length >= 3
            && (value.StartsWith(name, StringComparison.Ordinal)
                || name.StartsWith(value, StringComparison.Ordinal));
    }

    private static string? Clean(string? s) =>
        string.IsNullOrWhiteSpace(s) ? null : s.Trim();
}
