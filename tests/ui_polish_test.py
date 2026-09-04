"""Compact recording mode, undo, multi-select and the library view."""
import sys, os, time, json, subprocess
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

print("compact recording mode:")
full = frame(app)
focus(app)
for _ in range(3):
    click_in(app, *BTN["start"]); time.sleep(2.0)
    new = sessions() - before
    if new: break
assert new, "start failed"
sess = sorted(new)[0]
meta = os.path.join(sess, "session.json")
def data(): return json.load(open(meta, encoding="utf-8"))
def steps(): return data()["steps"]

small = frame(app)
chk(f"the window shrank while recording ({full.right-full.left} -> {small.right-small.left} wide)",
    (small.right - small.left) < (full.right - full.left) / 2)
chk("it moved out of the way, to the top right",
    small.left > 1400 and small.top < 200)
chk("a recording gets a default name", bool(data().get("name")))

# record three steps
focus(target)
x, y, w, h = rects["plain"]
for dy in (0, 6, 12):
    click_at(x + w // 2, y + h // 2 + dy)
chk("clicks are recorded while compact", len(steps()) == 3)

chord(0x11, 0x10, 0x79)                    # stop
time.sleep(1.5)
restored = frame(app)
# setBounds round-trips through logical pixels, so at 125% scaling the width
# can come back a pixel or two out. Restored, not pixel-identical, is the
# honest requirement.
drift = abs((restored.right - restored.left) - (full.right - full.left))
chk(f"the window returns to its full size when recording stops (drift {drift}px)",
    drift <= 4)

close_window(target); tgt.wait(timeout=10); time.sleep(0.8)
focus(app)

print("\nmulti-select and undo:")
ids_before = [s["id"] for s in steps()]
click_in(app, 200, row_y(0), settle=0.7)                  # select step 1
u32.keybd_event(0x11, 0, 0, 0)                            # Ctrl down
click_in(app, 200, row_y(1), settle=0.7)                  # ctrl-click step 2
u32.keybd_event(0x11, 0, 2, 0)                            # Ctrl up
time.sleep(0.4)
u32.keybd_event(0x2E, 0, 0, 0); time.sleep(0.05)          # Delete
u32.keybd_event(0x2E, 0, 2, 0)
time.sleep(1.8)
after_delete = [s["id"] for s in steps()]
chk(f"Delete removed the multi-selection ({len(ids_before)} -> {len(after_delete)})",
    len(after_delete) == len(ids_before) - 2)

chord(0x11, 0x5A)                                          # Ctrl+Z
time.sleep(1.5)
chord(0x11, 0x5A)
time.sleep(1.5)
after_undo = [s["id"] for s in steps()]
chk(f"undo restored both steps ({len(after_undo)})", len(after_undo) == len(ids_before))
chk("undo put them back in the original order", after_undo == ids_before)
shots_ok = all(os.path.exists(os.path.join(sess, s["screenshot"]))
               for s in steps() if s.get("screenshot"))
chk("undo restored the screenshots too", shots_ok)

print(f"\n{pas} passed, {fai} failed")
print("session:", sess)
