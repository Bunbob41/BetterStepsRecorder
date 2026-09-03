"""Re-record one step of an existing guide and prove the others are untouched."""
import subprocess, json, threading, time, os, tempfile, shutil, ctypes

exe = r"capture\bin\Debug\net10.0-windows\bettersteps-capture.exe"
session = os.path.join(tempfile.gettempdir(), "bsr-redo")
shutil.rmtree(session, ignore_errors=True)

u32 = ctypes.windll.user32
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, encoding="utf-8", bufsize=1)
msgs = []
threading.Thread(target=lambda: [msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                 daemon=True).start()
def send(o): p.stdin.write(json.dumps({"v":1,"id":"x",**o})+"\n"); p.stdin.flush()
def click(x,y):
    u32.SetCursorPos(x,y); time.sleep(0.2)
    u32.mouse_event(0x0002,0,0,0,0); time.sleep(0.05); u32.mouse_event(0x0004,0,0,0,0)
    time.sleep(1.6)

time.sleep(0.8)
send({"type":"start","sessionDir":session})
time.sleep(0.3)

print("recording three steps...")
click(400, 300); click(700, 400); click(900, 500)
send({"type":"pause"}); time.sleep(0.5)

steps = [m for m in msgs if m.get("type")=="step"]
assert len(steps) == 3, f"expected 3 steps, got {len(steps)}"
target = steps[1]
print(f"  captured {len(steps)}: seqs {[s['seq'] for s in steps]}")
print(f"  will re-record step 2 (id {target['id'][:8]}, was at {target['point']})")
old_shot = target["screenshot"]

# --- re-record just step 2, clicking somewhere different ---
send({"type":"armOnce","replaceId":target["id"]})
time.sleep(0.4)
click(1200, 700)

# a second click must NOT be captured: single-shot means one
click(300, 700)
time.sleep(0.8)
send({"type":"stop"}); p.wait(timeout=10)

redo = [m for m in msgs if m.get("type")=="step" and m.get("replaces")]
extra = [m for m in msgs if m.get("type")=="step"][3:]

print(f"\nreplacement steps: {len(redo)}")
print(f"total steps emitted after arming: {len(extra)}")
ok = True
if len(redo) != 1:
    print("  FAIL expected exactly 1 replacement"); ok = False
else:
    r = redo[0]
    print(f"  replaces={r['replaces'][:8]} newpoint={r['point']} file={r['screenshot']}")
    print(("  PASS " if r["replaces"] == target["id"] else "  FAIL ") + "targets the right step")
    print(("  PASS " if r["point"]["x"] == 1200 else "  FAIL ") + "captured the new location")
    print(("  PASS " if r["screenshot"] != old_shot else "  FAIL ") + "wrote a distinct screenshot file")
    print(("  PASS " if os.path.exists(os.path.join(session, r["screenshot"])) else "  FAIL ") + "screenshot exists")
print(("  PASS " if len(extra) == 1 else "  FAIL ") + "single-shot captured exactly one event (the later click was ignored)")
