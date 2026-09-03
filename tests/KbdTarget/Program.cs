using System.Windows.Forms;
using System.Drawing;

// Test target for keyboard and click capture. Per-monitor DPI aware on purpose:
// a system-aware target reports virtualised coordinates, which made earlier
// tests click the wrong control on a scaled display and blame the recorder.
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();

        var form = new Form
        {
            Text = "KBD Test Window",
            ClientSize = new Size(600, 300),
            StartPosition = FormStartPosition.CenterScreen,
        };

        var plain = new TextBox
        {
            Name = "txtPlain",
            Location = new Point(40, 60),
            Size = new Size(400, 30),
            AccessibleName = "Customer Name",
        };

        var secret = new TextBox
        {
            Name = "txtSecret",
            UseSystemPasswordChar = true,
            Location = new Point(40, 140),
            Size = new Size(400, 30),
            AccessibleName = "Password",
        };

        form.Controls.Add(plain);
        form.Controls.Add(secret);

        form.Shown += (_, _) =>
        {
            // Physical screen coordinates of each field, for the test to click.
            foreach (var (name, c) in new[] { ("plain", (Control)plain), ("secret", secret) })
            {
                var r = c.RectangleToScreen(c.ClientRectangle);
                Console.WriteLine($"RECT {name} {r.Left} {r.Top} {r.Width} {r.Height}");
            }
            Console.Out.Flush();
        };

        Application.Run(form);
    }
}
