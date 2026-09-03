# IPC Contract — Electron UI <-> C# Capture Sidecar

Transport: child process stdio. One JSON object per line (NDJSON), UTF-8.
UI -> sidecar on stdin. Sidecar -> UI on stdout. stderr is logs only, never parsed.

Every message: { "v": 1, "type": "<name>", "id": "<uuid>", ...payload }
`id` echoes back on the matching response so requests can be correlated.

## UI -> Sidecar (commands)

start        { "sessionDir": "C:/...\session-123" }  begin hooking input
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
  "action": "leftClick" | "rightClick" | "doubleClick" | "drag" | "keyText",
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
  "text": "Clicked the \"Save\" button in Notepad"  // generated description
}

## Rules

- Sidecar owns screenshot files; it writes the PNG BEFORE emitting the step.
- `target` may be null. UI must render from `point` alone when it is.
- Coordinates are ALWAYS physical pixels on the virtual desktop, never scaled.
  The UI divides by monitor.scale only for display.
- Unknown `type` values are ignored, not fatal. Forward compatible.
- Sidecar exits 0 on `stop`, non-zero on unrecoverable hook failure.
