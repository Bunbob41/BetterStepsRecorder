"""The fixes from the second review: trash retention, batch undo, and the
compact strip surviving an engine crash."""
import sys, os, time, json, subprocess, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui_drive import *

TARGET = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "KbdTarget", "bin", "Debug", "net10.0-windows", "kbdtarget.exe")
app = find("Steps Recorder"); assert app
assert_layout(app)
before = sessions()

pas = fai = 0
def chk(n, c):
    global pas, fai
    if c: pas += 1; print("  PASS " + n)
    else: fai += 1; print("  FAIL " + n)

tgt = subprocess.Popen([TARGET], stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
rects = {}
deadline = time.time() + 15
while time.time() < deadline and len(rects) < 2:
    line = tgt.stdout.readline()
    if line.startswith("RECT"):
        _, n, x, y, w, h = line.split(); rects[n] = (int(x), int(y), int(w), int(h))
target = find("KBD Test Window"); assert target

focus(app)
for _ in range(3):
    click_in(app, *BTN["start"]); time.sleep(2.0)
    new = sessions() - before
    if new: break
assert new
sess = sorted(new)[0]
meta = os.path.join(sess, "session.json")
def steps(): return json.load(open(meta, encoding="utf-8"))["steps"]
trash = os.path.join(sess, ".trash")

focus(target)
x, y, w, h = rects["plain"]
for dy in (0, 6, 12, 18):
    click_at(x + w // 2, y + h // 2 + dy)
chord(0x11, 0x10, 0x79)
time.sleep(1.5)
close_window(target); tgt.wait(timeout=10); time.sleep(0.8)
focus(app)
print(f"recorded {len(steps())} steps")

print("\nbatch delete is one undoable action:")
n0 = len(steps())
click_in(app, 200, row_y(0), settle=0.7)
u32.keybd_event(0x10, 0, 0, 0)                     # Shift
click_in(app, 200, row_y(2), settle=0.7)           # shift-click step 3
u32.keybd_event(0x10, 0, 2, 0)
time.sleep(0.4)
u32.keybd_event(0x2E, 0, 0, 0); time.sleep(0.05); u32.keybd_event(0x2E, 0, 2, 0)
time.sleep(1.8)
n1 = len(steps())
chk(f"three steps removed at once ({n0} -> {n1})", n1 == n0 - 3)
chk("their originals are stashed while undo is possible",
    os.path.isdir(trash) and len(os.listdir(trash)) >= 3)

chord(0x11, 0x5A)                                   # a single Ctrl+Z
time.sleep(2.0)
n2 = len(steps())
chk(f"ONE Ctrl+Z restored all three ({n1} -> {n2})", n2 == n0)
shots = all(os.path.exists(os.path.join(sess, s["screenshot"]))
            for s in steps() if s.get("screenshot"))
chk("their screenshots came back", shots)

print("\ntrash does not outlive the session:")
click_in(app, 200, row_y(0), settle=0.8)
click_in(app, *DETAIL["blur"], settle=0.6)
drag_in(app, 520, 340, 700, 400)
time.sleep(1.5)
chk("blurring stashes the original", os.path.isdir(trash) and len(os.listdir(trash)) > 0)

# Starting another recording must clear the previous session's originals.
before2 = sessions()
for _ in range(3):
    click_in(app, *BTN["start"], settle=2.5)
    if sessions() - before2: break
chk("a second recording actually started", bool(sessions() - before2))
time.sleep(1.0)
chord(0x11, 0x10, 0x79)
time.sleep(1.5)
left = os.listdir(trash) if os.path.isdir(trash) else []
chk(f"the previous session's trash is gone ({len(left)} files left)", not left)
chk("the redacted screenshots themselves remain",
    all(os.path.exists(os.path.join(sess, s["screenshot"]))
        for s in steps() if s.get("screenshot")))

print(f"\n{pas} passed, {fai} failed")
