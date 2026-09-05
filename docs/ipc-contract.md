# IPC Contract — Electron UI <-> C# Capture Sidecar

Transport: child process stdio. One JSON object per line (NDJSON), UTF-8.
UI -> sidecar on stdin. Sidecar -> UI on stdout. stderr is logs only, never parsed.

Every message: { "v": 1, "type": "<name>", "id": "<uuid>", ...payload }
`id` echoes back on the matching response so requests can be correlated.

## UI -> Sidecar (commands)

start        { "sessionDir": "...", "ignorePids": [1234],
               "recordKeyboard": true }                begin hooking input
             recordKeyboard: when false the keyboard hook is not installed at
             all, rather than installed and ignored.
             allowPids: when non-empty, ONLY these processes are recorded.
             Exclusion always wins: ignorePids is checked first, so a scope
             choice can never drag the recorder's own windows back in.
             hotkeys: chord labels ("Ctrl+Shift+F9") the UI has claimed
             globally, so pressing stop is not itself the final step.
             imageFrame: "window" (default), "monitor" or "screen" - what each
             screenshot frames. Window crops the noise; the wider options matter
             when context around the click is the point, or when the click has
             no window at all (desktop, taskbar, tray).
             ignorePids: windows owned by these processes are never recorded.
             The UI passes its own pid so its Stop click is not captured.
armOnce      { "replaceId": "<step id>" }              capture exactly one event,
             then park in paused. The resulting step carries replaces=<id>
             so the UI can swap it in without disturbing the other steps.
pause        {}                                        stop recording, keep hooks
resume       {}                                        resume recording
stop         {}                                        unhook, flush, exit cleanly
verify       { "items": [ { id, process, windowTitle, automationId,
                            name, controlType } ] }
             asks whether those controls still exist in what is running now.
             Answered asynchronously with a `verified` message; the walk is
             done on its own thread so it cannot stall stop or pause.
listWindows  { "excludePids": [1234] }                 enumerate top-level
             windows for the scope picker. Answered with a `windows` message
             carrying { hwnd, pid, title, process }. Electron cannot see other
             applications' windows, so the engine answers this.
ping         {}                                        health check

## Sidecar -> UI (events)

ready        { "pid": 1234, "dpiAware": true }         emitted once on startup
step         { see below }                             one recorded user action
error        { "code": "HOOK_FAILED", "message": "" }
pong         {}
windows      { "items": [ { hwnd, pid, title, process } ] }
verified     { "items": [ { id, status, matchedBy, window } ] }
             status: match | missing | appNotRunning | noTarget | inconclusive
log          { "level": "info|warn", "message": "" }

## step payload

{
  "v": 1, "type": "step", "id": "<uuid>", "seq": 7,
  "ts": "2026-09-03T14:22:31.115Z",
  "action": "leftClick" | "rightClick" | "doubleClick" | "drag"
          | "keyText"   typing, aggregated per focused field
          | "keyPress"  a named key or a modifier chord
          | "password"  typing occurred in a masked field,
  "point":  { "x": 412, "y": 308 },              // virtual-desktop px
  "endPoint": { "x": 980, "y": 512 },            // drag only
  "monitor": { "index": 0, "scale": 1.5 },       // DPI scale of source monitor
  "window": {
    "title": "Untitled - Notepad",
    "process": "notepad.exe",
    "rect": { "x": 100, "y": 80, "w": 1200, "h": 800 }
  },
  "target": {                                     // UI Automation, best-effort
    "name": "Save", "controlType": "Button", "automationId": "btnSave"
  },
  "frame": { "x": 100, "y": 80, "w": 1200, "h": 800 },  // region captured
  "screenshot": "steps/0007.png",                 // relative to sessionDir
  "typed": "ACME Corp",                           // keyText only, redacted
  "text": "Clicked the \"Save\" button in Notepad"  // generated description
}

## Keyboard rules

- Keystrokes are aggregated per focused control and emitted as one step when
  focus moves, a named key is pressed, or typing goes quiet for 1.5s.
- A "password" step carries no `typed` field and says nothing about length.
  Classic password controls are detected structurally in the hook (ES_PASSWORD)
  so those characters are never even translated; UI Automation covers WPF,
  WinUI and browser inputs on the worker.
- `typed` is passed through a redactor that masks Luhn-valid card numbers and
  SSN-shaped strings even in ordinary fields.
- Single-shot re-recording (armOnce) ignores keys: it exists to refresh one
  click, and a stray keystroke consuming the arm would make it unusable.

## Rules

- Sidecar owns screenshot files; it writes the PNG BEFORE emitting the step.
- `target` may be null. UI must render from `point` alone when it is.
- Coordinates are ALWAYS physical pixels on the virtual desktop, never scaled.
  The UI divides by monitor.scale only for display.
- `frame` is the region actually captured, which equals the window rect only
  when framing by window. The click indicator is positioned against `frame`,
  never against `window.rect`, or it lands in the wrong part of a monitor- or
  screen-framed image.
- Unknown `type` values are ignored, not fatal. Forward compatible.
- Sidecar exits 0 on `stop`, non-zero on unrecoverable hook failure.


## Markup and export (UI-side, not the engine)

Blur is destructive. The renderer pixelates then blurs the selected region on a
canvas and the main process overwrites the screenshot file. An overlay would
leave the original pixels in the session folder, and a redacted guide whose
source images still contain the data is worse than no redaction at all. The
step is stamped `redacted: true`.

Editing loads the screenshot as a data URL rather than over bsr://, because a
canvas painted from another scheme is tainted and cannot be read back.

Export rewrites descriptions into the imperative ("Click Save" rather than
"Clicked the Save button"). The engine records what happened; a procedure tells
the reader what to do. Wording the user edited is emitted verbatim.


## Steps the engine never produces

The UI adds two things the capture engine knows nothing about:

- **Notes** (`action: "note"`) are written steps with no screenshot. Every
  procedure has instructions that are not clicks - wait for the overnight batch,
  escalate above a threshold - and a recording alone can only describe what a
  mouse did. They are authored, so export emits them verbatim and they carry no
  step number.
- **`excluded: true`** suppresses a step from every export without destroying
  it, and its screenshot is not copied alongside a Markdown export either.


## Threading: hooks and the message pump

A low-level hook's callbacks are dispatched to the message queue of the thread
that INSTALLED it, and that thread must pump messages. The mouse hook is
installed on the main thread, which runs the GetMessage loop. The keyboard hook
is installed on demand, so its installation is POSTED to that same thread
(WM_APP+1 / WM_APP+2) rather than performed on the stdin reader.

Installing it directly from the stdin thread is not an error and reports
success - the hook simply never fires. That is exactly what happened, and it is
why keyboard capture appeared to do nothing while every log line claimed it was
on.


## Templates

An organisation's own SOP format can be rendered instead of ours. The template
file is read and never written: it is a spine, and anything the engine does not
recognise is left exactly as found rather than dropped, so a mistyped hook shows
up as an untouched comment and is reported rather than silently removed.

    <!-- PARSER_HOOK: INJECT_TITLE -->        one value, replaced in place
    <!-- PARSER_HOOK: START_DYNAMIC_STEPS_LOOP -->
    **{{number_prefix}}{{description}}**      the row, repeated per step
    {{image_block}}
    <!-- PARSER_HOOK: END_DYNAMIC_STEPS_LOOP -->

HTML comments rather than bare placeholders at the top level, so the template
stays a valid readable document in Word or a wiki before anything is injected.
The loop body must contain {{placeholders}} or the engine falls back to a
built-in row - which is a warning sign, since the point of the feature is that
the organisation controls how a step looks.

INJECT_REDACTION_SUMMARY reports what actually happened to THIS recording -
password steps, masked values, blurred screenshots, excluded steps - rather than
asserting a blanket guarantee. A compliance section that claims more than the
tool did is worse than one that claims nothing.


### Word templates

A .docx template uses ordinary typed placeholders, because Word cannot hold an
HTML comment:

    {{title}}                              a value
    {{FOR s IN steps}} ... {{END-FOR s}}   a repeated block
    {{IMAGE shot($s)}}                     that step's screenshot, embedded

Word habitually splits a typed placeholder across several runs - a spell-check
mark is enough - so the runs must be normalised before matching. That is the
whole reason this path uses docx-templates rather than string replacement on
document.xml, which is what makes naive .docx filling fail on real templates
that people have edited.

Screenshots are embedded into the package, sized from their intrinsic
dimensions so they are not stretched. A screenshot that has gone missing is
reported and left out rather than aborting the export.


## Staleness

A guide is written once and then rots: a vendor moves a dialog and a forty-step
procedure is quietly wrong until somebody follows it. Every step already carries
the automation id, control type and name of what was clicked, so the running
application can be asked whether those controls are still there.

The engine walks each window's tree ONCE and indexes it, rather than searching
per step. A descendant search across a large application takes seconds, so forty
searches would look like a hang; one indexed walk answers the whole guide.

The statuses are deliberately distinct:

- `match` - the control is still there. Reported with what matched it, since an
  automation id is much stronger evidence than a name.
- `missing` - the application is running and the control is not in it. This is
  the one worth acting on.
- `appNotRunning` - nothing can be said. NOT the same as "fine".
- `inconclusive` - the walk hit its element cap, so absence cannot be proven.
- `noTarget` - the step never captured anything identifying.

Results are stamped with the time they were taken, because "this control was
gone when checked" is a different claim from "this step is wrong".
