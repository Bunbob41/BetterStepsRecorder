"""Notes, blur, exclusion and drag-to-reorder, driven through the real UI."""
import sys, os, time, json, hashlib, glob
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui_drive import *

app = find("Steps Recorder"); assert app, "app not running"
sess = sorted(sessions())[-1]
meta = os.path.join(sess, "session.json")
def steps(): return json.load(open(meta, encoding="utf-8"))["steps"]
def sha(p): return hashlib.sha256(open(p, "rb").read()).hexdigest()[:12]

pas = fai = 0
def chk(n, c):
    global pas, fai
    if c: pas += 1; print("  PASS " + n)
    else: fai += 1; print("  FAIL " + n)

print(f"session: {os.path.basename(sess)}, {len(steps())} steps")
focus(app)

# --- 1. written step ---------------------------------------------------------
print("\nwritten steps:")
click_in(app, 200, 195, settle=0.8)            # select step 1
before = len(steps())
click_in(app, *BTN["note"], settle=1.0)        # + Note
after = steps()
chk("a note is inserted", len(after) == before + 1)
note = next((s for s in after if s.get("action") == "note"), None)
chk("the note lands after the selected step", note and after[1]["id"] == note["id"])

if note:
    type_text(app, "Wait for the overnight batch to finish")
    time.sleep(1.0)
    note = next(s for s in steps() if s.get("action") == "note")
    chk(f"typed text is saved ({note.get('text','')!r})",
        note.get("text") == "Wait for the overnight batch to finish")
    chk("a note carries no screenshot", not note.get("screenshot"))

# --- 2. blur ------------------------------------------------------------------
print("\nblur:")
click_in(app, 200, 195, settle=0.8)            # back to step 1
s1 = steps()[0]
shot = os.path.join(sess, s1["screenshot"])
before_hash = sha(shot)
before_size = os.path.getsize(shot)

click_in(app, 1161, 200, settle=0.6)           # Blur area
drag_in(app, 500, 330, 700, 400)               # drag across part of the image
time.sleep(1.5)

after_hash = sha(shot)
chk(f"the screenshot on disk changed ({before_hash} -> {after_hash})", before_hash != after_hash)
s1b = next(s for s in steps() if s["id"] == s1["id"])
chk("the step is flagged as redacted", s1b.get("redacted") is True)
chk("editedAt is stamped", bool(s1b.get("editedAt")))
chk("the file is still a real PNG", open(shot, "rb").read(8) == b"\x89PNG\r\n\x1a\n")
print(f"    {before_size} -> {os.path.getsize(shot)} bytes")

# --- 3. exclude from export ---------------------------------------------------
print("\nexclusion:")
click_in(app, 200, 265, settle=0.8)            # select the note (row 2)
click_in(app, 855, 200, settle=1.0)            # Exclude from export
sel = steps()[1]
chk("exclusion is stored on the selected step", sel.get("excluded") is True)

# --- 4. drag to reorder -------------------------------------------------------
print("\nreorder:")
order_before = [s["id"] for s in steps()]
# drag the last row up above the first
rows = len(order_before)
last_y = 195 + (rows - 1) * 70
drag_in(app, 200, last_y, 200, 180, steps=18)
time.sleep(1.2)
order_after = [s["id"] for s in steps()]
chk(f"the order changed ({order_before[-1][:6]} moved)", order_after != order_before)
chk("no step was lost or duplicated", sorted(order_after) == sorted(order_before))
chk("the dragged step is now first", order_after[0] == order_before[-1])

print(f"\n{pas} passed, {fai} failed")
