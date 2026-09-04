"""Scoping must record the chosen application AND drop everything else.
Only the negative half was ever proven."""
import subprocess, json, threading, time, os, tempfile, shutil, ctypes
from ctypes import wintypes

u32 = ctypes.windll.user32
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
exe = os.path.join("capture","bin","Debug","net10.0-windows","bettersteps-capture.exe")
TARGET = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "KbdTarget","bin","Debug","net10.0-windows","kbdtarget.exe")
session = os.path.join(tempfile.gettempdir(), "bsr-scope-pos")
shutil.rmtree(session, ignore_errors=True)

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
def find(title):
    found=[]
    def cb(h,_):
        if u32.IsWindowVisible(h):
            b=ctypes.create_unicode_buffer(512); u32.GetWindowTextW(h,b,512)
            if b.value.strip()==title: found.append(h); return False
        return True
    u32.EnumWindows(WNDENUMPROC(cb),0)
    return found[0] if found else None

def click(x,y):
    u32.SetCursorPos(x,y); time.sleep(0.25)
    u32.mouse_event(0x0002,0,0,0,0); time.sleep(0.05); u32.mouse_event(0x0004,0,0,0,0)
    time.sleep(1.4)

tgt = subprocess.Popen([TARGET], stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
RECTS={}
deadline=time.time()+15
while time.time()<deadline and len(RECTS)<2:
    line=tgt.stdout.readline()
    if line.startswith("RECT"):
        _,name,x,y,w,h = line.split(); RECTS[name]=(int(x),int(y),int(w),int(h))
assert len(RECTS)==2
w = find("KBD Test Window"); assert w
pid = wintypes.DWORD(); u32.GetWindowThreadProcessId(w, ctypes.byref(pid))
print(f"target pid {pid.value}, fields {RECTS}")

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, encoding="utf-8", bufsize=1)
msgs=[]
threading.Thread(target=lambda:[msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                 daemon=True).start()
def send(o): p.stdin.write(json.dumps({"v":1,"id":"x",**o})+"\n"); p.stdin.flush()

time.sleep(0.8)
send({"type":"start","sessionDir":session,"allowPids":[pid.value],"recordKeyboard":False})
time.sleep(0.5)

u32.SetForegroundWindow(w); time.sleep(0.6)
x,y,cw,ch = RECTS["plain"]
print("clicking INSIDE the scoped application...")
click(x+cw//2, y+ch//2)

print("clicking OUTSIDE it (desktop, bottom-left corner)...")
click(40, u32.GetSystemMetrics(1) - 60)

send({"type":"stop"}); p.wait(timeout=10)
tgt.terminate(); time.sleep(0.3)

steps=[m for m in msgs if m.get("type")=="step"]
print(f"\n{len(steps)} steps recorded:")
for s in steps:
    print(f"  {s['seq']} {s['action']:<10} proc={(s.get('window') or {}).get('process')!r} {s.get('text')!r}")

pas=fai=0
def chk(n,c):
    global pas,fai
    if c: pas+=1; print("  PASS "+n)
    else: fai+=1; print("  FAIL "+n)

print("\nchecks:")
chk("the in-scope click WAS recorded", len(steps) >= 1)
chk("exactly one step: the out-of-scope click was dropped", len(steps) == 1)
if steps:
    chk("the recorded step belongs to the scoped application",
        (steps[0].get("window") or {}).get("process") == "kbdtarget.exe")
    chk("it has a screenshot on disk",
        os.path.exists(os.path.join(session, steps[0]["screenshot"])))
print(f"\n{pas} passed, {fai} failed")
