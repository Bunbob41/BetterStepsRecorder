Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Windows PowerShell 5.1 runs .NET Framework WinForms, which predates
# HighDpiMode. Harmless for a test target; the window is just system-DPI-aware.
try { [System.Windows.Forms.Application]::SetHighDpiMode([System.Windows.Forms.HighDpiMode]::PerMonitorV2) | Out-Null } catch {}
$f = New-Object System.Windows.Forms.Form
$f.Text = "BSR Test Window"
$f.ClientSize = New-Object System.Drawing.Size(600, 400)
$f.StartPosition = "CenterScreen"
$b = New-Object System.Windows.Forms.Button
$b.Text = "Save"
$b.Name = "btnSave"
$b.Location = New-Object System.Drawing.Point(50, 50)
$b.Size = New-Object System.Drawing.Size(120, 40)
$f.Controls.Add($b)
$t = New-Object System.Windows.Forms.TextBox
$t.Name = "txtNotes"
$t.Location = New-Object System.Drawing.Point(50, 150)
$t.Size = New-Object System.Drawing.Size(300, 30)
$f.Controls.Add($t)
[System.Windows.Forms.Application]::Run($f)
