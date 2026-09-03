import subprocess, sys, json, threading, time, os, tempfile

exe = r"capture\bin\Debug\net10.0-windows\bettersteps-capture.exe"
session = os.path.join(tempfile.gettempdir(), "bsr-smoke")

p = subprocess.Popen([exe], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                     stderr=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)

seen = []
def pump():
    for line in p.stdout:
        line = line.strip()
        if not line: continue
        seen.append(line)
        print("  <-", line[:160])
threading.Thread(target=pump, daemon=True).start()

def send(obj):
    print("  ->", json.dumps(obj))
    p.stdin.write(json.dumps(obj) + "\n"); p.stdin.flush()

time.sleep(1.0)
send({"v":1,"type":"ping","id":"1"})
time.sleep(0.4)
send({"v":1,"type":"start","id":"2","sessionDir":session})
time.sleep(0.4)
send({"v":1,"type":"bogus","id":"3"})
time.sleep(0.4)
send({"v":1,"type":"stop","id":"4"})

code = p.wait(timeout=10)
time.sleep(0.3)
print("\nexit code:", code)

types = [json.loads(l).get("type") for l in seen]
print("message types:", types)
for need in ("ready","pong","log"):
    print(("  PASS " if need in types else "  FAIL ") + need)
print("  " + ("PASS" if code == 0 else "FAIL") + " clean exit")
ready = next((json.loads(l) for l in seen if json.loads(l).get("type")=="ready"), None)
print("  " + ("PASS" if ready and ready.get("dpiAware") else "FAIL") + " per-monitor DPI awareness")
