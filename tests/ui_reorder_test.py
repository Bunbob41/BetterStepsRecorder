"""Exclusion and drag-to-reorder, in a clean session."""
import sys, os, time, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui_drive import *

TARGET = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "KbdTarget", "bin", "Debug", "net10.0-windows", "kbdtarget.exe")
app = find("Steps Recorder"); assert app, "app not running"
before = sessions()

tgt = subprocess.Popen([TARGET], stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
rects = {}
deadline = time.time() + 15
while time.time() < deadline and len(rects) < 2:
    line = tgt.stdout.readline()
    if line.startswith("RECT"):
        _, n, x, y, w, h = line.split(); rects[n] = (int(x), int(y), int(w), int(h))
target = find("KBD Test Window"); assert target

pas = fai = 0
def chk(n, c):
    global pas, fai
    if c: pas += 1; print("  PASS " + n)
    else: fai += 1; print("  FAIL " + n)

focus(app)
for _ in range(3):
    click_in(app, *BTN["start"]); time.sleep(1.5)
    new = sessions() - before
    if new: break
assert new
sess = sorted(new)[0]
meta = os.path.join(sess, "session.json")
def steps(): return json.load(open(meta, encoding="utf-8"))["steps"]

# three recorded steps
focus(target)
for dy in (0, 6, 12):
    x, y, w, h = rects["plain"]
    click_at(x + w // 2, y + h // 2 + dy)
chord(0x11, 0x10, 0x79)          # stop
time.sleep(1.0)
close_window(target)             # clean close, so no ghost covers the app
tgt.wait(timeout=10)
time.sleep(0.8)

recorded = len(steps())
print(f"recorded {recorded} steps")
chk("three clicks were recorded", recorded == 3)

focus(app)

# --- exclusion ---
print("\nexclusion:")
click_in(app, 200, 270, settle=1.0)          # select step 2
click_in(app, 855, 200, settle=1.2)          # Exclude from export
s = steps()
chk("the selected step is excluded", s[1].get("excluded") is True)
chk("other steps are untouched",
    not s[0].get("excluded") and not s[2].get("excluded"))

click_in(app, 855, 200, settle=1.2)          # untick
chk("exclusion can be turned off", steps()[1].get("excluded") is False)
click_in(app, 855, 200, settle=1.2)          # back on for the export check

# --- reorder ---
print("\nreorder:")
order_before = [x["id"] for x in steps()]
drag_in(app, 200, 340, 200, 185, steps=20)   # drag row 3 above row 1
time.sleep(1.5)
order_after = [x["id"] for x in steps()]
chk(f"order changed", order_after != order_before)
chk("nothing lost or duplicated", sorted(order_after) == sorted(order_before))
chk("the dragged step is now first", order_after[0] == order_before[2])

print(f"\n{pas} passed, {fai} failed")
print("session:", sess)
