# Changelog

Notable changes, newest first. The reasoning behind each decision lives in
[docs/ENGINEERING.md](docs/ENGINEERING.md); this is the short version.

## Unreleased

- Fixed: **the click marker could not be dragged.** It has never worked with a
  mouse — the marker was drawn with `pointer-events: none` as an inline style,
  so every click went through it to the screenshot underneath. Dragging the
  screenshot out of the page is also switched off, which was the other half of
  what that felt like.

- **The click marker can be turned off.** Right-click a screenshot to hide it
  on that step, or turn it off everywhere in Settings → Marking up — for when
  you would rather point things out yourself with the Arrow and Circle tools.
  Hidden markers stay hidden in every export, not just on screen.

- Fixed: **a click marker you had dragged drifted when you cropped that step.**
  A recorded marker survives cropping because the step's frame is cut with the
  picture; a marker you moved by hand is a position on the picture itself, and
  nothing was moving it. It is now cut with the picture too, and removed
  outright if the crop cuts it away.
- The warning before a crop now asks about the marker you can see rather than
  the recorded click, which are not the same thing once you have moved one.

## 0.1.2

- Fixed: **a recording whose details file could not be read opened as an empty
  recording** — and because there is no Save button, the next edit wrote that
  emptiness over the real file and orphaned every screenshot in the folder. A
  single stray byte was enough. It is now listed, dimmed, explained and left
  strictly alone, and the app refuses to write to it at all.
- Fixed: such a recording also **vanished from the library**, which looks
  exactly like one that has been lost. It is listed and marked instead.
- Fixed: **the click marker drifted upwards** in the app's own preview on any
  screenshot taller than the pane — most of them on a tall window. Exports were
  never affected, which is why it went unnoticed.
- Fixed: a broken diagram in the field guide rendered on GitHub as an error box
  instead of a picture. Every diagram in the documentation is now checked.
- The README and field guide have screenshots.

## 0.1.1

Everything here was found by using 0.1.0 rather than by reading it: the
shortcut that would not rebind, the settings page that could not be read, and
the guide that printed the same picture twice.

- **Settings is four tabs** — Recording, Screenshots, Marking up, Exports —
  rather than thirteen controls in one column with the image settings
  interleaved with the annotation ones. No scrolling, and it reopens on the tab
  you used last. The *Open Settings* link on the screenshot-size notice opens
  on Screenshots, where the fix is.
- Fixed: three descriptions in Settings were clipped mid-word and the dialog
  scrolled sideways — they were inheriting a style written for the one-line
  keycap strip in the footer, which never wraps.
- Fixed: the two checkboxes in Settings had no styling at all, so the box, its
  label and its explanation were three loose pieces of text.
- **Identical consecutive screenshots are stored once.** A typed step and the
  click that follows it are captured at the same instant and produced two
  copies of the same picture — the same image twice in a guide, and twice the
  disk for most step pairs. Editing one of them still only affects that step.
- **The pause shortcut now starts a recording** when none is running — one key
  for start, pause and resume. It records only the application that was in
  front when you pressed it, which is narrower than the Start button's default
  of everything on screen, and it says which one it chose. Previously both
  shortcuts did nothing at all unless a recording was already running, which
  looks exactly like a shortcut that is broken.
- Fixed: pressing stop with nothing recording was silent; it now says so.
- Fixed: **the global hotkeys could not be rebound.** A registered shortcut is
  taken at the operating system ahead of every window, so the combination you
  were replacing was swallowed by the very shortcut you were replacing — the
  key press never reached the dialog and nothing changed. They are now released
  while the dialog is listening. Trying to give pause the chord stop had used
  to stop the recording instead.
- Fixed: a key that cannot be part of a shortcut was treated exactly like one
  that had not arrived yet, so the dialog waited in silence. It now says which
  key it was and keeps listening. Arrow keys are accepted.
- Fixed: binding a shortcut to Page Up, Page Down or Space did not suppress it
  during recording — the engine spells those keys differently, so it was told
  to ignore a combination it never produced, and pressing stop was recorded as
  the last step of the guide.

## 0.1.0 — first release

The first tagged build.

### Added just before the tag

- **A way back to your recordings.** A **Recordings** button in the toolbar
  returns the right-hand pane to the library, with whatever you searched for
  still in the box and still run — opening a search result used to throw the
  results away with no way back. The recording you were in is marked, stays
  open, and the step you were on stays selected, so clicking it returns you.
- Fixed: starting a recording while a step was open left the previous
  recording's screenshot in the pane, under an empty step list.
- Fixed: a multiple selection was carried into the next recording opened, so
  the button offered to delete steps that were not there.
- **Redo.** Ctrl+Y, or Ctrl+Shift+Z. Undo and redo are now the same traversal
  run in opposite directions, so anything that can be undone can be put back —
  a blur, a crop, a bulk delete, a replace-all.
- **The click marker can be dragged** to where it should have been. A typed
  step is marked at the centre of the box you typed into, because that is all
  the recorder can know; on a wide field that is not where the words went.
  Right-click the screenshot to put it back where it was recorded.
- **Right-click menus** on a step and on a screenshot: undo and redo, adding a
  note or a heading, leaving a step out, deleting, and resetting the marker.
- **Search every recording**, not just the open one, from the screen the app
  opens on. Searches step text, notes, headings and the recording's name; a
  result opens that recording on the matching step.
- **Recordings carry a format version.** One made by a newer version of the app
  is listed but not opened, with an explanation — opening it would rewrite it in
  the older shape and discard what that version does not understand.
- **The app says it saves as you go**, and where. It always did save
  continuously; the tick only appeared while recording, so editing an existing
  recording gave no sign of it.
- **Disk use is visible**: the landing screen shows the recordings folder, how
  many recordings it holds and how much room they take, and every recording
  shows its own size. One recording of a game can be most of an archive.
- **Recordings are labelled with the application they are about**, named the way
  Windows names it — "Google Chrome", not `chrome.exe`. Previously it took the
  first step's application, which is nearly always the taskbar, so recordings
  listed as `explorer.exe`.
- Fixed: a library card counted section headings as steps, so it promised more
  work than the recording held.

### Everything else

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

- **Applications built on WinUI content islands cannot be named.** Windows 11's
  Paint is the clearest example: every point in it reports no control, so steps
  read *"Clicked in 'Untitled - Paint'"* rather than naming a button. Classic
  Windows programs and dialogs are unaffected. The screenshot, the click marker
  and the step itself are all still correct.

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
