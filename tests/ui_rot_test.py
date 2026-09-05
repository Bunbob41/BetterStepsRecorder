"""The case the feature exists for: the application is still running, but a new
version renamed a control. A guide recorded against v1 should be flagged."""
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

def launch(extra=None):
    proc = subprocess.Popen([TARGET] + (extra or []), stdout=subprocess.PIPE,
                            text=True, bufsize=1)
    rects, dl = {}, time.time() + 15
    while time.time() < dl and len(rects) < 2:
        line = proc.stdout.readline()
        if line.startswith("RECT"):
            _, n, x, y, w, h = line.split(); rects[n] = (int(x), int(y), int(w), int(h))
    return proc, rects, find("KBD Test Window")

# --- record a guide against version 1 ---
proc, rects, target = launch()
click_in(app, *BTN["start"], settle=2.5)
assert sessions() - before
sess = sorted(sessions() - before)[0]
meta = os.path.join(sess, "session.json")
def steps(): return json.load(open(meta, encoding="utf-8"))["steps"]

assert force_focus(target)
for field in ("plain", "secret"):
    x, y, w, h = rects[field]
    click_at(x + w // 2, y + h // 2)
chord(0x11, 0x10, 0x79); time.sleep(2.0)

recorded = steps()
print(f"recorded {len(recorded)} steps against v1:")
for s in recorded:
    t = s.get("target") or {}
    print(f"   {s['text'][:52]:<54} id={t.get('automationId')!r}")

# --- the vendor ships v2: same app, one control renamed ---
close_window(target); proc.wait(timeout=10); time.sleep(1.0)
proc2, rects2, target2 = launch(["--v2"])
print("\nrelaunched as v2 (Customer Name -> Client Name)")

force_focus(app)
click_in(app, *BTN["check"], settle=1.0)
time.sleep(7.0)

after = steps()
for s in after:
    v = s.get("verify") or {}
    t = s.get("target") or {}
    print(f"   {str(t.get('automationId')):<16} {v.get('status')}")

statuses = [ (s.get('verify') or {}).get('status') for s in after ]
chk("the renamed control is reported as no longer found", "missing" in statuses)
chk("the unchanged control still matches", "match" in statuses)
chk("the app being open is not mistaken for the guide being fine",
    statuses.count("match") < len(statuses))

close_window(target2); proc2.wait(timeout=10)
print(f"\n{pas} passed, {fai} failed")
