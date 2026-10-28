# -*- coding: utf-8 -*-
"""一条命令构建静态网页包 play/（以及发布用的 zip）。

  python -m tools.build             重新生成 play/js/model_dmc.js、play/js/credits.js
  python -m tools.build --release   另外打包 release/<REPO_NAME>-v<VERSION>.zip（play/ + 根目录 index.html，zip 不进仓库）

play/ 是纯静态网页：双击 play/index.html 即可运行，不需要 Python、不需要联网。
"""
import argparse
import json
import zipfile
from pathlib import Path

from tools import export_model

ROOT = Path(__file__).resolve().parents[1]
PLAY = ROOT / "play"


def load_credits():
    return json.loads((ROOT / "credits.json").read_text(encoding="utf-8"))


def write_credits(credits):
    keep = {k: v for k, v in credits.items() if not k.startswith("_")}
    js = ("/* 自动生成：python -m tools.build（来自 credits.json）；不要手改。 */\n"
          "window.DDZ_CREDITS = " + json.dumps(keep, ensure_ascii=False, indent=1) + ";\n")
    (PLAY / "js" / "credits.js").write_text(js, encoding="utf-8", newline="\n")


def build(release=False):
    credits = load_credits()
    meta, size = export_model.export(ROOT / "checkpoints" / "dmc_latest.pt", PLAY / "js" / "model_dmc.js")
    write_credits(credits)
    files = sorted(p for p in PLAY.rglob("*") if p.is_file())
    total = sum(p.stat().st_size for p in files)
    print(f"play/：{len(files)} 个文件，{total:,} 字节（模型 {size:,} 字节，{meta['total_params']:,} 个参数）")
    if release:
        out = ROOT / "release" / f"{credits['REPO_NAME']}-v{credits['VERSION']}.zip"
        out.parent.mkdir(exist_ok=True)
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for p in files:
                z.write(p, Path("play") / p.relative_to(PLAY))
            if (ROOT / "index.html").exists():   # 根目录跳转页：解压后双击 index.html 就能进 play/
                z.write(ROOT / "index.html", "index.html")
        print(f"发布包：{out.relative_to(ROOT)}，{out.stat().st_size:,} 字节")
        return out
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", action="store_true", help="同时打包 release/*.zip")
    build(ap.parse_args().release)


if __name__ == "__main__":
    main()
