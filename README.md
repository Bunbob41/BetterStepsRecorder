# Steps Recorder

Records what you do on screen — every click, drag and keystroke — with a
screenshot of each step, then turns it into a guide you can hand to someone.
A modern replacement for the deprecated Windows PSR.exe.

## What it does

- **Captures accurately.** Correct on mixed-DPI multi-monitor setups, and works
  with GPU-composited applications (Chrome, Electron, VS Code) that defeat the
  usual screenshot approach.
- **Names what you clicked.** Uses UI Automation, so a step reads
  *Clicked the "Save" button in "Billing"* rather than *Clicked at 412,308*.
- **Records typing, not keystrokes.** Text is grouped per field. Password fields
  record only that a password was entered; card and SSN shapes are masked even
  in ordinary fields.
- **Scopes to one application.** Documenting one system does not capture your
  mail and chat alongside it — out-of-scope events are never captured at all.
- **Frames each shot as you choose** — the window that was clicked, the whole
  monitor, or every display.
- **Blurs regions destructively.** The pixels in the file are replaced, so a
  redacted guide's source images do not still contain the data.
- **Re-records a single step.** Guides rot when an application changes; refresh
  step 17 without touching the other forty.
- **Tells you which steps have rotted.** Press **Check** and it asks the running
  application whether the controls each step refers to still exist, and marks
  the ones that do not - so maintaining a guide is a few minutes rather than a
  re-recording.
- **Exports** to HTML (one portable file), PDF, or Markdown, rewritten as
  instructions: *Click Save* rather than *Clicked the Save button*.
- **Renders into your own SOP format.** Point it at your organisation's template
  and the output is their document - their headings, numbering, revision table
  and approval block - with the recording injected into the marked slots. The
  template file is only ever read. Markdown, HTML or **Word**: point it at a
  .docx and the recording is injected into that document, screenshots embedded.
  See `templates/corporate-sop.md` and `templates/corporate-sop.docx`.

## Install

Download `StepsRecorder-Setup-<version>.exe` and run it. Installs per-user, so
no administrator prompt, and nothing else is required — no .NET, no Node. It
runs on Windows 10 (1607 or later) and Windows 11, x64.

> **Windows will warn you the first time.** The binary is not code-signed yet,
> so SmartScreen shows "Windows protected your PC" — choose **More info** then
> **Run anyway**. Some endpoint protection may also object: a tool that hooks
> input, takes screenshots and writes them to disk looks, structurally, like a
> keylogger. That is a fair thing for antivirus to be suspicious of, which is
> why the source is here to audit.

Recordings go to `Documents\StepRecordings` by default, and nothing leaves the
machine — there is no account, no telemetry and no network use of any kind.

## Using it

1. **Set out** — press **Start recording** and say what you are making: a
   procedure (rendered into an SOP template), a training guide, or an evidence
   record (kept in the past tense, because it describes what was done). Name it,
   pick a template, and scope it to one application if you want everything else
   kept off the record.
2. Do the thing you are documenting. The window shrinks to a small floating
   strip so it is not in your way. `Ctrl+Shift+F9` pauses, `Ctrl+Shift+F10`
   stops, from wherever you are.
3. **Edit** — reword steps, drag to reorder them, add written steps for the
   instructions that are not clicks, exclude ones you want kept but not
   published, blur anything sensitive, re-record a step that came out wrong.
   Arrow keys move between steps, Ctrl+click and Shift+click select several,
   Delete removes them and Ctrl+Z puts them back.
4. **Export** — HTML, PDF or Markdown.

Recordings save continuously to `Documents\StepRecordings` (configurable). There
is no Save button because there is nothing to save: every step is on disk as it
is captured. Name a recording in the field at the top left; the app opens onto
your recent recordings so you can pick one up again.

Exports can carry your organisation's name, logo and a footer — set them in
Settings.

## Building from source

Requires the [.NET 10 SDK](https://dotnet.microsoft.com/download) and Node 20+.

```
cd ui
npm install
npm run build:capture     # publishes the C# capture engine
npm start                 # run in development
npm run dist              # build the installer into ../dist
```

## How it is put together

Two processes:

- **`capture/`** — a C# console application owning the Win32 hooks, screenshots
  and UI Automation. It speaks newline-delimited JSON over stdio.
- **`ui/`** — an Electron app that spawns it, renders steps as they arrive, and
  handles editing and export.

They are separate processes rather than a native addon: a low-level hook needs
its own message pump, and this avoids node-gyp and Electron ABI coupling
entirely. The protocol is documented in [docs/ipc-contract.md](docs/ipc-contract.md).

## Tests

```
node tests/export_test.js          # export rendering
node tests/session_test.js         # step merge and persistence
python tests/smoke.py              # engine protocol
python tests/scope_test.py         # window enumeration and scoping
cd tests/LogicTests && dotnet run  # redaction, wording, naming, scope rules
```

Those need no input. The remaining tests (`keyboard_test.py`,
`settings_test.py`, `e2e.py`, `rerecord_test.py`) drive synthetic mouse and
keyboard input, so they take over the machine while they run — do not run them
on a machine you are using.
