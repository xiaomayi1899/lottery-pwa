# -*- coding: utf-8 -*-
"""重新生成 data/snapshot.v6.js —— 离线兜底数据（五彩种，最近约 1000 期）。
随时可重跑：python -X utf8 gen_snapshot.py"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import fetch_ssq, fetch_dlt, fetch_kl8, fetch_fc3d

ROOT = os.path.dirname(os.path.abspath(__file__))


def build(payload):
    body = "window.__SNAPSHOT__=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";"
    assert "</script" not in body.lower(), "数据中含 </script>，需要转义"
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    out = os.path.join(ROOT, "data", "snapshot.v6.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(body)
    print("已写入", out, len(body), "bytes")


def main():
    ssq = fetch_ssq(1000)
    print("双色球 %d 期（最新 %s）" % (len(ssq), ssq[-1]["issue"] if ssq else "-"))
    dlt = fetch_dlt(1000)
    print("大乐透 %d 期（最新 %s）" % (len(dlt), dlt[-1]["issue"] if dlt else "-"))
    kl8 = fetch_kl8(1000)
    print("快乐8 %d 期（最新 %s）" % (len(kl8), kl8[-1]["issue"] if kl8 else "-"))
    fc3d = fetch_fc3d(1000)
    print("福彩3D %d 期（最新 %s）" % (len(fc3d), fc3d[-1]["issue"] if fc3d else "-"))
    build({
        "builtAt": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "ssq": ssq, "dlt": dlt, "kl8": kl8, "fc3d": fc3d,
    })


if __name__ == "__main__":
    main()
