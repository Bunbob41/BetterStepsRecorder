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

Console.WriteLine($"\n{pass} passed, {fail} failed");
return fail == 0 ? 0 : 1;
