"""Staleness detection against a real running application. No synthetic input:
this only asks the engine whether controls still exist."""
import subprocess, json, threading, time, os, tempfile

exe = os.path.join("capture","bin","Debug","net10.0-windows","bettersteps-capture.exe")
TARGET = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "KbdTarget","bin","Debug","net10.0-windows","kbdtarget.exe")

tgt = subprocess.Popen([TARGET], stdout=subprocess.PIPE, text=True, bufsize=1)
deadline = time.time() + 15
seen = 0
while time.time() < deadline and seen < 2:
    if tgt.stdout.readline().startswith("RECT"): seen += 1
time.sleep(1.0)

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     text=True, encoding="utf-8", bufsize=1)
msgs = []
threading.Thread(target=lambda: [msgs.append(json.loads(l)) for l in p.stdout if l.strip()],
                 daemon=True).start()
def send(o): p.stdin.write(json.dumps({"v":1,"id":"v1",**o})+"\n"); p.stdin.flush()
time.sleep(1.0)

items = [
  # Controls that really exist in the running target.
  {"id":"real-id",   "process":"kbdtarget.exe", "automationId":"txtPlain",
   "name":"Customer Name", "controlType":"Edit"},
  {"id":"real-name", "process":"kbdtarget.exe", "automationId":"",
   "name":"Password", "controlType":"Edit"},
  # A control that has never existed: the "vendor changed the dialog" case.
  {"id":"gone",      "process":"kbdtarget.exe", "automationId":"btnRemovedInV2",
   "name":"Removed Button", "controlType":"Button"},
  # An application that is not running at all.
  {"id":"notrunning","process":"definitely-not-here.exe", "automationId":"x",
   "name":"X", "controlType":"Button"},
  # A step that never captured anything identifying.
  {"id":"blank",     "process":"kbdtarget.exe", "automationId":"", "name":"",
   "controlType":"Pane"},
]
t0 = time.time()
send({"type":"verify","items":items})

while time.time() - t0 < 30 and not any(m.get("type")=="verified" for m in msgs):
    time.sleep(0.4)
elapsed = time.time() - t0

send({"type":"stop"}); p.wait(timeout=10)
tgt.terminate()

res = next((m for m in msgs if m.get("type")=="verified"), None)
pas = fai = 0
def chk(n, c):
    global pas, fai
    if c: pas += 1; print("  PASS " + n)
    else: fai += 1; print("  FAIL " + n)

print(f"verification took {elapsed:.1f}s")
assert res, "engine never answered"
by = {i["id"]: i for i in res["items"]}
for i in res["items"]:
    print(f"  {i['id']:<12} {i['status']:<14} matchedBy={i.get('matchedBy')} window={i.get('window')}")

print("\nchecks:")
chk("answers every item", len(res["items"]) == len(items))
chk("finds a control by automation id",
    by["real-id"]["status"] == "match" and by["real-id"]["matchedBy"] == "automationId")
chk("finds a control by name and type", by["real-name"]["status"] == "match")
chk("reports a control that no longer exists", by["gone"]["status"] == "missing")
chk("reports an application that is not running", by["notrunning"]["status"] == "appNotRunning")
chk("says nothing about a step with no captured target", by["blank"]["status"] == "noTarget")
chk("completes well inside its budget", elapsed < 20)
print(f"\n{pas} passed, {fai} failed")
