namespace BetterSteps.Capture;

/// <summary>
/// Whether a button going down and a button coming up are the same click.
///
/// The recorder now does its work when the button goes DOWN, because that is
/// the last moment the thing being clicked is still on screen: most controls
/// act when the button comes up, and the ones that act on the way down - a
/// menu bar - have not finished painting. Everything a step is made of comes
/// from that moment, and the release only decides what kind of event it was
/// (a click, a double-click, a drag) and whether it is worth keeping.
///
/// So a press has to be matched to its release, and the match has to be able
/// to fail: a recording paused between the two, a press in one application and
/// a release in another, a press whose release never came because a window
/// took the mouse. An unmatched press is thrown away and the release falls
/// back to capturing where it always did, which is the old behaviour rather
/// than a lost step.
///
/// Its own file because it is arithmetic on a point and a clock - no hooks, no
/// COM, no screen - so it can be checked without any of those.
/// </summary>
internal static class PressPairing
{
    /// <summary>
    /// How far the pointer may drift between down and up and still be one
    /// click. A press and its release are the same event to a person even when
    /// the mouse moves a pixel or two under their finger; further than this and
    /// the recorder is calling it a drag anyway.
    /// </summary>
    internal const int SlackPx = 6;

    /// <summary>
    /// How long a press waits for its release before it is abandoned.
    ///
    /// Generously long, because the cost of the two mistakes is not the same.
    /// Waiting too long leaves one unused screenshot in a temporary file, which
    /// the next press cleans up. Giving up too early throws away the one
    /// picture of the screen before the click, which cannot be taken again.
    /// </summary>
    internal static readonly TimeSpan Patience = TimeSpan.FromSeconds(30);

    /// <summary>Whether a release belongs to a press this recorder is holding.</summary>
    internal static bool SameClick(Win32.POINT press, DateTime pressed,
                                   Win32.POINT release, DateTime now)
    {
        if (Math.Abs(press.X - release.X) > SlackPx) return false;
        if (Math.Abs(press.Y - release.Y) > SlackPx) return false;

        var waited = now - pressed;
        // A release that appears to precede its press is a clock that moved,
        // not a click. Refusing it costs the pre-click picture and keeps the
        // step; adopting it could pair a release with somebody else's press.
        return waited >= TimeSpan.Zero && waited <= Patience;
    }

    /// <summary>Whether a press has waited so long that nothing is coming.</summary>
    internal static bool Abandoned(DateTime pressed, DateTime now)
        => now - pressed > Patience;
}
