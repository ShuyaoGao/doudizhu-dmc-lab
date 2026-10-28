# -*- coding: utf-8 -*-
"""截 README 用的截图到 docs/img/（一次只开一个浏览器）。

  python -m tools.screenshots

电脑尺寸（1920×1080、1366×768）用 tools/edge.py 无头 Edge 的 --window-size；
手机尺寸（390×844，DPR 3，触屏）用 tools/mobile_check.py（Playwright + DevTools 协议模拟，--window-size 截不出真实的手机布局）。
没装 Playwright 时只截电脑图。
"""
import shutil
import tempfile
from pathlib import Path

from tools import edge, mobile_check

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "docs" / "img"
DESKTOP = [
    ("screenshot-watch.png", "demo=watch&steps=30&cand=1", "1920,1080"),
    ("screenshot-all.png", "demo=watch&steps=45&view=all&big=1", "1920,1080"),
    ("screenshot-play.png", "demo=play&steps=10", "1366,768"),
]
PHONE = {"name": "m390x844", "kind": "mobile", "w": 390, "h": 844, "dpr": 3}
MOBILE = [
    ("screenshot-mobile-play.png", "demo=play&steps=10", "play"),
    ("screenshot-mobile-watch.png", "demo=watch&steps=30", "watch"),
]


def mobile_shot(name, query, mode):
    url = (ROOT / "play" / "index.html").resolve().as_uri() + "?" + query
    tmp = Path(tempfile.mkdtemp(prefix="ddz_shot_"))

    def scenario(page, size):
        page.wait_for_function("() => document.title === 'DEMO:READY'", timeout=30000)
        if mode == "play":
            page.evaluate("() => { DDZApp.hint(); }")   # 让网络替我选好牌，截图里能看到抬起的牌
        page.wait_for_timeout(200)
        return []

    rep = mobile_check.run(url, tmp, scenario=scenario, sizes=[PHONE], settle_ms=600)
    ok = rep["ok"] and Path(rep["sizes"][0]["screenshot"]).exists()
    if ok:
        shutil.copy2(rep["sizes"][0]["screenshot"], OUT / name)
    shutil.rmtree(tmp, ignore_errors=True)
    return ok


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, query, size in DESKTOP:
        edge.wait_for_memory(1.5)
        ok = edge.shot(OUT / name, query, size)
        print(("已保存 " if ok else "失败 ") + str((OUT / name).relative_to(ROOT)))
    try:
        import playwright.sync_api  # noqa: F401
    except Exception:
        print("没装 Playwright，跳过手机截图")
        return
    for name, query, mode in MOBILE:
        ok = mobile_shot(name, query, mode)
        print(("已保存 " if ok else "失败 ") + str((OUT / name).relative_to(ROOT)))


if __name__ == "__main__":
    main()
