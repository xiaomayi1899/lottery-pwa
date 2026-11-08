# -*- coding: utf-8 -*-
"""重新生成 data/snapshot.js —— 断网或服务不可用时的离线兜底数据（最近约 1000 期）。
随时可重跑：python -X utf8 gen_snapshot.py"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import fetch_ssq, fetch_dlt

ROOT = os.path.dirname(os.path.abspath(__file__))


def build(ssq, dlt):
    payload = {
        "builtAt": datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "ssq": ssq,
        "dlt": dlt,
    }
    body = "window.__SNAPSHOT__=" + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";"
    assert "</script" not in body.lower(), "数据中含 </script>，需要转义"
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    out = os.path.join(ROOT, "data", "snapshot.v5.js")
    with open(out, "w", encoding="utf-8") as f:
        f.write(body)
    print("已写入", out, len(body), "bytes")


def main():
    ssq = fetch_ssq(1000)
    print("双色球 %d 期（最新 %s）" % (len(ssq), ssq[-1]["issue"] if ssq else "-"))
    dlt = fetch_dlt(1000)
    print("大乐透 %d 期（最新 %s）" % (len(dlt), dlt[-1]["issue"] if dlt else "-"))
    build(ssq, dlt)


if __name__ == "__main__":
    main()
