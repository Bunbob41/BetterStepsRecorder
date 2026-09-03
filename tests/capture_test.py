import subprocess, json, threading, time, os, tempfile, ctypes, shutil
from ctypes import wintypes

u32 = ctypes.windll.user32
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

exe = r"capture\bin\Debug\net10.0-windows\bettersteps-capture.exe"
session = os.path.join(tempfile.gettempdir(), "bsr-captest")
shutil.rmtree(session, ignore_errors=True)

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
msgs = []
threading.Thread(target=lambda: [msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                 daemon=True).start()
def send(o): p.stdin.write(json.dumps(o)+"\n"); p.stdin.flush()

time.sleep(0.8)
send({"v":1,"type":"start","id":"s","sessionDir":session})
time.sleep(0.3)

# Launch our own target window so synthetic clicks land somewhere harmless.
np = subprocess.Popen(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass",
                       "-File","scratch/target.ps1"])
time.sleep(4.0)

hwnd = None
def cb(h, _):
    global hwnd
    if u32.IsWindowVisible(h):
        buf = ctypes.create_unicode_buffer(256)
        u32.GetWindowTextW(h, buf, 256)
        if buf.value == "BSR Test Window":
            hwnd = h
            return False
    return True
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
u32.EnumWindows(WNDENUMPROC(cb), 0)

assert hwnd, "could not find the test window"
u32.SetForegroundWindow(hwnd); time.sleep(0.6)

r = wintypes.RECT(); u32.GetWindowRect(hwnd, ctypes.byref(r))
print(f"notepad rect: {r.left},{r.top} {r.right-r.left}x{r.bottom-r.top}")
assert r.right-r.left > 200 and r.bottom-r.top > 200, "degenerate window rect"

class PT(ctypes.Structure): _fields_=[("x",ctypes.c_long),("y",ctypes.c_long)]
def to_screen(clx, cly):
    pt = PT(clx, cly); u32.ClientToScreen(hwnd, ctypes.byref(pt)); return pt.x, pt.y
bx, by = to_screen(110, 70)      # centre of the "Save" button
cx, cy = (r.left+r.right)//2, (r.top+r.bottom)//2
assert r.left < bx < r.right and r.top < by < r.bottom, "click point outside window"
print(f"save button at {bx},{by}")

LD, LU = 0x0002, 0x0004
def click(x, y):
    u32.SetCursorPos(x, y); time.sleep(0.15)
    u32.mouse_event(LD, 0, 0, 0, 0); time.sleep(0.05)
    u32.mouse_event(LU, 0, 0, 0, 0)

print("single click on Save...");  click(bx, by);   time.sleep(1.2)
print("drag...")
u32.SetCursorPos(cx-100, cy); time.sleep(0.15)
u32.mouse_event(LD,0,0,0,0); time.sleep(0.1)
for i in range(1, 11):
    u32.SetCursorPos(cx-100+i*20, cy+i*3); time.sleep(0.02)
u32.mouse_event(LU,0,0,0,0); time.sleep(1.5)

send({"v":1,"type":"stop","id":"x"})
p.wait(timeout=10)
np.terminate()
time.sleep(0.3)

steps = [m for m in msgs if m.get("type")=="step"]
errs  = [m for m in msgs if m.get("type")=="error"]
print(f"\n--- {len(steps)} steps, {len(errs)} errors ---")
for s in steps:
    w = s.get("window") or {}
    t = s.get("target")
    print(f"  seq={s['seq']} {s['action']:<11} pt={s['point']['x']},{s['point']['y']} "
          f"scale={s['monitor']['scale']} proc={w.get('process')!r}")
    print(f"      text={s.get('text')!r}")
    print(f"      target={t}")
    png = os.path.join(session, s['screenshot'])
    ok = os.path.exists(png)
    print(f"      png={s['screenshot']} exists={ok} size={os.path.getsize(png) if ok else 0}")
for e in errs: print("  ERROR", e)
