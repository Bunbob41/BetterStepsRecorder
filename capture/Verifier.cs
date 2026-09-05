using System.Diagnostics;
using System.Windows.Automation;

namespace BetterSteps.Capture;

/// <summary>
/// Checks whether the controls a recording refers to still exist.
/// </summary>
/// <remarks>
/// Guides rot. A vendor moves a dialog and a forty-step procedure is quietly
/// wrong, and nobody finds out until someone follows it. Because every step
/// already carries the automation id, control type and name of what was
/// clicked, the current application can be asked whether those controls are
/// still there - which turns "re-record the whole thing" into "three of your
/// forty-one steps no longer match".
///
/// The tree is walked ONCE per window and indexed, rather than searching per
/// step: a descendant search across a large application takes seconds, and a
/// forty-step guide would otherwise take minutes and look like a hang.
/// </remarks>
internal static class Verifier
{
    /// <summary>Stop walking a single window after this many elements.</summary>
    private const int ElementCap = 6000;

    /// <summary>Whole-run budget. A verification that never returns is useless.</summary>
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(20);

    internal sealed record Item(string Id, string? Process, string? WindowTitle,
                                string? AutomationId, string? Name, string? ControlType);

    internal sealed record Result(string Id, string Status, string? MatchedBy, string? Window);

    /// <summary>An index of one window's controls, built in a single walk.</summary>
    private sealed class WindowIndex
    {
        internal string Title = "";
        internal readonly HashSet<string> AutomationIds = new(StringComparer.Ordinal);
        internal readonly HashSet<string> NameAndType = new(StringComparer.OrdinalIgnoreCase);
        internal bool Truncated;
    }

    internal static List<Result> Verify(IEnumerable<Item> items)
    {
        var list = items.ToList();
        var results = new List<Result>();
        var deadline = DateTime.UtcNow + Budget;

        // One index per process actually on screen, shared by every step that
        // refers to it.
        var indexes = new Dictionary<string, List<WindowIndex>>(StringComparer.OrdinalIgnoreCase);

        foreach (var process in list.Select(i => i.Process)
                                    .Where(p => !string.IsNullOrWhiteSpace(p))
                                    .Select(p => p!)
                                    .Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (DateTime.UtcNow > deadline) break;
            indexes[process] = IndexWindowsOf(process, deadline);
        }

        foreach (var item in list)
        {
            if (string.IsNullOrWhiteSpace(item.AutomationId) && string.IsNullOrWhiteSpace(item.Name))
            {
                // Nothing identifying was captured, so nothing can be claimed.
                results.Add(new Result(item.Id, "noTarget", null, null));
                continue;
            }

            if (item.Process is null || !indexes.TryGetValue(item.Process, out var windows)
                || windows.Count == 0)
            {
                results.Add(new Result(item.Id, "appNotRunning", null, null));
                continue;
            }

            var found = false;
            foreach (var w in windows)
            {
                if (!string.IsNullOrWhiteSpace(item.AutomationId)
                    && w.AutomationIds.Contains(item.AutomationId!))
                {
                    results.Add(new Result(item.Id, "match", "automationId", w.Title));
                    found = true;
                    break;
                }

                var key = $"{item.ControlType}|{item.Name}";
                if (!string.IsNullOrWhiteSpace(item.Name) && w.NameAndType.Contains(key))
                {
                    results.Add(new Result(item.Id, "match", "name", w.Title));
                    found = true;
                    break;
                }
            }

            if (found) continue;

            // A truncated walk cannot prove absence, only failure to find.
            var truncated = windows.Any(w => w.Truncated);
            results.Add(new Result(item.Id, truncated ? "inconclusive" : "missing", null, null));
        }

        return results;
    }

    private static List<WindowIndex> IndexWindowsOf(string processName, DateTime deadline)
    {
        var indexes = new List<WindowIndex>();
        var bare = processName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            ? processName[..^4] : processName;

        int[] pids;
        try { pids = Process.GetProcessesByName(bare).Select(p => p.Id).ToArray(); }
        catch { return indexes; }
        if (pids.Length == 0) return indexes;

        try
        {
            var roots = AutomationElement.RootElement.FindAll(
                TreeScope.Children, Condition.TrueCondition);

            foreach (AutomationElement top in roots)
            {
                if (DateTime.UtcNow > deadline) break;
                try
                {
                    if (!pids.Contains(top.Current.ProcessId)) continue;
                    indexes.Add(IndexOne(top, deadline));
                }
                catch { /* a window that vanished mid-walk is not an error */ }
            }
        }
        catch { /* UI Automation unavailable; report as not running */ }

        return indexes;
    }

    private static WindowIndex IndexOne(AutomationElement window, DateTime deadline)
    {
        var index = new WindowIndex();
        try { index.Title = window.Current.Name ?? ""; } catch { }

        var walker = TreeWalker.ControlViewWalker;
        var stack = new Stack<AutomationElement>();
        stack.Push(window);
        var seen = 0;

        while (stack.Count > 0)
        {
            if (seen >= ElementCap || DateTime.UtcNow > deadline)
            {
                index.Truncated = true;
                break;
            }

            var element = stack.Pop();
            seen++;

            try
            {
                var current = element.Current;
                if (!string.IsNullOrWhiteSpace(current.AutomationId))
                    index.AutomationIds.Add(current.AutomationId);

                if (!string.IsNullOrWhiteSpace(current.Name))
                {
                    var type = current.ControlType?.ProgrammaticName?.Replace("ControlType.", "");
                    index.NameAndType.Add($"{type}|{current.Name.Trim()}");
                }

                for (var child = walker.GetFirstChild(element); child is not null;
                     child = walker.GetNextSibling(child))
                {
                    stack.Push(child);
                }
            }
            catch
            {
                // Elements disappear while being walked; that is normal in a
                // live application and must not abort the whole index.
            }
        }

        return index;
    }
}
