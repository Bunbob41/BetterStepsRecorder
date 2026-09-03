using System.Windows.Automation;

namespace BetterSteps.Capture;

/// <summary>
/// Best-effort accessibility lookup: turns "clicked at 412,308" into
/// "clicked the Save button". Always optional, never allowed to block capture.
/// </summary>
internal static class UiaResolver
{
    // UIA is a cross-process COM call. A hung or busy target app can block it
    // indefinitely, so every lookup runs off-thread behind a hard deadline.
    private static readonly TimeSpan Deadline = TimeSpan.FromMilliseconds(400);

    /// <summary>
    /// Whether the focused control masks its input. Covers the cases the cheap
    /// Win32 style check cannot see: WPF, WinUI and every browser password box.
    /// Fails closed is not an option here (it would suppress ordinary typing),
    /// so it fails open and the structural check remains the first line.
    /// </summary>
    /// <summary>The control's text, used only to detect a Name that is content.</summary>
    private static string? ValueOf(AutomationElement element)
    {
        try
        {
            if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern)
                && pattern is ValuePattern v)
            {
                return v.Current.Value;
            }
        }
        catch { /* pattern unavailable or the element went away */ }
        return null;
    }

    /// <summary>The element that labels this one, when the app declares one.</summary>
    private static string? LabelOf(AutomationElement element)
    {
        try
        {
            var labelled = element.GetCurrentPropertyValue(AutomationElement.LabeledByProperty)
                           as AutomationElement;
            return labelled?.Current.Name;
        }
        catch { return null; }
    }

    internal static bool IsPasswordField(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        try
        {
            var task = Task.Run(() =>
            {
                var element = AutomationElement.FromHandle(hwnd);
                if (element is null) return false;
                if (element.Current.IsPassword) return true;

                // Browsers expose the input as a descendant rather than as the
                // window itself, so the focused child is what actually knows.
                var focused = AutomationElement.FocusedElement;
                return focused is not null && focused.Current.IsPassword;
            });

            return task.Wait(Deadline) && task.Result;
        }
        catch
        {
            return false;
        }
    }

    internal static TargetInfo? Resolve(int x, int y)
    {
        try
        {
            var task = Task.Run(() =>
            {
                var element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
                if (element is null) return null;

                var info = element.Current;
                var controlType = info.ControlType?.ProgrammaticName?.Replace("ControlType.", "");
                var automationId = string.IsNullOrWhiteSpace(info.AutomationId) ? null : info.AutomationId;

                // For text-entry controls the Name is often the field's contents,
                // so it is checked against the value and dropped if it matches.
                // The value is read only to make that comparison and is never
                // stored or emitted.
                var name = UiaNaming.SafeName(
                    info.Name,
                    UiaNaming.IsTextEntry(controlType) ? ValueOf(element) : null,
                    info.IsPassword,
                    controlType,
                    LabelOf(element));

                if (name is null && automationId is null && controlType is null) return null;
                return new TargetInfo(name, controlType, automationId);
            });

            return task.Wait(Deadline) ? task.Result : null;
        }
        catch
        {
            // ElementNotAvailable, COM disconnects, access denied on elevated
            // windows. All expected; degrade to coordinates.
            return null;
        }
    }
}
