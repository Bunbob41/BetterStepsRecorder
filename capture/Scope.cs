namespace BetterSteps.Capture;

/// <summary>
/// Whether an event belonging to a process should be recorded at all.
/// Pure so the precedence rule can be tested without a desktop.
/// </summary>
internal static class Scope
{
    /// <summary>
    /// Exclusion always wins over inclusion. The recorder's own windows are in
    /// the ignore set, and no scope choice may drag them back in - otherwise
    /// scoping to "everything the recorder can see" would record the recorder.
    /// An empty allow-list means no scoping.
    /// </summary>
    internal static bool Allows(uint pid, ISet<uint> ignored, ISet<uint> allowed)
    {
        if (ignored.Contains(pid)) return false;
        return allowed.Count == 0 || allowed.Contains(pid);
    }
}
