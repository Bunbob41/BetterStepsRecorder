"""Export through the real UI, including the native save dialog, then check the
document actually honours exclusion and the reordered sequence."""
import sys, os, time, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ui_drive import *

OUT = os.path.join(os.environ["TEMP"], "bsr-ui-export.html")
if os.path.exists(OUT): os.remove(OUT)

app = find("Steps Recorder"); assert app
sess = sorted(sessions())[-1]
steps = json.load(open(os.path.join(sess, "session.json"), encoding="utf-8"))["steps"]
print(f"session {os.path.basename(sess)}: {len(steps)} steps, "
      f"{sum(1 for s in steps if s.get('excluded'))} excluded")

pas = fai = 0
def chk(n, c):
    global pas, fai
    if c: pas += 1; print("  PASS " + n)
    else: fai += 1; print("  FAIL " + n)

focus(app)
# The export dialog is already open from the previous step; if not, open it.
click_in(app, 1052, 691, settle=2.5)      # Export

# Native save dialog: the filename field has focus.
time.sleep(1.5)
for ch in OUT:
    vk = u32.VkKeyScanW(ord(ch)); shift = (vk >> 8) & 1; vk &= 0xFF
    if shift: u32.keybd_event(0x10, 0, 0, 0)
    u32.keybd_event(vk, 0, 0, 0); time.sleep(0.012)
    u32.keybd_event(vk, 0, 2, 0)
    if shift: u32.keybd_event(0x10, 0, 2, 0)
    time.sleep(0.012)
time.sleep(0.6)
u32.keybd_event(0x0D, 0, 0, 0); time.sleep(0.05); u32.keybd_event(0x0D, 0, 2, 0)
time.sleep(3.0)

chk("the export file was written", os.path.exists(OUT))
if os.path.exists(OUT):
    html = open(OUT, encoding="utf-8").read()
    print(f"    {len(html)//1024}KB")

    kept = [s for s in steps if not s.get("excluded")]
    dropped = [s for s in steps if s.get("excluded")]

    chk(f"document numbers only the {len(kept)} kept steps",
        f"{len(kept)} step" in html)
    chk("every kept step appears",
        all(f">{i+1}</span>" in html for i in range(len(kept))))
    chk("the excluded step's number is absent",
        f">{len(kept)+1}</span>" not in html)
    chk("images are embedded", "data:image/png;base64," in html)
    chk("no excluded screenshot leaked in",
        all(os.path.basename(d.get("screenshot","zzz")) not in html for d in dropped))
    chk("text is imperative", "Click the" in html and "Clicked the" not in html)
    chk("a click marker is drawn", 'class="marker"' in html)

print(f"\n{pas} passed, {fai} failed")
print("wrote:", OUT)
