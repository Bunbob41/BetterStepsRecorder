// Test target for naming controls in an older application on a scaled display.
//
// DPI-UNAWARE on purpose, the opposite of KbdTarget: HYPACK is, and on a monitor
// at 125% a click on its "Tracklines" tab was recorded as "Charts". Windows draws
// such an application at 96 dpi and scales the result up.
//
// Two rows of tabs, because they are described to UI Automation in different
// places. A WinForms TabControl describes its own tabs from inside this process,
// at the scale it knows, and was never affected - which is why a first attempt to
// reproduce this with one found nothing wrong. A plain Windows tab control, which
// is what an MFC dialog like HYPACK's has, has no description of its own: UI
// Automation builds one INSIDE THE ASKING PROCESS by measuring the control, in
// this application's unscaled coordinates. That is the row that went wrong.
//
// And a checkbox, which is a window of its own and was always named correctly.
//
// Prints where everything is, in its OWN coordinates (logical, 96 dpi):
//   hwnd <handle>
//   item <x> <y> <winforms|native|checkbox> <name>
//   ready
// and closes itself after twenty seconds, so a test that fails cannot leave it
// on the screen.
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

internal static class Program
{
    const int TCM_FIRST = 0x1300;
    const int TCM_GETITEMRECT = TCM_FIRST + 10;
    const int TCM_SETITEMSIZE = TCM_FIRST + 41;
    const int TCM_INSERTITEMW = TCM_FIRST + 62;
    const uint TCIF_TEXT = 0x0001;
    const int TCS_FIXEDWIDTH = 0x0400;
    const int WS_CHILD = 0x40000000, WS_VISIBLE = 0x10000000, WS_CLIPSIBLINGS = 0x04000000;

    [StructLayout(LayoutKind.Sequential)]
    struct TCITEMW
    {
        public uint mask, dwState, dwStateMask;
        public IntPtr pszText;
        public int cchTextMax, iImage;
        public IntPtr lParam;
    }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }

    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, ref TCITEMW l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, ref RECT l);
    [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);

    [STAThread]
    private static void Main()
    {
        Application.SetHighDpiMode(HighDpiMode.DpiUnaware);
        Application.EnableVisualStyles();

        // HYPACK's Settings tabs, which is where this was found.
        string[] names = { "General", "Soundings", "Seabed ID", "Tracklines",
                           "Charts", "Targets", "Planned Lines", "3D Options" };

        var form = new Form
        {
            Text = "DPI Tab Target",
            StartPosition = FormStartPosition.Manual,
            Location = new Point(120, 120),
            ClientSize = new Size(720, 340),
            TopMost = true,
        };
        var tabs = new TabControl
        {
            Location = new Point(10, 10),
            Size = new Size(700, 180),
            SizeMode = TabSizeMode.Fixed,
            ItemSize = new Size(82, 22),
        };
        foreach (var n in names) tabs.TabPages.Add(new TabPage(n) { Name = n });
        var check = new CheckBox { Text = "Show Legend", Location = new Point(20, 300), AutoSize = true };
        form.Controls.Add(tabs);
        form.Controls.Add(check);

        NativeWindow? native = null;
        form.Shown += (_, _) =>
        {
            native = new NativeWindow();
            native.CreateHandle(new CreateParams
            {
                ClassName = "SysTabControl32",
                Style = WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS | TCS_FIXEDWIDTH,
                Parent = form.Handle,
                X = 10, Y = 210, Width = 700, Height = 70,
            });
            for (var i = 0; i < names.Length; i++)
            {
                var text = Marshal.StringToHGlobalUni(names[i]);
                var item = new TCITEMW { mask = TCIF_TEXT, pszText = text };
                SendMessage(native.Handle, TCM_INSERTITEMW, (IntPtr)i, ref item);
                Marshal.FreeHGlobal(text);
            }
            SendMessage(native.Handle, TCM_SETITEMSIZE, IntPtr.Zero, (IntPtr)((22 << 16) | 82));
            Application.DoEvents();

            Console.WriteLine($"hwnd {form.Handle.ToInt64()}");
            for (var i = 0; i < tabs.TabCount; i++)
            {
                var r = tabs.GetTabRect(i);
                var c = tabs.PointToScreen(new Point(r.X + r.Width / 2, r.Y + r.Height / 2));
                Console.WriteLine($"item {c.X} {c.Y} winforms {names[i]}");
            }
            for (var i = 0; i < names.Length; i++)
            {
                var r = new RECT();
                SendMessage(native.Handle, TCM_GETITEMRECT, (IntPtr)i, ref r);
                var p = new POINT { X = (r.Left + r.Right) / 2, Y = (r.Top + r.Bottom) / 2 };
                ClientToScreen(native.Handle, ref p);
                Console.WriteLine($"item {p.X} {p.Y} native {names[i]}");
            }
            var cc = check.PointToScreen(new Point(check.Width / 2, check.Height / 2));
            Console.WriteLine($"item {cc.X} {cc.Y} checkbox Show Legend");
            Console.WriteLine("ready");
            Console.Out.Flush();
        };

        var timer = new System.Windows.Forms.Timer { Interval = 20000 };
        timer.Tick += (_, _) => form.Close();
        timer.Start();
        Application.Run(form);
        GC.KeepAlive(native);
    }
}
