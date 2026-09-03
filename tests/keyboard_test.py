"""Typing aggregation, password suppression and redaction, against real controls."""
import subprocess, json, threading, time, os, tempfile, shutil, ctypes
from ctypes import wintypes

exe = r"capture\bin\Debug\net10.0-windows\bettersteps-capture.exe"
session = os.path.join(tempfile.gettempdir(), "bsr-kbd")
shutil.rmtree(session, ignore_errors=True)

u32 = ctypes.windll.user32
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
class PT(ctypes.Structure): _fields_=[("x",ctypes.c_long),("y",ctypes.c_long)]

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
    u32.SetCursorPos(x,y); time.sleep(0.2)
    u32.mouse_event(0x0002,0,0,0,0); time.sleep(0.05); u32.mouse_event(0x0004,0,0,0,0)
    time.sleep(0.4)

class FocusLost(Exception):
    """The test window stopped owning focus mid-test."""

def require_focus():
    """
    Synthetic input goes to the global queue and lands wherever focus happens
    to be. On a machine somebody is actually using, that means typing test
    strings into their applications. Never send a keystroke without owning
    focus first.
    """
    fg = u32.GetForegroundWindow()
    if fg != w:
        buf = ctypes.create_unicode_buffer(256)
        u32.GetWindowTextW(fg, buf, 256)
        raise FocusLost(
            f"test window lost focus to {buf.value!r}; aborting rather than "
            f"typing into someone else's application")

def type_text(s):
    require_focus()
    for ch in s:
        require_focus()
        vk = u32.VkKeyScanW(ord(ch))
        shift = (vk >> 8) & 1
        vk &= 0xFF
        if shift: u32.keybd_event(0x10, 0, 0, 0)
        u32.keybd_event(vk, 0, 0, 0); time.sleep(0.02)
        u32.keybd_event(vk, 0, 2, 0)
        if shift: u32.keybd_event(0x10, 0, 2, 0)
        time.sleep(0.03)

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, encoding="utf-8", bufsize=1)
msgs=[]
threading.Thread(target=lambda:[msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                 daemon=True).start()
def send(o): p.stdin.write(json.dumps({"v":1,"id":"x",**o})+"\n"); p.stdin.flush()

# A per-monitor DPI aware target that reports the physical screen rect of each
# field, so the test clicks exactly where it means to on a scaled display.
TARGET_EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
    "KbdTarget", "bin", "Debug", "net10.0-windows", "kbdtarget.exe")
assert os.path.exists(TARGET_EXE), f"build it first: dotnet build tests/KbdTarget ({TARGET_EXE})"
tgt = subprocess.Popen([TARGET_EXE],
                       stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
RECTS = {}
deadline = time.time() + 15
while time.time() < deadline and len(RECTS) < 2:
    line = tgt.stdout.readline()
    if line.startswith("RECT"):
        _, name, x, y, w, h = line.split()
        RECTS[name] = (int(x), int(y), int(w), int(h))
assert len(RECTS) == 2, f"target did not report field rects: {RECTS}"
print("field rects:", RECTS)
time.sleep(1.0)
w = find("KBD Test Window")
assert w, "target window not found"
u32.SetForegroundWindow(w); time.sleep(0.6)

time.sleep(0.5)
send({"type":"start","sessionDir":session,"recordKeyboard":True})
time.sleep(0.5)

def centre(name):
    x,y,cw,ch = RECTS[name]
    return x + cw//2, y + ch//2

try:
    pass
finally:
    pass

# 1. ordinary typing into a plain field
px,py = centre("plain")
click(px,py)
type_text("ACME Corp")
time.sleep(2.2)          # let the idle flush fire

# 2. a shortcut
u32.keybd_event(0x11,0,0,0); u32.keybd_event(0x53,0,0,0)
time.sleep(0.05)
u32.keybd_event(0x53,0,2,0); u32.keybd_event(0x11,0,2,0)
time.sleep(1.0)

# 3. typing into a password field
sx,sy = centre("secret")
click(sx,sy)
type_text("hunter2secret")
time.sleep(2.2)

# 4. a card number in a PLAIN field (redaction path)
click(px,py)
type_text("4111111111111111")
time.sleep(2.4)

send({"type":"stop"}); p.wait(timeout=10)
tgt.terminate()
time.sleep(0.4)

steps=[m for m in msgs if m.get("type")=="step"]
print(f"\n{len(steps)} steps:")
for s in steps:
    print(f"  {s['seq']:>2} {s['action']:<10} {s.get('text')!r}")
    if s.get("typed"): print(f"       typed={s['typed']!r}")

blob = json.dumps(msgs)
print("\nchecks:")
def chk(name, cond): print(("  PASS " if cond else "  FAIL ") + name)

typed_steps = [s for s in steps if s["action"]=="keyText"]
chk("typing aggregated into steps, not per-keystroke", len(steps) <= 8)
chk("plain text captured", any(s.get("typed")=="ACME Corp" for s in typed_steps))
chk("shortcut recorded", any("Ctrl+S" in (s.get("text") or "") for s in steps))
chk("password step emitted", any(s["action"]=="password" for s in steps))
chk("password NEVER appears anywhere in the stream", "hunter2" not in blob)
chk("password step carries no typed field",
    all(s.get("typed") is None for s in steps if s["action"]=="password"))
chk("card number redacted", "4111111111111111" not in blob)
chk("redaction marker present", any("[redacted]" in (s.get("typed") or "") for s in steps))
