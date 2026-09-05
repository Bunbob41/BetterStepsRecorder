"""The maintenance story end to end: record against an application, confirm the
steps still match while it is running, then close it and confirm the tool says
so rather than silently passing."""
import sys, os, time, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui_drive import *

TARGET = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "KbdTarget", "bin", "Debug", "net10.0-windows", "kbdtarget.exe")
app = find("Steps Recorder"); assert app
force_focus(app); assert_layout(app)
before = sessions()

pas = fai = 0
def chk(n, c):
    global pas, fai
    if c: pas += 1; print("  PASS " + n)
    else: fai += 1; print("  FAIL " + n)

tgt = subprocess.Popen([TARGET], stdout=subprocess.PIPE, text=True, bufsize=1)
rects = {}
dl = time.time() + 15
while time.time() < dl and len(rects) < 2:
    line = tgt.stdout.readline()
    if line.startswith("RECT"):
        _, n, x, y, w, h = line.split(); rects[n] = (int(x), int(y), int(w), int(h))
target = find("KBD Test Window"); assert target

click_in(app, *BTN["start"], settle=2.5)
assert sessions() - before
sess = sorted(sessions() - before)[0]
meta = os.path.join(sess, "session.json")
def steps(): return json.load(open(meta, encoding="utf-8"))["steps"]

assert force_focus(target)
for field in ("plain", "secret"):
    x, y, w, h = rects[field]
    click_at(x + w // 2, y + h // 2)
chord(0x11, 0x10, 0x79)
time.sleep(2.0)
print(f"recorded {len(steps())} steps against the target")

# --- while the application is still running ---
print("\nchecking while the app is running:")
force_focus(app)
click_in(app, *BTN["check"], settle=1.0)
time.sleep(6.0)
after = steps()
statuses = [s.get("verify", {}).get("status") for s in after]
print("  statuses:", statuses)
chk("every step was checked", all(s is not None for s in statuses))
chk("controls that exist are reported as matching",
    statuses.count("match") >= 1)
chk("nothing is wrongly reported as missing", "missing" not in statuses)
chk("the result is stamped with a time",
    all(s.get("verify", {}).get("at") for s in after))

# --- now the application is gone: the guide has rotted ---
print("\nclosing the application and checking again:")
close_window(target); tgt.wait(timeout=10); time.sleep(1.5)
force_focus(app)
click_in(app, *BTN["check"], settle=1.0)
time.sleep(6.0)
after2 = steps()
statuses2 = [s.get("verify", {}).get("status") for s in after2]
print("  statuses:", statuses2)
chk("the tool now says it could not confirm those steps",
    all(s in ("appNotRunning", "noTarget") for s in statuses2))
chk("and does not claim they still match", "match" not in statuses2)

print(f"\n{pas} passed, {fai} failed")
