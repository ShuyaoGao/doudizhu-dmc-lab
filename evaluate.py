# -*- coding: utf-8 -*-
"""评估：让不同智能体组合对战，统计地主胜率与平均得分。

用法:
  python evaluate.py --games 200
"""

import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # 绕开 torch 与 conda/MKL 的 OpenMP 重复加载冲突；不经 run.ps1 启动也不崩

import argparse
import random
from pathlib import Path

from doudizhu.env import DouDizhuEnv
from doudizhu.game import LANDLORD
from rl.agents import DMCAgent, GreedyAgent, RandomAgent

CKPT = Path(__file__).parent / "checkpoints" / "dmc_latest.pt"


def play_match(landlord_agent, peasant_agent, n_games, seed):
    """固定身份对战 n 局，返回 (地主胜率, 地主平均得分)。"""
    env = DouDizhuEnv(rng=random.Random(seed))
    wins, score_sum = 0, 0
    for _ in range(n_games):
        obs = env.reset()
        while True:
            agent = landlord_agent if obs["position"] == LANDLORD else peasant_agent
            move = agent.act(obs)
            obs, rewards, done = env.step(move)
            if done:
                wins += rewards[LANDLORD] > 0
                score_sum += env.game.scores[env.game.landlord_seat]
                break
    return wins / n_games, score_sum / n_games


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed", type=int, default=2026)
    args = ap.parse_args()

    agents = {"随机": RandomAgent(args.seed), "贪心": GreedyAgent()}
    if CKPT.exists():
        agents["DMC"] = DMCAgent().load(CKPT)
        print(f"已加载训练模型: {CKPT}\n")
    else:
        print("未找到训练断点，只评估基线。\n")

    matchups = [
        ("随机", "随机"), ("贪心", "随机"), ("随机", "贪心"), ("贪心", "贪心"),
    ]
    if "DMC" in agents:
        matchups += [
            ("DMC", "随机"), ("随机", "DMC"),
            ("DMC", "贪心"), ("贪心", "DMC"),
            ("DMC", "DMC"),
        ]

    print(f"每组对战 {args.games} 局（叫分制定地主，地主胜率含强弱手牌因素）")
    print("=" * 64)
    print(f"{'地主':<8}{'农民':<8}{'地主胜率':>10}{'地主平均得分':>14}")
    print("-" * 64)
    lines = []
    for l_name, p_name in matchups:
        wr, avg = play_match(agents[l_name], agents[p_name], args.games, args.seed)
        line = f"{l_name:<8}{p_name:<8}{wr:>9.1%}{avg:>14.2f}"
        print(line, flush=True)
        lines.append(line)
    print("=" * 64)

    out = Path(__file__).parent / "results"
    out.mkdir(exist_ok=True)
    (out / "eval_results.txt").write_text(
        f"每组 {args.games} 局\n地主/农民/地主胜率/地主平均得分\n" + "\n".join(lines),
        encoding="utf-8")
    print(f"结果已保存至 {out / 'eval_results.txt'}")


if __name__ == "__main__":
    main()
