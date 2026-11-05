# -*- coding: utf-8 -*-
"""
彩票预测助手 — 本地数据服务
静态站点 + 官方开奖接口代理（双色球走福彩官网、大乐透走体彩官网、竞彩走竞彩网）。
仅使用 Python 标准库；启动后局域网内手机可直接访问。
"""
import hashlib
import io
import json
import os
import re
import socket
import ssl
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "data")
PORTS = [8788, 8789, 8790]
UA = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
}
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

GAME_TTL = 6 * 3600
JC_TTL = 45

_game_cache = {"ssq": {"t": 0.0, "list": None}, "dlt": {"t": 0.0, "list": None}}
_jc_cache = {}
LOCK = threading.Lock()


def _http_json(url, referer=None, timeout=20):
    h = dict(UA)
    if referer:
        h["Referer"] = referer
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception:
        # 官方站点证书链偶发问题：降级重试一次
        ctx2 = ssl._create_unverified_context()
        req2 = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req2, timeout=timeout, context=ctx2) as r:
            return json.loads(r.read().decode("utf-8"))


def _normalize_ssq(items):
    out, seen = [], set()
    for it in items:
        code = str(it.get("code", "")).strip()
        if not code or code in seen:
            continue
        red = [int(x) for x in str(it.get("red", "")).split(",") if x.strip().isdigit()]
        blue = [int(x) for x in str(it.get("blue", "")).split(",") if x.strip().isdigit()]
        if len(red) != 6 or len(blue) != 1:
            continue
        seen.add(code)
        out.append({"issue": code, "date": str(it.get("date", ""))[:10], "nums": sorted(red) + blue})
    out.sort(key=lambda d: d["issue"])
    return out


def _http_text_page(url, timeout=20):
    """拉取 HTML 页面（备用源 500 彩票网，GBK 编码）。"""
    h = dict(UA)
    h["Referer"] = "https://datachart.500.com/"
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            raw = r.read()
    except Exception:
        ctx2 = ssl._create_unverified_context()
        req2 = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req2, timeout=timeout, context=ctx2) as r:
            raw = r.read()
    for enc in ("gb18030", "utf-8"):
        try:
            return raw.decode(enc)
        except Exception:
            pass
    return raw.decode("utf-8", "ignore")


def _normalize_500_rows(html, front_n, back_n, ssq_full_issue=False):
    """解析 500 彩票网 history 页表格行；自动剔除 HTML 注释，5 位双色球期号补全为 7 位。"""
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)
    rows = re.findall(r'<tr[^>]*class="t_tr1"[^>]*>(.*?)</tr>', html, re.S)
    out = []
    for row in rows:
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        tds = [re.sub(r"<[^>]+>", "", t).strip() for t in tds]
        if not tds:
            continue
        code = tds[0]
        if not re.fullmatch(r"\d{5,7}", code):
            continue
        date = ""
        nums = []
        for t in tds[1:]:
            if re.fullmatch(r"\d{4}-\d{2}-\d{2}", t):
                date = t
                continue
            if re.fullmatch(r"\d{1,2}", t):
                nums.append(int(t))
        if len(nums) < front_n + back_n:
            continue
        if ssq_full_issue and len(code) == 5:
            code = "20" + code
        out.append({"issue": code, "date": date[:10],
                    "nums": sorted(nums[:front_n]) + sorted(nums[front_n:front_n + back_n])})
    out.sort(key=lambda d: d["issue"])
    return out


def fetch_ssq_500(n=1000):
    html = _http_text_page("https://datachart.500.com/ssq/history/newinc/history.php?limit=%d" % min(n, 5000))
    return _normalize_500_rows(html, 6, 1, ssq_full_issue=True)[-n:]


def fetch_ssq(n=1000):
    """双色球：福彩官方优先（国内 IP），不可达时自动改用 500 备用源。"""
    try:
        lst = fetch_ssq_cwl(n)
        if lst:
            return lst
    except Exception as e:
        print("[ssq] 福彩官方接口失败，改用备用源：%s" % str(e)[:120], file=sys.stderr)
    return fetch_ssq_500(n)


def fetch_ssq_cwl(n=1000):
    """双色球：福彩官网接口，每页 100 期（境外机房 IP 会被 403）。"""
    all_items = []
    page = 1
    while len(all_items) < n + 50 and page <= 15:
        url = ("https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
               "?name=ssq&pageNo=%d&pageSize=100&systemType=PC" % page)
        data = _http_json(url, referer="https://www.cwl.gov.cn/ygkj/wqkjgg/ssq/")
        result = (data or {}).get("result") or []
        if not result:
            break
        all_items.extend(result)
        if len(result) < 100:
            break
        page += 1
        time.sleep(0.25)
    lst = _normalize_ssq(all_items)
    return lst[-n:]


def _normalize_dlt(items):
    out, seen = [], set()
    for it in items:
        code = str(it.get("lotteryDrawNum", "")).strip()
        if not code or code in seen:
            continue
        raw = str(it.get("lotteryDrawResult", "")).replace(",", " ")
        nums = [int(p) for p in raw.split() if p.strip().isdigit()]
        if len(nums) != 7:
            continue
        seen.add(code)
        out.append({"issue": code, "date": str(it.get("lotteryDrawTime", ""))[:10],
                    "nums": sorted(nums[:5]) + sorted(nums[5:])})
    out.sort(key=lambda d: d["issue"])
    return out


def fetch_dlt_500(n=1000):
    html = _http_text_page("https://datachart.500.com/dlt/history/newinc/history.php?limit=%d" % min(n, 5000))
    return _normalize_500_rows(html, 5, 2)[-n:]


def fetch_dlt(n=1000):
    """大乐透：体彩官方优先，不可达时自动改用 500 备用源。"""
    try:
        lst = fetch_dlt_official(n)
        if lst:
            return lst
    except Exception as e:
        print("[dlt] 体彩官方接口失败，改用备用源：%s" % str(e)[:120], file=sys.stderr)
    return fetch_dlt_500(n)


def fetch_dlt_official(n=1000):
    """大乐透：体彩官网接口 gameNo=85，每页 100 期。"""
    all_items = []
    page = 1
    while len(all_items) < n + 50 and page <= 15:
        url = ("https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
               "?gameNo=85&provinceId=0&pageSize=100&isVerify=1&pageNo=%d" % page)
        data = _http_json(url, referer="https://static.sporttery.cn/")
        lst = (((data or {}).get("value") or {}).get("list")) or []
        if not lst:
            break
        all_items.extend(lst)
        if len(lst) < 100:
            break
        page += 1
        time.sleep(0.25)
    lst = _normalize_dlt(all_items)
    return lst[-n:]


FETCHERS = {"ssq": fetch_ssq, "dlt": fetch_dlt}
DISK = {"ssq": os.path.join(DATA_DIR, "cache_ssq.json"),
        "dlt": os.path.join(DATA_DIR, "cache_dlt.json")}


def _disk_save(g, lst):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(DISK[g], "w", encoding="utf-8") as f:
            json.dump({"t": time.time(), "list": lst}, f, ensure_ascii=False)
    except Exception:
        pass


def _disk_load(g):
    try:
        with open(DISK[g], "r", encoding="utf-8") as f:
            d = json.load(f)
        if isinstance(d, dict) and isinstance(d.get("list"), list) and d["list"]:
            return d["list"]
    except Exception:
        pass
    return None


def get_game(g):
    now = time.time()
    with LOCK:
        c = _game_cache[g]
        if c["list"] and now - c["t"] < GAME_TTL:
            return {"list": c["list"], "source": "内存缓存", "count": len(c["list"])}
    lst = None
    err = ""
    try:
        lst = FETCHERS[g](1000)
    except Exception as e:
        err = str(e)
    if lst:
        with LOCK:
            _game_cache[g] = {"t": time.time(), "list": lst}
        _disk_save(g, lst)
        return {"list": lst, "source": "官方接口", "count": len(lst)}
    stale = _disk_load(g)
    if stale:
        with LOCK:
            _game_cache[g] = {"t": now - GAME_TTL + 300, "list": stale}
        return {"list": stale, "source": "磁盘缓存（官方接口暂不可达）", "count": len(stale)}
    raise RuntimeError("官方接口不可达且无本地缓存: %s" % (err or "空响应"))


def _disk_save_jc(url, body):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        key = hashlib.md5(url.encode("utf-8")).hexdigest()[:16]
        with open(os.path.join(DATA_DIR, "cache_jc_%s.json" % key), "wb") as f:
            f.write(body)
    except Exception:
        pass


def _disk_load_jc(url):
    try:
        key = hashlib.md5(url.encode("utf-8")).hexdigest()[:16]
        p = os.path.join(DATA_DIR, "cache_jc_%s.json" % key)
        if time.time() - os.path.getmtime(p) < 24 * 3600:
            with open(p, "rb") as f:
                return f.read()
    except Exception:
        pass
    return None


def get_jc(pool_code):
    url = ("https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry"
           "?poolCode=%s&channel=c" % pool_code)
    now = time.time()
    with LOCK:
        hit = _jc_cache.get(url)
        if hit and hit[0] > now:
            return hit[1], "application/json; charset=utf-8"
    body = None
    try:
        h = dict(UA)
        h["Referer"] = "https://www.sporttery.cn/"
        req = urllib.request.Request(url, headers=h)
        with urllib.request.urlopen(req, timeout=15, context=CTX) as r:
            body = r.read()
    except Exception:
        body = None
    if body and len(body) > 100:
        with LOCK:
            _jc_cache[url] = (now + JC_TTL, body)
        _disk_save_jc(url, body)
        return body, "application/json; charset=utf-8"
    stale = _disk_load_jc(url)
    if stale:
        return stale, "application/json; charset=utf-8"
    raise RuntimeError("竞彩接口不可达")


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("223.5.5.5", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


QR_BYTES = {"t": 0.0, "png": None}
QR_LOCK = threading.Lock()


def qr_png():
    with QR_LOCK:
        if QR_BYTES["png"] and time.time() - QR_BYTES["t"] < 600:
            return QR_BYTES["png"]
    url = "http://%s:%d" % (lan_ip(), PORT)
    data = None
    try:
        import qrcode
        img = qrcode.make(url, box_size=8, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
    except Exception:
        try:
            with open(os.path.join(ROOT, "qr.png"), "rb") as f:
                data = f.read()
        except Exception:
            return None
    with QR_LOCK:
        QR_BYTES["t"] = time.time()
        QR_BYTES["png"] = data
    try:
        with open(os.path.join(ROOT, "qr.png"), "wb") as f:
            f.write(data)
    except Exception:
        pass
    return data


STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".md": "text/plain; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    server_version = "LPH/1.0"

    def log_message(self, fmt, *args):
        try:
            sys.stdout.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))
        except Exception:
            pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", cache="no-store"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.wfile.write(body)
        except Exception:
            pass

    def _send_json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def _static(self, rel):
        full = os.path.realpath(os.path.join(ROOT, rel))
        if not full.startswith(ROOT) or not os.path.isfile(full):
            self._send(404, '{"error":"not found"}'.encode("utf-8"))
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = STATIC_TYPES.get(ext, "application/octet-stream")
        cache = "no-cache" if ext in (".html", ".js", ".css", ".json", ".webmanifest") else "max-age=86400"
        try:
            with open(full, "rb") as f:
                body = f.read()
        except Exception:
            self._send(404, '{"error":"read failed"}'.encode("utf-8"))
            return
        self._send(200, body, ctype, cache)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        path, _, qs = self.path.partition("?")
        path = path.rstrip("/") or "/"
        if path == "/":
            return self._static("index.html")
        if path in ("/api/ssq", "/api/dlt"):
            g = path.split("/")[-1]
            n = 1000
            m = re.search(r"(?:^|&)n=(\d{1,4})", qs)
            if m:
                n = min(max(int(m.group(1)), 10), 1000)
            try:
                self._send_json(get_game(g))
            except Exception as e:
                self._send_json({"error": str(e)}, 502)
            return
        if path == "/api/jc":
            pool = "hhad,had,crs,ttg,hafu"
            m = re.search(r"(?:^|&)poolCode=([\w,]{1,80})", qs)
            if m:
                pool = m.group(1)
            try:
                body, ctype = get_jc(pool)
                self._send(200, body, ctype)
            except Exception as e:
                self._send_json({"error": str(e)}, 502)
            return
        if path == "/qr.png":
            data = qr_png()
            if data:
                return self._send(200, data, "image/png", "max-age=300")
            return self._send(404, '{"error":"qr unavailable"}'.encode("utf-8"))
        if ".." not in path:
            return self._static(path.lstrip("/"))
        self._send(404, '{"error":"not found"}'.encode("utf-8"))


PORT = 8788


def main():
    global PORT
    os.makedirs(DATA_DIR, exist_ok=True)
    srv = None
    for p in PORTS:
        try:
            srv = ThreadingHTTPServer(("0.0.0.0", p), Handler)
            PORT = p
            break
        except OSError:
            print("端口 %d 被占用，尝试下一个…" % p)
    if srv is None:
        print("错误：%s 全部被占用，请释放端口后重试。" % ", ".join(map(str, PORTS)))
        sys.exit(1)

    def prewarm():
        time.sleep(1)
        for g in ("ssq", "dlt"):
            try:
                get_game(g)
                print("[预热] %s 官方数据就绪（%d 期）" % (g, len(_game_cache[g]["list"])))
            except Exception as e:
                print("[预热] %s 失败：%s" % (g, e))

    threading.Thread(target=prewarm, daemon=True).start()

    ip = lan_ip()
    print("=" * 56)
    print("  彩票预测助手 · 本地数据服务已启动")
    print("  本机访问   http://127.0.0.1:%d" % PORT)
    print("  手机访问   http://%s:%d   （同一 Wi-Fi）" % (ip, PORT))
    print("  二维码     服务运行时打开 qr.png 或在 App「说明」页扫码")
    print("  公网访问   双击 启动公网访问.bat（手机流量可用）")
    print("  停止服务   在本窗口按 Ctrl+C")
    print("=" * 56)
    print("  仅对接国家官方彩票公开数据，仅供个人学习与娱乐。")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止。")


if __name__ == "__main__":
    main()
