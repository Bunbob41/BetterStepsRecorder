# Changelog

Notable changes, newest first. The reasoning behind each decision lives in
[docs/ENGINEERING.md](docs/ENGINEERING.md); this is the short version.

## Unreleased

- **Search every recording**, not just the open one, from the screen the app
  opens on. Searches step text, notes, headings and the recording's name; a
  result opens that recording on the matching step.
- Fixed: a library card counted section headings as steps, so it promised more
  work than the recording held.

## 0.1.0 — first release

The first tagged build. Everything below already worked before this tag; what
the tag adds is a version somebody can name when they report a problem.

### Recording

- Correct on mixed-DPI multi-monitor setups, and on GPU-composited applications
  (Chrome, Electron, VS Code) that defeat the usual screenshot approach — the
  window is asked to draw itself rather than copied off the screen.
- Steps are named from UI Automation, so a step reads *Clicked the "Save" button
  in "Billing"* rather than *Clicked at 412,308*.
- Typing is grouped per field, not per keystroke. Password fields record only
  that a password was entered; card and national-insurance shapes are masked
  even in ordinary fields. Keys sent to an application rather than into a field
  are counted, not transcribed — *Pressed W, A, S, D (39 times)*.
- Scoping to one application means one application: out of scope, nothing is
  captured, nothing is buffered, and the recorder does not even ask that program
  what kind of field is focused.
- Each shot is framed by the window, the monitor, or every display, as you
  choose. The recorder never appears in its own screenshots when framing by
  window.

### Editing

- Reword, reorder, delete, and exclude steps; add written steps for the
  instructions that are not clicks.
- **Section headings** group a long procedure into the phases it actually has.
  The app offers one wherever the recording changed application.
- **Find and replace** across every step, note and heading, as one undoable
  action.
- **Mark up a screenshot** — box, circle, arrow, and a highlighter with five
  colours and an optional key explaining what each means.
- **Crop** a screenshot to the part that matters, without moving the click
  marker off what it points at.
- **Blur** destructively: the pixels in the file are replaced, so a redacted
  guide's source images do not still contain the data.
- **Re-record one step** when an application changes, and **Check** which steps
  refer to controls that no longer exist.

### Exporting

- HTML (one portable file), PDF, Markdown, Word, or your own SOP template.
- Rewritten as instructions — *Click Save* rather than *Clicked the Save button*
  — unless the recording is an evidence record, which stays in the past tense.
- A template is read and never written; anything unrecognised in it is left
  exactly as found and reported.
- Screenshots too large to embed are re-encoded for the document only. The
  recording itself is never altered.

### Known limits in this release

- **Not code-signed.** Windows SmartScreen will warn on first run, and endpoint
  protection may object to a binary that hooks input and takes screenshots.
  See the README.
- The window does not remember where you put it between sessions.
- Export shows no progress; a very large recording takes a while with only
  "Exporting…" on screen.
- The Markdown export copies original screenshots rather than re-encoding them,
  so its folder is as large as the recording.
- Monitor and full-screen framing still capture the recording strip.
- A screenshot shared by two steps carries only the first step's marker in Word.
