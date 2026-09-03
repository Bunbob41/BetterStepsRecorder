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

    internal static TargetInfo? Resolve(int x, int y)
    {
        try
        {
            var task = Task.Run(() =>
            {
                var element = AutomationElement.FromPoint(new System.Windows.Point(x, y));
                if (element is null) return null;

                var info = element.Current;
                var name = string.IsNullOrWhiteSpace(info.Name) ? null : info.Name.Trim();
                var controlType = info.ControlType?.ProgrammaticName?.Replace("ControlType.", "");
                var automationId = string.IsNullOrWhiteSpace(info.AutomationId) ? null : info.AutomationId;

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
