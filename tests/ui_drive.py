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

def title_of(hwnd):
    b = ctypes.create_unicode_buffer(512)
    u32.GetWindowTextW(hwnd, b, 512)
    return b.value


def force_focus(hwnd, tries=3):
    """
    Bring a window to the foreground and PROVE it. SetForegroundWindow is
    routinely refused for a background caller and returns without complaint, so
    trusting it is how synthetic keystrokes end up in whatever the user had
    open. Falls back to clicking the title bar, which always works.
    """
    for _ in range(tries):
        u32.ShowWindow(hwnd, 9)                       # SW_RESTORE
        # An Alt tap releases the foreground lock for this thread.
        u32.keybd_event(0x12, 0, 0, 0); u32.keybd_event(0x12, 0, 2, 0)
        u32.SetForegroundWindow(hwnd)
        time.sleep(0.6)
        if u32.GetForegroundWindow() == hwnd:
            return True

        r = frame(hwnd)
        if r.right > r.left:
            click_at(r.left + 140, r.top + 12, settle=0.5)   # title bar only
            time.sleep(0.4)
            if u32.GetForegroundWindow() == hwnd:
                return True
    return False


def require_window(hwnd, expect):
    """Refuse to continue unless the intended window really has focus."""
    fg = u32.GetForegroundWindow()
    if fg != hwnd:
        raise RuntimeError(
            f"expected {expect!r} to have focus, but {title_of(fg)!r} does; "
            "refusing to type")


def type_into(hwnd, text, expect="window", pace=0.018):
    """Types only while `hwnd` still owns the foreground, checked per keystroke."""
    require_window(hwnd, expect)
    for ch in text:
        require_window(hwnd, expect)
        vk = u32.VkKeyScanW(ord(ch)); shift = (vk >> 8) & 1; vk &= 0xFF
        if shift: u32.keybd_event(0x10, 0, 0, 0)
        u32.keybd_event(vk, 0, 0, 0); time.sleep(pace); u32.keybd_event(vk, 0, 2, 0)
        if shift: u32.keybd_event(0x10, 0, 2, 0)
        time.sleep(pace)


def keys_into(hwnd, *vks, expect="window", wait=0.9):
    """Sends a key or chord, but only to the window that should receive it."""
    require_window(hwnd, expect)
    for v in vks: u32.keybd_event(v, 0, 0, 0)
    time.sleep(0.06)
    for v in reversed(vks): u32.keybd_event(v, 0, 2, 0)
    time.sleep(wait)


def wait_for_window(match, timeout=12):
    """Waits for a foreground window whose title matches, and returns it."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        fg = u32.GetForegroundWindow()
        if fg and match(title_of(fg)):
            return fg
        time.sleep(0.3)
    raise RuntimeError(f"no window matching the expectation appeared; "
                       f"foreground is {title_of(u32.GetForegroundWindow())!r}")


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
