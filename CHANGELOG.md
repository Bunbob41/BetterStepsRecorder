# Changelog

Notable changes, newest first. The reasoning behind each decision lives in
[docs/ENGINEERING.md](docs/ENGINEERING.md); this is the short version.

## Unreleased

- Fixed: **the screenshots were one step behind the words.** Click through a
  row of tabs, or Options and then Settings, and each picture showed what the
  click had already done — the tab already switched, the menu already open.
  Everything about a step was worked out 60 to 260 milliseconds *after* the click
  had been delivered. The picture is now copied as the button goes **down**,
  before Windows has even passed the click to the program, so it cannot show
  anything the click did.
- **An open menu or dropdown appears in place in its window**, rather than
  being left out of the picture.
- **The recording strip never appears in a screenshot**, whether a step frames
  one window, a whole monitor or every screen. It used to show up in the last
  two.
- Fixed: **a recording could appear to stop by itself.** Any problem the
  capture engine reported — even one failed step — brought the editor back over
  what you were recording, showed a blocking error box and marked the recording
  stopped, while it was in fact still recording. Only a problem the recording
  cannot survive does that now; anything else is noted, and you are told
  afterwards.
- Full-screen programs — games, videos, slideshows — are photographed just after
  each click rather than at the instant of it. Copying a full-screen game's
  picture at that instant was slow enough to risk Windows switching the recorder
  off.
- Fixed: closing the app logged a misleading *write after end* error.
- Fixed: **tabs in older programs were named after the tab next to them** on a
  display scaled above 100%. In HYPACK's Settings, a click on *Tracklines* was
  recorded as *Charts* and one on *Planned Lines* as *3D Options and Levels*,
  while the picture and the arrow showed the right tab. Buttons, checkboxes and
  radio buttons were never affected.
- Fixed: **eight text boxes were white in a dark window.** The library search,
  both find-and-replace boxes and the five highlight-legend fields were being
  drawn in Windows' own colours instead of the app's. They match every other
  field now.
- **The step list can be dragged to the width you want.** Pull the line between
  the list and the screenshot; double-click it to go back to the default. The
  width is remembered. Folding the list away entirely still works and is
  unchanged. (Ported from a fork of this tree, co-authored by Cursor.)
- **A recording names itself.** Stop a recording you never named and it is
  called after what it recorded — *HYPACK Shell - 37 steps* — instead of the time
  it started. The name is the heading of an exported guide and the caption under
  every figure, so this is the difference between a guide titled *HYPACK Shell*
  and one titled *9/11/2026, 3:42:26 PM*. Type a name at any point and it is left
  alone.
- **Screenshots are sized for the page in LaTeX exports.** At most 1600 pixels
  wide — wider than the text line can print — which turns a fourteen-megabyte
  procedure into a few megabytes and keeps a free Overleaf project well inside
  its compile time. Your recording keeps its full-size screenshots.
- **A LaTeX export as one zip.** *Export → LaTeX — a zip for Overleaf* gives a
  single file holding the document and its screenshots. In Overleaf, *New
  Project → Upload Project* and it compiles as it is — no folder to drag in
  alongside it and no folder name to preserve. The export also checks that every
  picture the document asks for is really in what it hands you, because a
  missing one compiles to an empty box rather than an error.
- **A LaTeX export that stands on its own.** Alongside the fragment, Export now
  offers *LaTeX — a complete document*: the same procedure wrapped in a document
  that compiles by itself, with its own margins and packages, the recording's
  name as the title, and the screenshots pinned where they appear instead of
  floating. Upload it with its images folder and it builds — nothing to paste
  into, nothing to already have.
- **The LaTeX export tells you how to include it.** Its header now carries the
  one line that puts it into your document — `\input{your file}`, with the name
  it was saved as — and the message after exporting says it too. Uploading both
  files to Overleaf and finding nothing in the PDF, because nothing includes the
  fragment, was the step everyone was missing. Verified by exporting a
  thirty-seven step recording and compiling it in Overleaf.
- **The recording strip says when it can't see the program you're in.** A
  program started with *Run as administrator* can't be recorded by an ordinary
  one — Windows doesn't allow it — and a recording made that way used to miss
  every step without a word. Now the strip says *Can't see … running as
  administrator* while you're in it, and a note afterwards explains what was
  missed and what to do.
- Fixed: **a click on OK or Open often produced a step that said only
  "Clicked"** — no control, no window, no application. Those clicks close the
  dialog, and by the time the recorder looked, there was nothing left to
  describe. The two most important steps in a procedure were the two it failed
  hardest on.
- Fixed: **a step could be named after a control in the window the click
  opened** — a name for something you never touched, which is worse than no name
  at all, because the picture and the words disagree and only the words are
  wrong.

- **A recording keeps the parts your version does not understand.** Recordings
  get passed between machines, and those machines will not always be running
  the same version of this app. The details file is now written back with
  anything in it this version has never heard of left exactly as it was found,
  instead of dropped on the next edit. Nothing you can see changes; it is a
  promise about your recordings rather than a feature.

## 0.2.1

### Marking up

- **A drawn arrow can be aimed after it is drawn.** Select it and a dot appears
  on each end: drag the tail and the arrow swings around its point, which stays
  on the thing it is pointing at. Hold **Shift** to land on a whole angle. A
  box, a circle and a highlight get a dot at each corner, and dragging one
  resizes the mark. Until now the only shape a mark could have was the one the
  original drag gave it.
- **The right-click menu groups what it offers.** The four colours became one
  **Change colour** that opens beside itself, with the colour of each and a tick
  on the one in force; hiding, aiming and resetting the recorded click marker
  moved under **The click marker**. Eleven lines became six, and the two arrows
  in that menu - the one you drew and the one the recorder puts on every click -
  are no longer five lines apart under similar words.
- **Right-clicking a mark takes hold of it**, so the menu, the strip and the
  dots are always about the same mark.
- A selected arrow no longer gets a dashed box around it — the dots on its ends
  say it is selected, and a rectangle around a diagonal line said nothing.
- The mark's strip drops to the bottom of the picture when it would otherwise
  cover the mark it is about — which, for anything marked near the top of a
  screenshot, it did.
- A highlight can be recoloured from the menu now, from the highlighter's own
  five colours. The strip has always allowed it; the menu used to refuse.

### Fixes

- Fixed: **on a display scaled above 100%, a quarter of every screenshot was
  blank and the click marker was in the wrong place.** An application that does
  not declare itself DPI aware draws at 96 dpi and lets the desktop scale it up;
  the capture asked for a picture the size of the window on screen and got the
  smaller, unscaled one in the corner of it. The marker, being a percentage of
  the picture, drifted by a quarter of its distance from the top-left — a few
  pixels near the corner, a hundred at the far side, and nothing at all at 100%,
  which is why it seemed to come and go.
- Fixed: **a window that drew its title bar and nothing else** — a black
  rectangle where the content should be — was kept instead of falling back to
  copying the screen. The test only rejected a picture that was *entirely*
  black.
- Fixed: **the application caption appeared on steps for no reason.** It named
  the application but was printed whenever the window title changed, so opening
  and closing a dialog re-announced the program you had never left.
- Fixed: **"No steps yet." wrapped itself down the folded steps column**, one
  letter at a time, on a recording with nothing in it — which is the first
  thing anybody sees who folds the column before recording anything.

## 0.2.0

### Photographs

- **Photographs from a camera can be steps.** Not everything in a procedure
  happens on a screen — a cable in the right socket, a switch in the right
  position, a serial number on the underside of a unit. Add them with **+ Add**,
  by dragging them onto the window, or by dropping them into the recording's own
  folder, where they are picked up the next time you open it. That last one is
  for after a job, when thirty pictures come off a camera at once.
- Each photo is copied in at 2000 pixels on its long edge as JPEG — a sensible
  size for a page, small enough that a recording full of them can still be
  emailed. **The file you dropped in is moved into an `originals` folder inside
  the recording, not deleted**: the recording keeps a smaller copy, and this
  tool is not going to be the reason your full-sized photograph stops existing.
- iPhone photos (HEIC) cannot be read — Windows itself cannot open them without
  an extra codec. You are told which file, by name, rather than finding one
  missing later.
- A photo has no click, so **right-click it and choose *Put a marker here*** if
  you want to point at something. Then drag it or turn it like any other marker.

### Marking up

- **Marks can be changed after you draw them.** A box, ring, arrow, highlight or
  label used to be painted into the screenshot the instant it was made, so
  "delete this arrow" had no answer except undo — in order, taking every later
  mark with it. They are held as data now: click one to take hold of it, drag it
  where it should have gone, change its colour, and delete just that one.
- **A Label tool.** Click where the words should start, type them, press Enter.
  The box appears on the picture at that spot, in roughly the size and colour it
  will end up. Three sizes; double-click a label to retype it, and clearing the
  words removes it.
- **Colours**: red, blue, green, amber or black, for a mark you have selected or
  for the next one you draw (right-click the Box, Circle, Arrow or Label tool).
  The highlighter keeps its own colours, which mean something in the key at the
  front of a guide.
- Blur is unchanged and always will be: it destroys the pixels rather than
  covering them, because a guide whose screenshots still contain the customer
  name under a grey box is not redacted.
- Marks are laid over the picture in the app, in HTML and in PDF, and drawn into
  it for Word and LaTeX, which embed an image and cannot lay anything on top.
  Crop a marked screenshot and the marks move with it.
- Fixed: **with a tool armed, right-clicking drew a mark** as well as opening the
  menu — and the menu was usually being reached for in order to get rid of one.
- Fixed: **the controls for a selected mark could not be used.** The strip floats
  over the picture, and pressing anything on it was also pressing the picture
  underneath, which deselected the mark and took the button away before the
  click landed. The size dropdown could never be opened at all.

### The click marker

- **The arrow marker can be turned.** Drag the small handle at its tail and the
  arrow swings around the point it marks — it used to be stuck on one of four
  diagonals. Right-click the screenshot to hand it back to choosing its own
  direction.

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
- Fixed: **a turned arrow snapped back to a diagonal while you dragged it**, and
  righted itself only when you let go.
- Fixed: **moving an arrow re-aimed it.** An arrow nobody has turned works out
  its own direction, and that answer changed as it crossed an invisible line
  28% in from the top or the left. Moving a marker is not asking for it to be
  re-aimed; the direction it has when you pick it up is the one it keeps.

### Exporting

- **LaTeX export**, for teams whose manuals live in Overleaf. It produces a
  *fragment* — a `\subsection`, a numbered list and the screenshots between the
  steps — to paste into a document that already has a preamble and a house
  style. The screenshots go in a folder beside it, and the file's own header
  says what it assumes (`graphicx`) and how to pin the figures if they drift.
- Everything that came off your screen is escaped on the way out: a backslash in
  a file path is a command to LaTeX, and left alone it breaks the build or
  quietly does something nobody asked for.

### The window

- **The steps column folds away** — Ctrl+B, or the button in its header. The
  picture gets the space, and a narrow rail keeps the step count and the way
  back in view. Arrow Up and Down still move between steps while it is folded.
- **The drawing tools are icons**, and eleven buttons have left the window
  entirely. **Delete step** and **Re-record step** are on a step's right-click
  menu, where Delete already was. **+ Note**, **+ Section** and **+ Photo** are
  one **+ Add**. **Recordings**, **Open…** and **Check** are one **Recordings**
  menu — Check is unchanged, it just no longer occupies the window all day for
  something done once in a blue moon.

### Fixes

- Fixed: **undoing a crop left the marker and any marks where the crop had put
  them.** Cropping moves them to match the smaller picture; undo brought the
  picture back and left them moved, so they pointed at the wrong things
  afterwards.
- Fixed: **opening a recording from a folder was not the same as opening it
  from the library** — photographs dropped in its folder were not picked up,
  and a damaged recording was opened rather than refused.
- Fixed: a cropped photograph kept its old recorded size, which is what marks
  on it are measured against.
- Fixed: a failed *Check this recording* left "Checking…" in the status line.

- Fixed: **the step's description box stopped showing anything** in builds 99 to
  104, because the new Label tool and the description box were both captured
  under the same name internally.
- A recording that cannot be opened now says which of the two reasons it is:
  made by a newer version, or damaged.
- Installers are named for the build they came from —
  `StepsRecorder-Setup-0.1.2-build109.exe` — so two builds of the same version
  can be told apart. Previously every build overwrote the same file, which is
  how a tested build and three newer ones became indistinguishable.

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
