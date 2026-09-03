"""End-to-end: drive the Electron UI's own buttons, click a target window,
   confirm steps flow through sidecar -> session -> UI."""
import ctypes, time, subprocess, os, json, glob
from ctypes import wintypes

def save_root():
    """Read the app's configured save location. Hardcoding Documents here once
    made this test report PASS against stale directories while recording was
    silently writing somewhere else entirely."""
    cfg = os.path.expanduser("~/AppData/Roaming/bettersteps-ui/settings.json")
    try:
        return json.load(open(cfg, encoding="utf-8"))["saveRoot"]
    except Exception:
        return os.path.expanduser("~/Documents/StepRecordings")

ROOT = save_root()
BEFORE = set(glob.glob(os.path.join(ROOT, "session-*")))
print(f"save root: {ROOT} ({len(BEFORE)} existing sessions)")

u32 = ctypes.windll.user32
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

class PT(ctypes.Structure): _fields_=[("x",ctypes.c_long),("y",ctypes.c_long)]
WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

def find(title_exact):
    found = []
    def cb(h,_):
        if u32.IsWindowVisible(h):
            b = ctypes.create_unicode_buffer(512)
            u32.GetWindowTextW(h, b, 512)
            if b.value.strip() == title_exact:
                found.append(h); return False
        return True
    u32.EnumWindows(WNDENUMPROC(cb), 0)
    return found[0] if found else None

def rect(h):
    r = wintypes.RECT(); u32.GetWindowRect(h, ctypes.byref(r)); return r

def click(x,y):
    u32.SetCursorPos(x,y); time.sleep(0.2)
    u32.mouse_event(0x0002,0,0,0,0); time.sleep(0.06)
    u32.mouse_event(0x0004,0,0,0,0); time.sleep(0.25)

app = find("Steps Recorder")
assert app, "Steps Recorder window not found"
u32.SetForegroundWindow(app); time.sleep(0.8)
r = rect(app)
print(f"app at {r.left},{r.top} {r.right-r.left}x{r.bottom-r.top}")

def new_sessions():
    return sorted(set(glob.glob(os.path.join(ROOT, "session-*"))) - BEFORE)

# "Start recording" button, from the screenshot layout (toolbar, ~72px down).
# Verified rather than assumed: a click arriving just after launch can be
# consumed activating the window instead of pressing the button, which
# previously made this test fail intermittently for no application reason.
for attempt in range(3):
    click(r.left + 220, r.top + 72)
    deadline = time.time() + 5
    while time.time() < deadline and not new_sessions():
        time.sleep(0.25)
    if new_sessions():
        print(f"pressed Start recording (attempt {attempt + 1})")
        break
else:
    raise AssertionError("Start recording never created a session after 3 attempts")
time.sleep(1.0)

# Launch a target and click it
tgt = subprocess.Popen(["powershell.exe","-NoProfile","-ExecutionPolicy","Bypass",
                        "-File","tests/target.ps1"])
time.sleep(4.0)
tw = find("BSR Test Window")
assert tw, "target window not found"
u32.SetForegroundWindow(tw); time.sleep(0.6)

p = PT(110,70); u32.ClientToScreen(tw, ctypes.byref(p))
print(f"clicking Save at {p.x},{p.y}")
click(p.x, p.y); time.sleep(1.5)

p2 = PT(200,165); u32.ClientToScreen(tw, ctypes.byref(p2))
print(f"clicking text box at {p2.x},{p2.y}")
click(p2.x, p2.y); time.sleep(1.5)

tgt.terminate(); time.sleep(0.5)

# Stop via the UI
u32.SetForegroundWindow(app); time.sleep(0.8)
click(r.left + 416, r.top + 72)
time.sleep(1.5)
print("pressed Stop")

fresh = sorted(set(glob.glob(os.path.join(ROOT, "session-*"))) - BEFORE)
assert fresh, f"no NEW session directory appeared under {ROOT}"
assert len(fresh) == 1, f"expected exactly one new session, got {len(fresh)}"
latest = fresh[0]
print(f"\nsession: {latest}")
meta = json.load(open(os.path.join(latest,"session.json"), encoding="utf-8"))
print(f"steps persisted: {len(meta['steps'])}")
for s in meta["steps"]:
    png = os.path.join(latest, s["screenshot"])
    print(f"  {s['seq']} {s['action']:<11} {s['text']!r}")
    print(f"      png exists={os.path.exists(png)} size={os.path.getsize(png) if os.path.exists(png) else 0}")
