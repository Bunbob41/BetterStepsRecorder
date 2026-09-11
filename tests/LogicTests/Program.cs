using System.IO;
using BetterSteps.Capture;

// Pure-logic checks for the parts of keyboard capture that need no global input:
// redaction and step wording. The hook itself can only be verified by real
// typing, which is the user's to drive.
// Match the engine: it sets this before any DC exists, and without it every
// bound reported here is virtualised and the frame sizes are a fiction.
Win32.SetProcessDpiAwarenessContext(Win32.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);

var pass = 0;
var fail = 0;

void Check(string name, bool ok)
{
    if (ok) { pass++; Console.WriteLine($"  PASS {name}"); }
    else { fail++; Console.WriteLine($"  FAIL {name}"); }
}

Console.WriteLine("redaction:");
Check("valid card number is redacted",
    Redactor.Apply("4111111111111111") == "[redacted]");
Check("card number with spaces is redacted",
    Redactor.Apply("4111 1111 1111 1111") == "[redacted]");
Check("card number inside a sentence is redacted",
    Redactor.Apply("card 4111111111111111 ok").Contains("[redacted]"));
Check("SSN is redacted",
    Redactor.Apply("123-45-6789") == "[redacted]");
Check("ordinary text is untouched",
    Redactor.Apply("ACME Corp") == "ACME Corp");
Check("a long non-Luhn number is kept (order numbers are not cards)",
    Redactor.Apply("1234567890123") == "1234567890123");
Check("short numbers are kept",
    Redactor.Apply("Invoice 12345") == "Invoice 12345");

Console.WriteLine("\nstep wording:");
var window = new WindowInfo("Billing", "app.exe", new RectInfo(0, 0, 100, 100));
var field = new TargetInfo("Customer Name", "Edit", "txtName");

Check("typing names the field",
    StepDescriber.DescribeKey("Typed \"ACME\"", field, window)
        == "Typed \"ACME\" into the \"Customer Name\" field in \"Billing\"");
Check("a key press does not read as going *into* a field",
    !StepDescriber.DescribeKey("Pressed Enter", field, window).Contains("into"));
Check("key press still names the window",
    StepDescriber.DescribeKey("Pressed Enter", field, window)
        == "Pressed Enter in \"Billing\"");
Check("a window-level target is not treated as a field",
    !StepDescriber.DescribeKey("Typed \"x\"", new TargetInfo("Billing", "Window", null), window)
        .Contains("field"));
Check("password wording never mentions content or length",
    StepDescriber.DescribeKey("Entered password", field, window)
        == "Entered password in \"Billing\"");

Console.WriteLine("");
Console.WriteLine("UIA naming (the text-box content leak):");

// The actual regression: a WinForms TextBox with no AccessibleName reports its
// contents as its Name, which put typed text into click descriptions.
Check("a Name equal to the field's contents is dropped",
    UiaNaming.SafeName("hunter2secret", "hunter2secret", false, "Edit", null) is null);
Check("a real label is kept",
    UiaNaming.SafeName("Customer Name", "ACME Corp", false, "Edit", null) == "Customer Name");
Check("LabeledBy is preferred when the Name is content",
    UiaNaming.SafeName("ACME Corp", "ACME Corp", false, "Edit", "Customer Name")
        == "Customer Name");
Check("a password field never uses its Name",
    UiaNaming.SafeName("hunter2", "hunter2", true, "Edit", null) is null);
Check("a password field still uses LabeledBy",
    UiaNaming.SafeName("hunter2", "hunter2", true, "Edit", "Password") == "Password");
Check("a truncated echo of the contents is dropped",
    UiaNaming.SafeName("ACME", "ACME Corp Limited", false, "Edit", null) is null);
Check("buttons keep their Name (not a text-entry control)",
    UiaNaming.SafeName("Save", null, false, "Button", null) == "Save");
Check("a Document control is treated as text entry",
    UiaNaming.SafeName("my private notes", "my private notes", false, "Document", null) is null);
Check("an empty value cannot cause a false match",
    UiaNaming.SafeName("Customer Name", "", false, "Edit", null) == "Customer Name");
Check("whitespace-only Name yields no label",
    UiaNaming.SafeName("   ", null, false, "Edit", null) is null);
Check("short values do not trigger the prefix rule",
    UiaNaming.SafeName("ID", "ID", false, "Edit", null) is null);

Console.WriteLine("");
Console.WriteLine("capture scope:");

var none = new HashSet<uint>();
var ignored = new HashSet<uint> { 100 };
var allowed = new HashSet<uint> { 200 };

Check("with no scope, anything is recorded",
    Scope.Allows(555, none, none));
Check("an ignored process is never recorded",
    !Scope.Allows(100, ignored, none));
Check("with a scope, an in-scope process is recorded",
    Scope.Allows(200, ignored, allowed));
Check("with a scope, everything else is dropped",
    !Scope.Allows(201, ignored, allowed));
Check("ignore beats allow, so the recorder cannot record itself",
    !Scope.Allows(100, ignored, new HashSet<uint> { 100 }));

Console.WriteLine("");
Console.WriteLine("typing buffer and password secrecy:");

var t0 = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
var box = new IntPtr(1);
var otherBox = new IntPtr(2);

// Ordinary typing.
var st = new TypingState();
st.BeginFocus(box, isSecret: false);
st.Append('h', t0); st.Append('i', t0);
var taken = st.Take();
Check("plain typing is kept", !taken.WasSecret && taken.Text == "hi");

// A password field keeps nothing.
st = new TypingState();
st.BeginFocus(box, isSecret: true);
foreach (var c in "hunter2") st.Append(c, t0);
taken = st.Take();
Check("password characters are never buffered", taken.Text.Length == 0);
Check("password activity is reported", taken.WasSecret);

// THE REGRESSION: typing, flushing on idle, then typing more in the SAME
// password field used to come back as plain text.
st = new TypingState();
st.BeginFocus(box, isSecret: true);
foreach (var c in "hunter") st.Append(c, t0);
st.Take();                                   // idle flush emits "Entered password"
foreach (var c in "2secret") st.Append(c, t0);
taken = st.Take();
Check("a flush does not un-secret the field", taken.Text.Length == 0);
Check("continued password typing still reports as secret", taken.WasSecret);

// ---- a field in an application this recording does not cover -----------------
// Scope was applied when a step was EMITTED, which meant every character typed
// into every other application on the desktop was accumulated in this buffer
// first and thrown away afterwards. Nothing reached disk - but the promise is
// that documenting one system does not capture your mail and chat, and holding
// somebody's password in a buffer for the length of a flush is not keeping it.
st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: true, inScope: false);
foreach (var c in "my bank password") st.Append(c, t0);
taken = st.Take();
Check("an out-of-scope field keeps no characters", taken.Text.Length == 0);
Check("and reports no activity at all",
      !taken.WasSecret && taken.Presses == 0 && taken.Keys.Length == 0);

// Not even the fact that something was typed there.
st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: true, inScope: false);
st.Append('x', t0);
Check("nothing is pending from out of scope", !st.HasPending);

// A field that masks its input is no different: out of scope, there is nothing
// to say about it, not even that a password was entered.
st = new TypingState();
st.BeginFocus(box, isSecret: true, acceptsText: true, inScope: false);
foreach (var c in "hunter2") st.Append(c, t0);
st.MarkSecret(t0);
taken = st.Take();
Check("an out-of-scope password is not even mentioned",
      !taken.WasSecret && taken.Text.Length == 0);

// Keys driving an application, out of scope, are not counted either.
st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: false, inScope: false);
foreach (var c in "wasd") st.Append(c, t0);
st.Backspace(t0);
taken = st.Take();
Check("out-of-scope key presses are not counted", taken.Presses == 0);

// And moving back into scope records normally again: scope is a property of
// the field, decided afresh when focus moves, exactly like secrecy.
st.BeginFocus(otherBox, isSecret: false, acceptsText: true, inScope: true);
st.Append('o', t0); st.Append('k', t0);
taken = st.Take();
Check("returning to a covered field records again", taken.Text == "ok");

// Leaving the field and coming back to a normal one re-decides secrecy.
st = new TypingState();
st.BeginFocus(box, isSecret: true);
foreach (var c in "hunter") st.Append(c, t0);
st.Take();
st.BeginFocus(otherBox, isSecret: false);
st.Append('o', t0); st.Append('k', t0);
taken = st.Take();
Check("a different, non-secret field types normally",
      !taken.WasSecret && taken.Text == "ok");

// ---- keys that are commands, not a value ------------------------------------
// 42 of the 106 steps in a real recording read Typed "wddad" - W A S D driving
// a car. The keys were going to the application, not into a field, and the
// difference is what the focused control is, not which application is running:
// a game is a legitimate thing to document and a CAD tool's navigation keys
// look the same.

st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: false);
foreach (var c in "wddadw") st.Append(c, t0);
taken = st.Take();
Check("keys sent to the application are not transcribed", taken.Text.Length == 0);
Check("they are counted instead", taken.Presses == 6);
Check("and reported as which keys, not in which order", taken.Keys == "A, D, W");
Check("nothing is treated as secret", !taken.WasSecret);

// The same keys, in a text box, are a value and must survive intact.
st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: true);
foreach (var c in "wddadw") st.Append(c, t0);
taken = st.Take();
Check("the same keys in a text field are still transcribed", taken.Text == "wddadw");
Check("and are not counted as commands", taken.Presses == 0);

// A field that cannot be identified is assumed to take text, so real typing is
// never silently discarded when UI Automation has no answer.
st = new TypingState();
st.BeginFocus(box, isSecret: false);
foreach (var c in "ACME") st.Append(c, t0);
Check("an unknown control defaults to transcribing", st.Take().Text == "ACME");

// Secrecy still wins over everything.
st = new TypingState();
st.BeginFocus(box, isSecret: true, acceptsText: false);
foreach (var c in "hunter2") st.Append(c, t0);
taken = st.Take();
Check("a secret field is never counted or transcribed",
      taken.Text.Length == 0 && taken.Presses == 0);
Check("and still reports as secret", taken.WasSecret);

// Moving between the two kinds re-decides, like secrecy does.
st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: false);
st.Append('w', t0);
st.BeginFocus(otherBox, isSecret: false, acceptsText: true);
st.Append('h', t0); st.Append('i', t0);
taken = st.Take();
Check("moving to a text field starts transcribing again",
      taken.Text == "hi" && taken.Presses == 0);

// One press should not read "1 times" - the Recorder words it, but the count
// has to be exact for it to.
st = new TypingState();
st.BeginFocus(box, isSecret: false, acceptsText: false);
st.Append('e', t0);
Check("a single press is counted as one", st.Take().Presses == 1);

// Learning mid-buffer that a field is secret discards what was already typed.
st = new TypingState();
st.BeginFocus(box, isSecret: false);
st.Append('a', t0); st.Append('b', t0);
st.MarkSecret(t0);
taken = st.Take();
Check("marking secret discards anything already buffered", taken.Text.Length == 0);
Check("marking secret reports as secret", taken.WasSecret);

// Backspace in a secret field must not fall through to the plain buffer.
st = new TypingState();
st.BeginFocus(box, isSecret: true);
st.Append('x', t0); st.Backspace(t0);
taken = st.Take();
Check("backspace in a password field keeps nothing", taken.Text.Length == 0 && taken.WasSecret);

// Backspace edits ordinary text.
st = new TypingState();
st.BeginFocus(box, isSecret: false);
st.Append('a', t0); st.Append('b', t0); st.Backspace(t0);
Check("backspace edits plain text", st.Take().Text == "a");

// Idle only fires when there is something to flush.
st = new TypingState();
st.BeginFocus(box, isSecret: false);
Check("an empty buffer is never idle-flushed",
    !st.IsIdle(t0.AddSeconds(60), TimeSpan.FromSeconds(1)));
st.Append('a', t0);
Check("a stale buffer is idle", st.IsIdle(t0.AddSeconds(60), TimeSpan.FromSeconds(1)));
Check("a fresh buffer is not idle", !st.IsIdle(t0, TimeSpan.FromSeconds(1)));

// An empty flush must not emit a spurious password step.
st = new TypingState();
st.BeginFocus(box, isSecret: true);
taken = st.Take();
Check("focusing a password field without typing reports nothing",
    !taken.WasSecret && taken.Text.Length == 0);

Console.WriteLine("");
Console.WriteLine("screenshot writing (exercises the encode/dispose path):");

// A small fixed region; enough to drive every branch of CaptureTo. The default
// scale is the one that used to dispose the same Bitmap twice.
var region = new System.Drawing.Rectangle(0, 0, 240, 160);
var tempDir = Path.Combine(Path.GetTempPath(), "bsr-capture-" + Guid.NewGuid().ToString("N"));

foreach (var (fmt, scale, quality) in new[]
         {
             ("png", 1.0, 85), ("png", 0.5, 85),
             ("jpeg", 1.0, 85), ("jpeg", 1.0, 40), ("jpeg", 0.25, 85),
         })
{
    var opts = CaptureOptions.Clamp(fmt, quality, scale);
    var file = Path.Combine(tempDir, $"shot-{fmt}-{scale}-{quality}.{opts.Extension}");

    var ok = false;
    string detail;
    try
    {
        ScreenCapture.CaptureTo(region, file, opts);
        var info = new FileInfo(file);
        // Confirm the bytes decode: a double-disposed bitmap or a broken encoder
        // path would throw above, and a truncated file would fail here.
        using var img = System.Drawing.Image.FromFile(file);
        var expected = (int)Math.Round(region.Width * opts.Scale);
        ok = info.Length > 0 && Math.Abs(img.Width - expected) <= 1;
        detail = $"{info.Length} bytes, {img.Width}x{img.Height}";
    }
    catch (Exception ex)
    {
        detail = ex.GetType().Name + ": " + ex.Message;
    }

    Check($"{fmt} @ {(int)(scale * 100)}% q{quality} writes a decodable image ({detail})", ok);
}

// Repeated captures at the default scale: the disposal bug, had it not been
// idempotent, would surface on the second call reusing the path.
try
{
    var opts = CaptureOptions.Clamp("png", 85, 1.0);
    for (var i = 0; i < 5; i++)
        ScreenCapture.CaptureTo(region, Path.Combine(tempDir, "repeat.png"), opts);
    Check("repeated captures at default scale do not throw", true);
}
catch (Exception ex)
{
    Check("repeated captures at default scale do not throw (" + ex.Message + ")", false);
}

try { Directory.Delete(tempDir, recursive: true); } catch { }

Console.WriteLine("");
Console.WriteLine("capture frame:");

Check("window is the default",
    CaptureOptions.Clamp("png", 85, 1.0, null).Frame == "window");
Check("an unknown frame falls back to window",
    CaptureOptions.Clamp("png", 85, 1.0, "nonsense").Frame == "window");
Check("monitor is accepted", CaptureOptions.Clamp("png", 85, 1.0, "monitor").Frame == "monitor");
Check("screen is accepted", CaptureOptions.Clamp("png", 85, 1.0, "SCREEN").Frame == "screen");

// The frames must actually differ in size on a real desktop, and a click with
// no window must still yield a usable frame rather than a blind guess.
var here = new Win32.POINT { X = 10, Y = 10 };
var win = ScreenCapture.ResolveBounds(IntPtr.Zero, here, "window");
var mon = ScreenCapture.ResolveBounds(IntPtr.Zero, here, "monitor");
var all = ScreenCapture.ResolveBounds(IntPtr.Zero, here, "screen");

Console.WriteLine($"    window={win.Width}x{win.Height} monitor={mon.Width}x{mon.Height} screen={all.Width}x{all.Height}");
Check("a window-less click still resolves a frame", win.Width > 0 && win.Height > 0);
Check("monitor framing is at least as large as the fallback box",
    mon.Width >= win.Width && mon.Height >= win.Height);
Check("screen framing covers the whole virtual desktop",
    all.Width >= mon.Width && all.Height >= mon.Height);
Check("monitor framing starts at a real monitor origin",
    mon.Width > 100 && mon.Height > 100);

// ---- what an application is called -------------------------------------------
// Windows already knows the good name - it is the FileDescription every
// executable carries - and "explorer.exe" is nobody's idea of an answer when
// somebody is trying to remember which recording is which.
{
    var explorer = System.Diagnostics.Process.GetProcessesByName("explorer");
    if (explorer.Length > 0)
    {
        var name = WindowResolver.ProductNameOf(explorer[0]);
        Check("Windows is asked what an executable calls itself",
              !string.IsNullOrWhiteSpace(name));
        Check("and the answer is not the filename",
              !name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase));

        // Cached: this runs once per captured step, and reading version
        // information means opening the file on disk.
        var again = WindowResolver.ProductNameOf(explorer[0]);
        Check("and it is remembered rather than read again", again == name);
    }
    else
    {
        Console.WriteLine("  SKIP  explorer is not running");
    }

    // A process that has exited cannot be asked, and that must cost the
    // friendly name and nothing else.
    using var gone = new System.Diagnostics.Process();
    Check("a process that cannot be asked yields nothing, not an exception",
          WindowResolver.ProductNameOf(gone) == "");
}

Console.WriteLine("\nmatching a release to the press it came from:");
{
    // The recorder takes the picture, the window and the name when the button
    // goes DOWN - the last moment the thing being clicked is still on screen.
    // The release then has to be matched to that press, and matching wrongly is
    // worse than not matching at all: it would put one step's picture on
    // another step.
    var dot = (int x, int y) => new Win32.POINT { X = x, Y = y };
    var pressedAt = new DateTime(2026, 1, 1, 12, 0, 0, DateTimeKind.Utc);

    Check("a press and a release in the same place are one click",
        PressPairing.SameClick(dot(400, 300), pressedAt, dot(400, 300), pressedAt.AddMilliseconds(90)));
    Check("and a pixel or two of drift under a finger still is",
        PressPairing.SameClick(dot(400, 300), pressedAt, dot(404, 297), pressedAt.AddMilliseconds(90)));
    Check("a release somewhere else is not",
        !PressPairing.SameClick(dot(400, 300), pressedAt, dot(460, 300), pressedAt.AddMilliseconds(90)));

    // A drag reports the point the button went DOWN as its own point, which is
    // what makes a drag pair with its press at all.
    Check("a long press is still one click - people hold the button",
        PressPairing.SameClick(dot(400, 300), pressedAt, dot(400, 300), pressedAt.AddSeconds(4)));
    Check("but a press from another age is not adopted",
        !PressPairing.SameClick(dot(400, 300), pressedAt, dot(400, 300), pressedAt.AddMinutes(5)));
    // A recording paused between the two, then resumed: the release must not
    // reach back and take a picture of a screen from before the pause.
    Check("nor one from before a pause",
        !PressPairing.SameClick(dot(400, 300), pressedAt, dot(400, 300), pressedAt.Add(PressPairing.Patience).AddSeconds(1)));
    Check("a release that appears to precede its press is refused",
        !PressPairing.SameClick(dot(400, 300), pressedAt, dot(400, 300), pressedAt.AddSeconds(-1)));

    Check("a press nobody released is abandoned once it is old",
        PressPairing.Abandoned(pressedAt, pressedAt.AddMinutes(2)));
    Check("and held on to while it might still be released",
        !PressPairing.Abandoned(pressedAt, pressedAt.AddMilliseconds(200)));
    // The two have to agree, or a press could be abandoned and then matched.
    Check("what is abandoned can no longer be matched",
        PressPairing.Abandoned(pressedAt, pressedAt.AddMinutes(2))
        && !PressPairing.SameClick(dot(1, 1), pressedAt, dot(1, 1), pressedAt.AddMinutes(2)));
}

Console.WriteLine("\nhow much of a frame the press copy can supply:");
{
    var pressMonitor = new System.Drawing.Rectangle(0, 0, 1920, 1080);
    Check("a dialog on the monitor is supplied whole",
        ScreenCapture.PressCrop(pressMonitor, new System.Drawing.Rectangle(559, 159, 801, 692))
            == new System.Drawing.Rectangle(559, 159, 801, 692));
    // Measured from a real recording: HYPACK maximised reports 9,0 1922x1031.
    var pressMaximised = ScreenCapture.PressCrop(pressMonitor, new System.Drawing.Rectangle(9, 0, 1922, 1031));
    Check("a maximised window's overhang is trimmed rather than refused",
        pressMaximised is System.Drawing.Rectangle pm && pm.Right == 1920 && pm.Width == 1911);
    Check("half a window on the next monitor is refused - half a dialog is not a picture of it",
        ScreenCapture.PressCrop(pressMonitor, new System.Drawing.Rectangle(1500, 100, 800, 600)) is null);
    Check("a frame on another monitor entirely is refused",
        ScreenCapture.PressCrop(pressMonitor, new System.Drawing.Rectangle(2000, 0, 800, 600)) is null);
    Check("an empty frame is refused",
        ScreenCapture.PressCrop(pressMonitor, System.Drawing.Rectangle.Empty) is null);
}

Console.WriteLine("\ncutting a frame out of the copied monitor:");
{
    // The copy comes from the SECOND monitor, which starts at 1920: a mistake in
    // the offset cuts the wrong pixels rather than failing loudly.
    var pressArea = new System.Drawing.Rectangle(1920, 0, 400, 300);
    using var pressPixels = new System.Drawing.Bitmap(400, 300, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
    using (var g = System.Drawing.Graphics.FromImage(pressPixels))
    {
        g.Clear(System.Drawing.Color.Blue);
        g.FillRectangle(System.Drawing.Brushes.Red, 100, 50, 60, 40);
    }
    var pressOut = Path.Combine(Path.GetTempPath(), $"bsr-presscrop-{Guid.NewGuid():N}.png");
    try
    {
        ScreenCapture.SaveCrop(pressPixels, pressArea, new System.Drawing.Rectangle(2020, 50, 60, 40),
                               pressOut, new CaptureOptions());
        using (var back = new System.Drawing.Bitmap(pressOut))
        {
            Check("the cut is the size of the frame", back.Width == 60 && back.Height == 40);
            var allRed = true;
            for (var y = 2; y < back.Height - 2; y += 4)
                for (var x = 2; x < back.Width - 2; x += 4)
                {
                    var c = back.GetPixel(x, y);
                    if (c.R < 200 || c.B > 60) allRed = false;
                }
            Check("and they are the right pixels: the monitor's own offset is taken off", allRed);
        }
    }
    finally { try { File.Delete(pressOut); } catch { } }
}

Console.WriteLine("\nwhat a menu or a dropdown is framed as:");
{
    // Real windows, created and never shown: styles and owners exist from the
    // moment a window does, so nothing flashes on screen.
    const int pressWsPopup = unchecked((int)0x80000000);
    const int pressWsCaption = 0x00C00000;
    const int pressWsOverlapped = 0x00CF0000;
    System.Windows.Forms.NativeWindow MakeWindow(int style, IntPtr owner)
    {
        var w = new System.Windows.Forms.NativeWindow();
        w.CreateHandle(new System.Windows.Forms.CreateParams
        {
            Style = style, Parent = owner, X = -32000, Y = -32000, Width = 200, Height = 120, Caption = "",
        });
        return w;
    }

    var appWindow = MakeWindow(pressWsOverlapped, IntPtr.Zero);
    var dialogWindow = MakeWindow(pressWsPopup | pressWsCaption, appWindow.Handle);
    var listWindow = MakeWindow(pressWsPopup, dialogWindow.Handle);
    var looseWindow = MakeWindow(pressWsPopup, IntPtr.Zero);
    try
    {
        Check("an application window is not a transient popup",
            !WindowResolver.IsTransientPopup(appWindow.Handle));
        Check("a dialog is not one either - it has a title bar, and it is the step",
            !WindowResolver.IsTransientPopup(dialogWindow.Handle));
        Check("an owned popup without a title bar - a dropdown list - is",
            WindowResolver.IsTransientPopup(listWindow.Handle));
        Check("a dropdown list is framed as the dialog it belongs to",
            WindowResolver.FrameWindowFor(listWindow.Handle, IntPtr.Zero) == dialogWindow.Handle);
        Check("not as the application that owns the dialog",
            WindowResolver.FrameWindowFor(listWindow.Handle, IntPtr.Zero) != appWindow.Handle);
        Check("a dialog is framed as itself",
            WindowResolver.FrameWindowFor(dialogWindow.Handle, appWindow.Handle) == dialogWindow.Handle);
        Check("an ordinary window is framed as itself",
            WindowResolver.FrameWindowFor(appWindow.Handle, dialogWindow.Handle) == appWindow.Handle);
        // Without a menu's class or an owner there is nothing to say it belongs to
        // anything, and guessing would frame a splash screen as whatever was open.
        Check("an unowned popup that is not a menu is framed as itself",
            WindowResolver.FrameWindowFor(looseWindow.Handle, dialogWindow.Handle) == looseWindow.Handle);
    }
    finally
    {
        listWindow.DestroyHandle();
        looseWindow.DestroyHandle();
        dialogWindow.DestroyHandle();
        appWindow.DestroyHandle();
    }
}

Console.WriteLine("\nwhat counts as full-screen, and so is not copied inside the hook:");
{
    var fullScreenMonitor = new System.Drawing.Rectangle(0, 0, 1920, 1080);
    Win32.RECT FullScreenRect(int l, int t, int r, int b) => new Win32.RECT { Left = l, Top = t, Right = r, Bottom = b };
    const long fullScreenCaption = 0x00C00000L;
    const long fullScreenPopup = 0x80000000L;

    Check("a borderless window covering the monitor is full-screen - a game",
        PressShots.FillsMonitor(FullScreenRect(0, 0, 1920, 1080), fullScreenMonitor, fullScreenPopup));
    // With the taskbar set to hide, a maximised window covers the whole monitor
    // too - and HYPACK maximised is the window the copy exists for.
    Check("a maximised application is not, even with the taskbar hidden: it has a title bar",
        !PressShots.FillsMonitor(FullScreenRect(-9, -9, 1929, 1089), fullScreenMonitor, fullScreenCaption));
    Check("a maximised application with the taskbar showing does not cover the monitor at all",
        !PressShots.FillsMonitor(FullScreenRect(9, 0, 1931, 1031), fullScreenMonitor, fullScreenCaption));
    Check("a borderless window stopping short of an edge is not full-screen",
        !PressShots.FillsMonitor(FullScreenRect(0, 0, 1920, 1040), fullScreenMonitor, fullScreenPopup));
    Check("a full-screen window on the other monitor does not count on this one",
        !PressShots.FillsMonitor(FullScreenRect(1920, 0, 3840, 1080), fullScreenMonitor, fullScreenPopup));
}

Console.WriteLine($"\n{pass} passed, {fail} failed");
return fail == 0 ? 0 : 1;
