# -*- coding: utf-8 -*-
"""固定种子重跑评估，生成 results/result.json（README 和页面里的成绩数字都以它为准）。

两部分，规则与原脚本完全相同：
  1. evaluate.py 的组合对战：直接调用 evaluate.play_match（每组 200 局，seed 2026）；
  2. stats_rl_vs_rl.py 的 RL vs RL 同桌统计：同一套循环（500 局，seed 777）。

和直接跑原脚本的唯一区别：每一组开始前 torch.manual_seed(种子)。DMC 智能体用 torch.rand_like 加
1e-3 微噪声打破 Q 值并列，这个噪声来自 torch 的全局随机数，不设种子就谈不上“可复现”。
原脚本没有改动。

用法:  python -m tools.run_eval [--games 200] [--seed 2026] [--rl-games 500] [--rl-seed 777]
"""
import argparse
import json
import os
import platform
import random
import sys
import time
from collections import Counter
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import torch

import evaluate
from doudizhu.env import DouDizhuEnv
from doudizhu.game import LANDLORD
from rl.agents import DMCAgent, GreedyAgent, RandomAgent

CKPT = ROOT / "checkpoints" / "dmc_latest.pt"
NAMES = {"随机": "random", "贪心": "greedy", "DMC": "dmc"}


def rl_vs_rl(agent, n, seed):
    """与 stats_rl_vs_rl.main 相同的统计循环。"""
    env = DouDizhuEnv(rng=random.Random(seed))
    landlord_wins = spring_cnt = bombs_total = mult_total = score_landlord = steps_total = 0
    base_cnt = Counter()
    for _ in range(n):
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
    return {
        "games": n, "seed": seed,
        "landlord_win_rate": round(landlord_wins / n, 4),
        "bid_counts": {str(k): base_cnt[k] for k in (1, 2, 3)},
        "bombs_per_game": round(bombs_total / n, 3),
        "spring_games": spring_cnt,
        "avg_multiplier": round(mult_total / n, 3),
        "landlord_avg_score": round(score_landlord / n, 3),
        "avg_steps_incl_pass": round(steps_total / n, 2),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=200)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--rl-games", type=int, default=500)
    ap.add_argument("--rl-seed", type=int, default=777)
    ap.add_argument("--out", default=str(ROOT / "results" / "result.json"))
    a = ap.parse_args()
    torch.set_num_threads(1)
    t0 = time.time()

    agents = {"随机": RandomAgent(a.seed), "贪心": GreedyAgent(), "DMC": DMCAgent().load(CKPT)}
    matchups = [("随机", "随机"), ("贪心", "随机"), ("随机", "贪心"), ("贪心", "贪心"),
                ("DMC", "随机"), ("随机", "DMC"), ("DMC", "贪心"), ("贪心", "DMC"), ("DMC", "DMC")]
    rows, log = {}, []
    for l_name, p_name in matchups:
        torch.manual_seed(a.seed)
        wr, avg = evaluate.play_match(agents[l_name], agents[p_name], a.games, a.seed)
        key = f"{NAMES[l_name]}_vs_{NAMES[p_name]}"
        rows[key] = {"landlord": l_name, "peasants": p_name, "games": a.games,
                     "landlord_win_rate": round(wr, 4), "landlord_avg_score": round(avg, 3)}
        line = f"{l_name:<6}{p_name:<6}{wr:>8.1%}{avg:>10.2f}"
        print(line, flush=True)
        log.append(line)

    torch.manual_seed(a.rl_seed)
    rl = rl_vs_rl(agents["DMC"], a.rl_games, a.rl_seed)
    print(json.dumps(rl, ensure_ascii=False), flush=True)

    result = {
        "format": "doudizhu-dmc-lab/result/1",
        "model": {"checkpoint": "checkpoints/dmc_latest.pt",
                  "arch": "588 -> 512 -> 256 -> 128 -> 1 (ReLU MLP), 3 nets (landlord/down/up)",
                  "params_per_net": int(sum(p.numel() for p in agents["DMC"].nets["landlord"].parameters())),
                  "params_total": int(sum(p.numel() for n in agents["DMC"].nets.values() for p in n.parameters())),
                  "training_steps": None, "training_time": None,
                  "training_note": "训练步数和用时未记录；重新训练命令见 README"},
        "eval": {"script": "evaluate.py (play_match) via tools/run_eval.py", "games_per_matchup": a.games,
                 "seed": a.seed, "bidding": "heuristic_bid（叫分制定地主）", "matchups": rows},
        "rl_vs_rl": dict(rl, script="stats_rl_vs_rl.py 同一套统计循环 via tools/run_eval.py"),
        "env": {"python": platform.python_version(), "torch": torch.__version__, "numpy": np.__version__,
                "platform": platform.system()},
        "elapsed_seconds": round(time.time() - t0, 1),
    }
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    (out.parent / "eval_log.txt").write_text(
        f"python -m tools.run_eval --games {a.games} --seed {a.seed} --rl-games {a.rl_games} --rl-seed {a.rl_seed}\n"
        "地主/农民/地主胜率/地主平均得分\n" + "\n".join(log) + "\n\nRL vs RL\n" +
        json.dumps(rl, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写入 {out}（{result['elapsed_seconds']} 秒）")


if __name__ == "__main__":
    main()
