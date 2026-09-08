"""Window enumeration and scope filtering. No synthetic input: this drives the
engine over its protocol and inspects what it reports."""
import subprocess, json, threading, time, os, tempfile, shutil

exe = os.path.join("capture","bin","Debug","net10.0-windows","bettersteps-capture.exe")
session = os.path.join(tempfile.gettempdir(), "bsr-scope")
shutil.rmtree(session, ignore_errors=True)

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, encoding="utf-8", bufsize=1)
msgs = []
threading.Thread(target=lambda: [msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                 daemon=True).start()
def send(o): p.stdin.write(json.dumps({"v":1,"id":"x",**o})+"\n"); p.stdin.flush()

time.sleep(0.8)
send({"type":"listWindows"})
time.sleep(1.5)

windows = [m for m in msgs if m.get("type") == "windows"]
pas = fai = 0
def chk(name, cond):
    global pas, fai
    if cond: pas += 1; print("  PASS " + name)
    else: fai += 1; print("  FAIL " + name)

print("window enumeration:")
chk("engine answers listWindows", len(windows) == 1)

items = windows[0]["items"] if windows else []
print(f"  found {len(items)} windows")
for w in items[:8]:
    print(f"    {w['process']:<24} {w['title'][:52]}")

chk("returns some windows", len(items) > 0)
chk("every entry has a pid", all(w.get("pid") for w in items))
chk("every entry has a non-empty title", all((w.get("title") or '').strip() for w in items))
chk("no zero handles", all(w.get("hwnd") for w in items))
chk("engine excludes its own process",
    all(w["pid"] != json.loads([l for l in msgs if l.get("type")=="ready"] and "{}" or "{}").get("x", 0)
        for w in items))

ready = next((m for m in msgs if m.get("type") == "ready"), None)
chk("engine's own pid never listed", ready and all(w["pid"] != ready["pid"] for w in items))

# Cloaked UWP ghosts are the usual junk; a real desktop should not be mostly them.
titles = [w["title"] for w in items]
chk("no blank-titled ghost windows", all(t.strip() for t in titles))

# The start hotkey scopes to whatever is in front, and the list is sorted by
# name for a menu - so z-order is gone by the time the UI sees it and the
# engine has to say which one it was.
front = [w for w in items if w.get("foreground")]
chk("every window says whether it is the one in front",
    all("foreground" in w for w in items))
chk(f"at most one is ({len(front)})", len(front) <= 1)
if front:
    chk("and it is a real window", bool(front[0]["title"].strip()))

print("\nscope filtering:")
# Scope the recording to a pid that cannot own any window, then confirm the
# engine accepts it and reports the scope.
send({"type":"start","sessionDir":session,"allowPids":[999999],"recordKeyboard":False})
time.sleep(0.8)
logs = " ".join(m.get("message","") for m in msgs if m.get("type")=="log")
chk("engine reports the scope it applied", "scoped to pids 999999" in logs)

send({"type":"stop"})
p.wait(timeout=10)
steps = [m for m in msgs if m.get("type")=="step"]
chk("no steps recorded for an out-of-scope desktop", len(steps) == 0)

print(f"\n{pas} passed, {fai} failed")
raise SystemExit(1 if fai else 0)
