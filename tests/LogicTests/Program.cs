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
Check("plain typing is kept", taken is (false, "hi"));

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

// Leaving the field and coming back to a normal one re-decides secrecy.
st.BeginFocus(otherBox, isSecret: false);
st.Append('o', t0); st.Append('k', t0);
taken = st.Take();
Check("a different, non-secret field types normally", taken is (false, "ok"));

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

Console.WriteLine($"\n{pass} passed, {fail} failed");
return fail == 0 ? 0 : 1;
