# -*- coding: utf-8 -*-
"""RL vs RL：三个 DMC 网络同桌对打的详细统计。

用法: python stats_rl_vs_rl.py --games 500
"""

import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # 绕开 torch 与 conda/MKL 的 OpenMP 重复加载冲突；不经 run.ps1 启动也不崩

import argparse
import random
from collections import Counter
from pathlib import Path

from doudizhu.env import DouDizhuEnv
from doudizhu.game import LANDLORD
from rl.agents import DMCAgent

CKPT = Path(__file__).parent / "checkpoints" / "dmc_latest.pt"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=500)
    ap.add_argument("--seed", type=int, default=777)
    args = ap.parse_args()

    agent = DMCAgent().load(CKPT)
    env = DouDizhuEnv(rng=random.Random(args.seed))

    n = args.games
    landlord_wins = 0
    spring_cnt = 0
    bombs_total = 0
    mult_total = 0
    base_cnt = Counter()
    score_landlord = 0
    steps_total = 0

    for i in range(n):
        obs = env.reset()
        g = env.game
        base_cnt[g.base] += 1
        steps = 0
        while True:
            move = agent.act(obs)
            obs, rewards, done = env.step(move)
            steps += 1
            if done:
                landlord_wins += rewards[LANDLORD] > 0
                spring_cnt += g.spring
                bombs_total += g.bombs
                mult_total += g.multiplier
                score_landlord += g.scores[g.landlord_seat]
                steps_total += steps
                break
        if (i + 1) % 100 == 0:
            print(f"  ... 已完成 {i + 1}/{n} 局", flush=True)

    lines = [
        f"RL vs RL（三个 DMC 网络互打）共 {n} 局",
        "=" * 46,
        f"地主胜率        : {landlord_wins / n:.1%}   （农民方 {1 - landlord_wins / n:.1%}）",
        f"叫分分布        : 1分 {base_cnt[1]} 局 / 2分 {base_cnt[2]} 局 / 3分 {base_cnt[3]} 局",
        f"平均每局炸弹/王炸: {bombs_total / n:.2f} 个",
        f"春天/反春天次数 : {spring_cnt} 局（{spring_cnt / n:.1%}）",
        f"平均倍数        : ×{mult_total / n:.2f}",
        f"地主平均得分    : {score_landlord / n:+.2f}",
        f"平均每局步数    : {steps_total / n:.1f} 手（含过牌）",
    ]
    text = "\n".join(lines)
    print("\n" + text)
    out = Path(__file__).parent / "results"
    out.mkdir(exist_ok=True)
    (out / "rl_vs_rl.txt").write_text(text, encoding="utf-8")
    print(f"\n已保存至 {out / 'rl_vs_rl.txt'}")


if __name__ == "__main__":
    main()
