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


def main():
    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    ssq = fetch_ssq(1000)
    print("双色球 %d 期（最新 %s）" % (len(ssq), ssq[-1]["issue"] if ssq else "-"))
    dlt = fetch_dlt(1000)
    print("大乐透 %d 期（最新 %s）" % (len(dlt), dlt[-1]["issue"] if dlt else "-"))
    write("ssq.json", {"t": now, "list": ssq})
    write("dlt.json", {"t": now, "list": dlt})
    build_snapshot(ssq, dlt)  # 同一份的数据刷进离线快照
    try:
        jc = fetch_jc()
        print("竞彩赛程 %d 场" % len(jc))
        write("jc.json", {"t": now, "list": jc})
    except Exception as e:
        print("竞彩赛程抓取失败（不影响开奖数据）:", e)


if __name__ == "__main__":
    main()
