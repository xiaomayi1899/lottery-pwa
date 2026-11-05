# -*- coding: utf-8 -*-
"""生成应用图标：icons/icon-512.png、icons/icon-192.png、apple-touch-icon.png（180）。
优先使用 AI 生成底图（icons/src.jpg），缺失时用程序绘制兜底。"""
import os
import urllib.request

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC_URL = ""  # AI 底图链接不入公开仓库；需要重生成时把底图放到 icons/src.jpg 即可


def draw_fallback():
    """程序绘制兑底：暗色渐变底 + 三颗高光彩票球 + 上升折线。"""
    S = 512
    img = Image.new("RGB", (S, S), (17, 18, 22))
    d = ImageDraw.Draw(img)
    for y in range(S):  # 垂直渐变
        t = y / S
        d.line([(0, y), (S, y)], fill=(int(26 - 10 * t), int(28 - 11 * t), int(34 - 14 * t)))
    # 上升折线（金色）+ 箭头
    pts = [(96, 300), (170, 250), (238, 276), (318, 196), (398, 128)]
    d.line(pts, fill=(230, 190, 90), width=10, joint="curve")
    ax, ay = pts[-1]
    d.polygon([(ax + 6, ay - 26), (ax + 30, ay - 2), (ax - 6, ay + 2)], fill=(230, 190, 90))

    def ball(x0, y0, x1, y1, base, hi, spec=True):
        d.ellipse((x0, y0, x1, y1), fill=base)
        hx0, hy0 = x0 + (x1 - x0) * 0.22, y0 + (y1 - y0) * 0.16
        hx1, hy1 = x0 + (x1 - x0) * 0.62, y0 + (y1 - y0) * 0.52
        d.ellipse((hx0, hy0, hx1, hy1), fill=hi)
        if spec:
            d.ellipse((x0 + (x1 - x0) * 0.30, y0 + (y1 - y0) * 0.24,
                       x0 + (x1 - x0) * 0.42, y0 + (y1 - y0) * 0.34), fill=(255, 255, 255))

    ball(118, 230, 322, 434, (196, 53, 44), (232, 108, 96))    # 红球（前）
    ball(268, 170, 400, 302, (44, 88, 188), (110, 148, 232))   # 蓝球
    ball(170, 76, 298, 204, (206, 168, 58), (240, 208, 120))   # 金球
    return img


def main():
    os.makedirs(os.path.join(ROOT, "icons"), exist_ok=True)
    src = None
    src_path = os.path.join(ROOT, "icons", "src.jpg")
    if os.path.exists(src_path):
        try:
            src = Image.open(src_path).convert("RGB")
            print("使用已下载底图", src.size)
        except Exception:
            src = None
    if src is None and SRC_URL:
        try:
            req = urllib.request.Request(SRC_URL, headers={"User-Agent": "Mozilla/5.0"})
            raw = urllib.request.urlopen(req, timeout=30).read()
            with open(src_path, "wb") as f:
                f.write(raw)
            src = Image.open(src_path).convert("RGB")
            print("已下载 AI 底图", src.size)
        except Exception as e:
            print("下载生成图失败，改用程序绘制兑底：", e)
    if src is None:
        src = draw_fallback()
    w, h = src.size
    side = min(w, h)
    src = src.crop(((w - side) // 2, (h - side) // 2, (w + side) // 2, (h + side) // 2))
    for size, name in ((512, "icons/icon-512.png"), (192, "icons/icon-192.png"), (180, "apple-touch-icon.png")):
        img = src.resize((size, size), Image.LANCZOS)
        img.save(os.path.join(ROOT, name), "PNG")
        print("已生成", name, size)


if __name__ == "__main__":
    main()
