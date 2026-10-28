# -*- coding: utf-8 -*-
"""把 checkpoints/dmc_latest.pt（三个身份的 Q 网络）导出成浏览器能用 <script> 加载的 play/js/model_dmc.js。

权重按 float16 小端存成一个 base64 串；每层记录形状和在串里的元素偏移。
层的结构从 state_dict 实际读出（不写死），换模型时结构式跟着变。

用法:  python -m tools.export_model [--ckpt checkpoints/dmc_latest.pt] [--out play/js/model_dmc.js]
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
POSITIONS = ("landlord", "down", "up")


def load_state(ckpt):
    return torch.load(ckpt, map_location="cpu", weights_only=True)


def export(ckpt, out):
    ck = load_state(ckpt)
    chunks, nets, offset = [], {}, 0
    for pos in POSITIONS:
        sd = ck[pos]
        names = sorted({k.rsplit(".", 1)[0] for k in sd}, key=lambda s: int(s.split(".")[1]))
        layers = []
        for name in names:
            w = sd[name + ".weight"].numpy().astype(np.float16)
            b = sd[name + ".bias"].numpy().astype(np.float16)
            layers.append({"name": name, "out": int(w.shape[0]), "in": int(w.shape[1]),
                           "w": offset, "b": offset + w.size})
            chunks += [w.astype("<f2").tobytes(), b.astype("<f2").tobytes()]
            offset += w.size + b.size
        nets[pos] = {"layers": layers, "params": int(sum(v.numel() for v in sd.values()))}
    raw = b"".join(chunks)
    meta = {
        "format": "ddz-dmc-fp16/1",
        "source": "checkpoints/" + Path(ckpt).name,
        "source_sha256": hashlib.sha256(Path(ckpt).read_bytes()).hexdigest(),
        "dtype": "float16-le",
        "activation": "relu",
        "positions": list(POSITIONS),
        "nets": nets,
        "total_params": int(sum(n["params"] for n in nets.values())),
        "n_values": offset,
    }
    js = ("/* 自动生成：python -m tools.export_model；不要手改。\n"
          " * DMC 斗地主 Q 网络（地主 / 农民·下家 / 农民·上家），float16 权重。 */\n"
          "window.DDZ_MODEL = " + json.dumps(meta, ensure_ascii=False) + ";\n"
          "window.DDZ_MODEL.b64 = '" + base64.b64encode(raw).decode("ascii") + "';\n")
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(js, encoding="utf-8", newline="\n")
    return meta, len(js.encode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=str(ROOT / "checkpoints" / "dmc_latest.pt"))
    ap.add_argument("--out", default=str(ROOT / "play" / "js" / "model_dmc.js"))
    a = ap.parse_args()
    meta, size = export(a.ckpt, a.out)
    print(f"已导出 {a.out}：{meta['total_params']:,} 个参数，{size:,} 字节")


if __name__ == "__main__":
    main()
