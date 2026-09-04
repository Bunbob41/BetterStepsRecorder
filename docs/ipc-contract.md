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
             ignorePids: windows owned by these processes are never recorded.
             The UI passes its own pid so its Stop click is not captured.
armOnce      { "replaceId": "<step id>" }              capture exactly one event,
             then park in paused. The resulting step carries replaces=<id>
             so the UI can swap it in without disturbing the other steps.
pause        {}                                        stop recording, keep hooks
resume       {}                                        resume recording
stop         {}                                        unhook, flush, exit cleanly
ping         {}                                        health check

## Sidecar -> UI (events)

ready        { "pid": 1234, "dpiAware": true }         emitted once on startup
step         { see below }                             one recorded user action
error        { "code": "HOOK_FAILED", "message": "" }
pong         {}
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
