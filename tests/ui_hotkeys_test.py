"""Global hotkeys must work while ANOTHER application is in front - that is the
whole point of them, and the one thing a unit test cannot show."""
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
for attempt in range(3):
    click_in(app, *BTN["start"])
    time.sleep(1.5)
    new = sessions() - before
    if new: break
assert new, "Start recording did not create a session"
sess = sorted(new)[0]
print(f"recording to {os.path.basename(sess)}")

def steps():
    try: return json.load(open(os.path.join(sess, "session.json"), encoding="utf-8"))["steps"]
    except Exception: return []

x, y, w, h = rects["plain"]
focus(target)
click_at(x + w // 2, y + h // 2)
chk("a click in another app is recorded", len(steps()) == 1)

# Pause from the target application, without touching the recorder window.
chk("target still has focus before the hotkey", owns_focus(target))
chord(0x11, 0x10, 0x78)          # Ctrl+Shift+F9
chk("recorder did not steal focus when the hotkey fired", owns_focus(target))

n_before = len(steps())
click_at(x + w // 2, y + h // 2 + 4)
time.sleep(1.2)
chk("clicks after the pause hotkey are NOT recorded", len(steps()) == n_before)

chord(0x11, 0x10, 0x78)          # resume
click_at(x + w // 2, y + h // 2 + 8)
time.sleep(1.4)
chk("clicks after the resume hotkey ARE recorded", len(steps()) > n_before)

n_before = len(steps())
chord(0x11, 0x10, 0x79)          # Ctrl+Shift+F10 stop
time.sleep(1.0)
click_at(x + w // 2, y + h // 2 + 12)
time.sleep(1.2)
chk("clicks after the stop hotkey are NOT recorded", len(steps()) == n_before)

blob = json.dumps(steps())
chk("the hotkeys themselves were not recorded as steps",
    "Ctrl+Shift+F9" not in blob and "Ctrl+Shift+F10" not in blob)
chk("no step captured the recorder's own window", "Steps Recorder" not in blob)

tgt.terminate()
print(f"\n{pas} passed, {fai} failed")
