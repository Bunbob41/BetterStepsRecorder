namespace BetterSteps.Capture;

internal static class StepDescriber
{
    internal static string Describe(string action, TargetInfo? target, WindowInfo? window)
    {
        // When UIA resolves no better than the frame itself it just echoes the
        // window title back, giving "Dragged X in X". Drop it and keep the "in X".
        if (target is not null && window is not null
            && (target.ControlType is "Window" or "Pane" or "TitleBar"
                || string.Equals(target.Name, window.Title, StringComparison.Ordinal)))
        {
            target = null;
        }

        var verb = action switch
        {
            "leftClick"   => "Clicked",
            "rightClick"  => "Right-clicked",
            "doubleClick" => "Double-clicked",
            "drag"        => "Dragged",
            _             => "Interacted with",
        };

        var what = DescribeTarget(target);
        var where = window is not null && !string.IsNullOrWhiteSpace(window.Title)
            ? $" in \"{window.Title}\""
            : "";

        return what is null ? $"{verb}{where}" : $"{verb} {what}{where}";
    }

    private static string? DescribeTarget(TargetInfo? t)
    {
        if (t is null) return null;

        var noun = t.ControlType switch
        {
            "Button"      => "button",
            "Edit"        => "text box",
            "CheckBox"    => "checkbox",
            "RadioButton" => "radio button",
            "ComboBox"    => "dropdown",
            "MenuItem"    => "menu item",
            "TabItem"     => "tab",
            "Hyperlink"   => "link",
            "ListItem"    => "list item",
            "TreeItem"    => "tree item",
            _             => null,
        };

        if (!string.IsNullOrWhiteSpace(t.Name))
            return noun is null ? $"\"{t.Name}\"" : $"the \"{t.Name}\" {noun}";

        return noun is null ? null : $"a {noun}";
    }
}
