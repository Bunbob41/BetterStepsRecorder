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

    /// <summary>
    /// Whether the focused control is somewhere text is entered.
    /// </summary>
    /// <remarks>
    /// The difference between documentation and noise. Keys pressed with a text
    /// box focused are a value worth transcribing: Typed "ACME Corp". The same
    /// keys pressed with no text box focused are commands to the application -
    /// W A S D driving a car, panning a point cloud, an editor's shortcuts - and
    /// transcribing those produced steps reading Typed "wddad". In one 106 step
    /// recording, 42 of the steps were that.
    ///
    /// Deliberately NOT a judgement about which application is running. A game
    /// is a legitimate thing to document, and a CAD tool's navigation keys look
    /// identical to a game's. What matters is where the keys are going.
    ///
    /// Fails OPEN, like the password check above and for the same reason: when
    /// UI Automation cannot answer, transcribing is the old behaviour, whereas
    /// summarising would silently discard someone's typing.
    /// </remarks>
    internal static bool FocusAcceptsText(IntPtr hwnd)
    {
        try
        {
            var task = Task.Run(() =>
            {
                var element = AutomationElement.FocusedElement
                              ?? (hwnd != IntPtr.Zero ? AutomationElement.FromHandle(hwnd) : null);
                if (element is null) return true;   // cannot tell: assume text

                var type = element.Current.ControlType;
                if (type == ControlType.Edit || type == ControlType.Document
                    || type == ControlType.ComboBox || type == ControlType.Spinner)
                {
                    return true;
                }

                // Some frameworks report a generic type but still expose a text
                // pattern, which is the more honest signal.
                if (element.TryGetCurrentPattern(TextPattern.Pattern, out _)) return true;
                if (element.TryGetCurrentPattern(ValuePattern.Pattern, out var vp)
                    && vp is ValuePattern v && !v.Current.IsReadOnly)
                {
                    return true;
                }

                return false;
            });

            return !task.Wait(Deadline) || task.Result;
        }
        catch
        {
            return true;
        }
    }

    /// <summary>
    /// Starts asking what is at a point, without waiting for the answer.
    /// </summary>
    ///
    /// <remarks>
    /// The question is "what did they click", and the only moment that is
    /// reliably true is the moment of the click. Asking later asks about
    /// whatever is there by then - and a click that opens a dialog puts
    /// something else under the pointer within a few tens of milliseconds. A
    /// step recorded that way names a control the user never touched, which is
    /// worse than naming nothing: the screenshot and the words disagree, and
    /// only the words are wrong.
    ///
    /// So the caller starts this first and collects it after the screenshot,
    /// which the query then overlaps rather than follows.
    /// </remarks>
    internal static Task<TargetInfo?>? Begin(int x, int y)
    {
        try
        {
            return Task.Run(() =>
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
        }
        catch
        {
            // ElementNotAvailable, COM disconnects, access denied on elevated
            // windows. All expected; degrade to coordinates.
            return null;
        }
    }

    /// <summary>
    /// Collects what <see cref="Begin"/> started, or gives up.
    ///
    /// The deadline is measured from here rather than from the click, so the
    /// time the screenshot took is time the query already had - it costs
    /// nothing and the answer is usually waiting.
    /// </summary>
    internal static TargetInfo? End(Task<TargetInfo?>? pending)
    {
        if (pending is null) return null;
        try
        {
            return pending.Wait(Deadline) ? pending.Result : null;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Begin and End together, for callers with nothing to overlap.</summary>
    internal static TargetInfo? Resolve(int x, int y) => End(Begin(x, y));
}
