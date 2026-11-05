# -*- coding: utf-8 -*-
"""GitHub Actions 每日任务入口：抓取最新开奖与竞彩赛程，写入 data/*.json 供 GitHub Pages 静态使用。
也可本地手动运行：python -X utf8 update_data.py"""
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import fetch_ssq, fetch_dlt, _http_json
from gen_snapshot import build as build_snapshot

ROOT = os.path.dirname(os.path.abspath(__file__))

JC_URL = ("https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry"
          "?poolCode=hhad,had,crs,ttg,hafu&channel=c")


def fetch_jc():
    """竞彩在售赛程（服务端抓取，无跨域限制），预归一化为前端直接可用的结构。"""
    j = _http_json(JC_URL, referer="https://www.sporttery.cn/")
    out = []
    for lg in ((j.get("value") or {}).get("matchInfoList") or []):
        for s in lg.get("subMatchList") or []:
            out.append({
                "id": str(s.get("matchId")),
                "num": s.get("matchNumStr") or "",
                "league": s.get("leagueAbbName") or "",
                "date": s.get("matchDate") or "",
                "time": (s.get("matchTime") or "")[:5],
                "home": s.get("homeTeamAbbName") or "",
                "away": s.get("awayTeamAbbName") or "",
                "homeRank": (s.get("homeRank") or "").replace("[", "").replace("]", ""),
                "awayRank": (s.get("awayRank") or "").replace("[", "").replace("]", ""),
                "single": 1 if s.get("bettingSingle") == 1 else 0,
                "pools": {k: s.get(k) for k in ("had", "hhad", "crs", "ttg", "hafu")},
            })
    return out


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
    """按期号合并新旧数据，保留最新 1000 期。"""
    by = {}
    for d in old_list or []:
        by[str(d["issue"])] = d
    for d in new_list or []:
        by[str(d["issue"])] = d
    out = sorted(by.values(), key=lambda d: str(d["issue"]))
    return out[-1000:]


def main():
    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    ssq = []
    dlt = []
    try:
        ssq = fetch_ssq(1000)
        print("双色球抓取 %d 期（最新 %s）" % (len(ssq), ssq[-1]["issue"] if ssq else "-"))
    except Exception as e:
        print("双色球抓取失败:", str(e)[:150])
    try:
        dlt = fetch_dlt(1000)
        print("大乐透抓取 %d 期（最新 %s）" % (len(dlt), dlt[-1]["issue"] if dlt else "-"))
    except Exception as e:
        print("大乐透抓取失败:", str(e)[:150])
    ssq_m = merge(load_existing("ssq.json"), ssq)
    dlt_m = merge(load_existing("dlt.json"), dlt)
    if not ssq_m and not dlt_m:
        print("所有数据源均不可用且无存量数据")
        sys.exit(1)
    if ssq_m:
        write("ssq.json", {"t": now, "list": ssq_m})
    if dlt_m:
        write("dlt.json", {"t": now, "list": dlt_m})
    if ssq_m and dlt_m:
        build_snapshot(ssq_m, dlt_m)  # 同一份的数据刷进离线快照
    try:
        jc = fetch_jc()
        print("竞彩赛程 %d 场" % len(jc))
        write("jc.json", {"t": now, "list": jc})
    except Exception as e:
        print("竞彩赛程抓取失败（不影响开奖数据）:", str(e)[:150])


if __name__ == "__main__":
    main()
