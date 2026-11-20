# -*- coding: utf-8 -*-
# Настоящий прогон /api/swap с реальными портретами.
import base64, json, urllib.request, urllib.error, os, sys


def data_url(path):
    with open(path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode()
    return "data:image/jpeg;base64," + b64


here = os.path.dirname(os.path.abspath(__file__))
payload = {
    "target": data_url(os.path.join(here, "test-target.jpg")),
    "donor": data_url(os.path.join(here, "test-donor.jpg")),
    "targetIndex": 0,
    "donorIndex": 0,
}

req = urllib.request.Request(
    "http://127.0.0.1:7100/api/swap",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.loads(r.read().decode())
        print("HTTP", r.status, "ok =", data.get("ok"))
        print("filename:", data.get("filename"))
        print("elapsed:", data.get("elapsedMs"), "ms")
        if data.get("dataUrl"):
            out = os.path.join(here, "test-result.png")
            with open(out, "wb") as f:
                f.write(base64.b64decode(data["dataUrl"].split(",", 1)[1]))
            print("saved:", out, os.path.getsize(out), "bytes")
except urllib.error.HTTPError as e:
    print("HTTP", e.code)
    print(json.dumps(json.loads(e.read().decode()), ensure_ascii=False, indent=2)[:2000])
    sys.exit(1)
