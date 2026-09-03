"""Verify capture options actually change what lands on disk."""
import subprocess, json, threading, time, os, tempfile, shutil, struct

exe = r"capture\bin\Debug\net10.0-windows\bettersteps-capture.exe"

def png_size(p):
    raw = open(p,'rb').read()
    return struct.unpack(">II", raw[16:24])

def run(fmt, quality, scale, label):
    session = os.path.join(tempfile.gettempdir(), f"bsr-opt-{label}")
    shutil.rmtree(session, ignore_errors=True)
    p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         text=True, encoding="utf-8", bufsize=1)
    msgs=[]
    threading.Thread(target=lambda:[msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                     daemon=True).start()
    time.sleep(0.8)
    p.stdin.write(json.dumps({"v":1,"type":"start","id":"s","sessionDir":session,
                              "imageFormat":fmt,"imageQuality":quality,
                              "imageScale":scale})+"\n"); p.stdin.flush()
    time.sleep(0.4)

    import ctypes
    u32 = ctypes.windll.user32
    u32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    u32.SetCursorPos(600, 400); time.sleep(0.2)
    u32.mouse_event(0x0002,0,0,0,0); time.sleep(0.05); u32.mouse_event(0x0004,0,0,0,0)
    time.sleep(1.8)

    p.stdin.write(json.dumps({"v":1,"type":"stop","id":"x"})+"\n"); p.stdin.flush()
    p.wait(timeout=10)

    steps=[m for m in msgs if m.get("type")=="step"]
    if not steps: return print(f"  {label}: NO STEPS")
    s=steps[0]; f=os.path.join(session, s["screenshot"])
    size=os.path.getsize(f)
    dims = png_size(f) if f.endswith(".png") else "-"
    print(f"  {label:<22} file={s['screenshot']:<16} {size:>7} bytes  dims={dims}")
    return size

print("capture option matrix (one click each, same screen):")
a=run("png",  85, 1.0,  "png-full")
b=run("png",  85, 0.5,  "png-half")
c=run("jpeg", 85, 1.0,  "jpeg-q85")
d=run("jpeg", 40, 1.0,  "jpeg-q40")
print("\nchecks:")
print(("  PASS " if b and a and b < a else "  FAIL ") + "scale 50% produces a smaller file than 100%")
print(("  PASS " if d and c and d < c else "  FAIL ") + "jpeg q40 smaller than q85")
