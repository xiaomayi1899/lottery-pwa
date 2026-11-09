# -*- coding: utf-8 -*-
"""GitHub Actions 每日任务入口：抓取五个彩种最新开奖，写入 data/*.json 供 GitHub Pages 静态使用。
也可本地手动运行：python -X utf8 update_data.py"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import fetch_ssq, fetch_dlt, fetch_kl8, fetch_fc3d, fetch_p5
from gen_snapshot import build as build_snapshot

ROOT = os.path.dirname(os.path.abspath(__file__))
GAMES = ("ssq", "dlt", "kl8", "fc3d", "p5")
FETCHERS = {"ssq": fetch_ssq, "dlt": fetch_dlt, "kl8": fetch_kl8, "fc3d": fetch_fc3d, "p5": fetch_p5}


def write(name, obj):
    os.makedirs(os.path.join(ROOT, "data"), exist_ok=True)
    p = os.path.join(ROOT, "data", name)
    with open(p, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    print("已写入 data/%s %d bytes" % (name, os.path.getsize(p)))


def load_existing(name):
    try:
        with open(os.path.join(ROOT, "data", name), "r", encoding="utf-8") as f:
            d = json.load(f)
        return d.get("list") or []
    except Exception:
        return []


def merge(old_list, new_list):
    by = {}
    for d in old_list or []:
        by[str(d["issue"])] = d
    for d in new_list or []:
        by[str(d["issue"])] = d
    out = sorted(by.values(), key=lambda d: str(d["issue"]))
    return out[-1000:]


def main():
    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    results = {}
    for g in GAMES:
        try:
            lst = FETCHERS[g](1000)
            print("%s 抓取 %d 期（最新 %s）" % (g, len(lst), lst[-1]["issue"] if lst else "-"))
            results[g] = lst
        except Exception as e:
            print("%s 抓取失败:" % g, str(e)[:150])
            results[g] = []
    merged = {}
    for g in GAMES:
        m = merge(load_existing(g + ".json"), results[g])
        merged[g] = m
        if m:
            write(g + ".json", {"t": now, "list": m})
    build_snapshot({g: merged[g] for g in GAMES})


if __name__ == "__main__":
    main()
