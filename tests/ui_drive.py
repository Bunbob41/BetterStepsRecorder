"""Shared helpers for driving the real UI. Coordinates come from the DWM frame
so they match what a screenshot shows, pixel for pixel."""
import ctypes, time, json, os, glob
from ctypes import wintypes

u32 = ctypes.windll.user32
dwm = ctypes.windll.dwmapi
u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))

class RECT(ctypes.Structure):
    _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                ("right", ctypes.c_long), ("bottom", ctypes.c_long)]
class PT(ctypes.Structure):
    _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]

WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

def find(title):
    found = []
    def cb(h, _):
        if u32.IsWindowVisible(h):
            b = ctypes.create_unicode_buffer(512)
            u32.GetWindowTextW(h, b, 512)
            if b.value.strip() == title:
                found.append(h); return False
        return True
    u32.EnumWindows(WNDENUMPROC(cb), 0)
    return found[0] if found else None

def frame(hwnd):
    """DWM extended bounds: the rect a screenshot of the window corresponds to."""
    r = RECT()
    dwm.DwmGetWindowAttribute(wintypes.HWND(hwnd), 9, ctypes.byref(r), ctypes.sizeof(r))
    return r

def focus(hwnd, pause=0.7):
    u32.SetForegroundWindow(hwnd); time.sleep(pause)

def owns_focus(hwnd):
    return u32.GetForegroundWindow() == hwnd

def click_at(x, y, settle=1.2):
    u32.SetCursorPos(int(x), int(y)); time.sleep(0.25)
    u32.mouse_event(0x0002, 0, 0, 0, 0); time.sleep(0.05)
    u32.mouse_event(0x0004, 0, 0, 0, 0); time.sleep(settle)

def click_in(hwnd, ix, iy, settle=1.2):
    """Click at image coordinates within a window's DWM frame."""
    r = frame(hwnd)
    click_at(r.left + ix, r.top + iy, settle)

def drag_in(hwnd, x1, y1, x2, y2, steps=14):
    r = frame(hwnd)
    u32.SetCursorPos(r.left + x1, r.top + y1); time.sleep(0.3)
    u32.mouse_event(0x0002, 0, 0, 0, 0); time.sleep(0.2)
    for i in range(1, steps + 1):
        u32.SetCursorPos(int(r.left + x1 + (x2 - x1) * i / steps),
                         int(r.top + y1 + (y2 - y1) * i / steps))
        time.sleep(0.04)
    time.sleep(0.2)
    u32.mouse_event(0x0004, 0, 0, 0, 0); time.sleep(1.0)

def chord(*vks, hold=0.06):
    for vk in vks: u32.keybd_event(vk, 0, 0, 0)
    time.sleep(hold)
    for vk in reversed(vks): u32.keybd_event(vk, 0, 2, 0)
    time.sleep(0.8)

def type_text(hwnd, s):
    """Types only while the intended window still owns focus."""
    for ch in s:
        if not owns_focus(hwnd):
            raise RuntimeError("focus lost mid-type; aborting")
        vk = u32.VkKeyScanW(ord(ch)); shift = (vk >> 8) & 1; vk &= 0xFF
        if shift: u32.keybd_event(0x10, 0, 0, 0)
        u32.keybd_event(vk, 0, 0, 0); time.sleep(0.02)
        u32.keybd_event(vk, 0, 2, 0)
        if shift: u32.keybd_event(0x10, 0, 2, 0)
        time.sleep(0.03)

# Toolbar and panel positions, read off a screenshot of the window at its
# default size. The toolbar is a flex row, so anything added to it moves every
# button: assert_layout() fails loudly rather than clicking into empty space,
# which is how a UI change once looked like a broken feature.
LAYOUT = (1564, 875)
BTN = {
    "scope": (491, 71), "start": (657, 71), "pause": (773, 71), "stop": (852, 71),
    "open": (936, 71), "export": (1032, 71), "settings": (1132, 71),
    "note": (328, 132), "name": (200, 72),
}
# Detail pane controls, when a step is selected.
DETAIL = {"exclude": (855, 200), "blur": (1161, 200),
          "rerecord": (1379, 200), "delete": (1512, 200)}
ROW0_Y, ROW_PITCH = 200, 70

def row_y(i):
    return ROW0_Y + i * ROW_PITCH

def assert_layout(hwnd):
    r = frame(hwnd)
    size = (r.right - r.left, r.bottom - r.top)
    if size != LAYOUT:
        raise AssertionError(
            f"window is {size[0]}x{size[1]}, expected {LAYOUT[0]}x{LAYOUT[1]}; "
            "the coordinates in BTN/DETAIL were read at the default size and "
            "will not land where they should")

def close_window(hwnd):
    """WM_CLOSE, not terminate: killing a GUI process can leave its pixels
    composited on screen, which then swallows clicks aimed at what is behind."""
    if hwnd:
        u32.PostMessageW(hwnd, 0x0010, 0, 0)
        time.sleep(1.0)

def save_root():
    cfg = os.path.expanduser("~/AppData/Roaming/Steps Recorder/settings.json")
    try: return json.load(open(cfg, encoding="utf-8"))["saveRoot"]
    except Exception: return os.path.expanduser("~/Documents/StepRecordings")

def sessions():
    return set(glob.glob(os.path.join(save_root(), "session-*")))
