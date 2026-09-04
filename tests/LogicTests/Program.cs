using BetterSteps.Capture;

// Pure-logic checks for the parts of keyboard capture that need no global input:
// redaction and step wording. The hook itself can only be verified by real
// typing, which is the user's to drive.
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

Console.WriteLine($"\n{pass} passed, {fail} failed");
return fail == 0 ? 0 : 1;
