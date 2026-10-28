# -*- coding: utf-8 -*-
"""Deep Monte Carlo（DMC）自博弈训练 —— DouZero 的核心算法（单机精简版）。

流程：
  1. 三个身份用各自的 Q 网络 epsilon-greedy 自博弈打完一整局；
  2. 终局回报 g（地主胜：地主 +1 农民 -1，反之取反）作为该局中
     每个 (状态, 动作) 的蒙特卡洛目标；
  3. 按身份分别累积样本，攒够一批就做 MSE 回归 Q(s,a) → g；
  4. 周期性对随机基线评估胜率并保存断点。

用法:
  python train.py --episodes 5000 --max-minutes 8
"""

import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # 绕开 torch 与 conda/MKL 的 OpenMP 重复加载冲突；不经 run.ps1 启动也不崩

import argparse
import random
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from doudizhu.env import DouDizhuEnv, encode_pairs, POSITIONS
from rl.agents import DMCAgent, RandomAgent

CKPT_DIR = Path(__file__).parent / "checkpoints"
CKPT_DIR.mkdir(exist_ok=True)


def play_episode(env, agent, buffers, mixer=None, mix_rng=None, mix_prob=0.15):
    """自博弈一局，把每个决策的 [s‖a] 向量按身份暂存，终局回填目标。

    对手多样性：每局每个身份以 mix_prob 概率改由 mixer（随机智能体）代打，
    该身份当局不采样。这避免“农民总输 → 目标恒为 -1 → Q 塌缩成常数 →
    argmax 恒选过牌 → 更必输”的自博弈死循环。
    """
    obs = env.reset()
    episode = {p: [] for p in POSITIONS}
    mixed = {p: (mixer is not None and mix_rng.random() < mix_prob)
             for p in POSITIONS}
    while True:
        pos, moves = obs["position"], obs["legal_moves"]
        if mixed[pos]:
            move = mixer.act(obs)
        else:
            move = agent.act(obs)
            if len(moves) > 1:  # 只有一个选择时无学习价值
                x = encode_pairs(obs["state"], [move])[0]
                episode[pos].append(x)
        obs, rewards, done = env.step(move)
        if done:
            for p in POSITIONS:
                g = rewards[p]
                for x in episode[p]:
                    buffers[p].append((x, g))
            return rewards


def train_step(agent, optimizers, buffers, batch_size, rng):
    """对攒够一批样本的身份做一次随机小批量回归，返回各身份损失。"""
    losses = {}
    for p in POSITIONS:
        buf = buffers[p]
        if len(buf) < batch_size:
            continue
        rng.shuffle(buf)
        net, opt = agent.nets[p], optimizers[p]
        total = 0.0
        nb = 0
        for i in range(0, len(buf), batch_size):
            chunk = buf[i:i + batch_size]
            if len(chunk) < 32:
                break
            x = torch.from_numpy(np.stack([c[0] for c in chunk]))
            y = torch.tensor([c[1] for c in chunk], dtype=torch.float32)
            q = net(x)
            loss = F.mse_loss(q, y)
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item()
            nb += 1
        losses[p] = total / max(nb, 1)
        buf.clear()
    return losses


def quick_eval(agent, n_games=60, seed=999):
    """快速评估：DMC 地主 vs 随机农民、随机地主 vs DMC 农民 的地主胜率。"""
    agent.epsilon = 0.0
    res = {}
    for tag in ("dmc_landlord", "dmc_peasants"):
        wins = 0
        env = DouDizhuEnv(rng=random.Random(seed))
        rnd = RandomAgent(seed)
        for _ in range(n_games):
            obs = env.reset()
            while True:
                use_dmc = (obs["position"] == "landlord") == (tag == "dmc_landlord")
                move = agent.act(obs) if use_dmc else rnd.act(obs)
                obs, rewards, done = env.step(move)
                if done:
                    wins += rewards["landlord"] > 0
                    break
        res[tag] = wins / n_games
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--episodes", type=int, default=5000)
    ap.add_argument("--max-minutes", type=float, default=8.0)
    ap.add_argument("--batch-size", type=int, default=512)
    ap.add_argument("--flush-size", type=int, default=2048, help="单身份样本攒到该数量就训练一轮")
    ap.add_argument("--lr", type=float, default=6e-4)
    ap.add_argument("--eps-start", type=float, default=0.25)
    ap.add_argument("--eps-end", type=float, default=0.08)
    ap.add_argument("--mix-prob", type=float, default=0.15,
                    help="每局每个身份由随机智能体代打的概率（对手多样性）")
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    np.random.seed(args.seed)

    agent = DMCAgent(epsilon=args.eps_start, seed=args.seed)
    optimizers = {p: torch.optim.Adam(agent.nets[p].parameters(), lr=args.lr)
                  for p in POSITIONS}
    buffers = {p: [] for p in POSITIONS}
    env = DouDizhuEnv(rng=random.Random(args.seed))
    shuffle_rng = random.Random(args.seed + 1)
    mixer = RandomAgent(args.seed + 2)
    mix_rng = random.Random(args.seed + 3)

    t0 = time.time()
    deadline = t0 + args.max_minutes * 60
    landlord_wins = 0
    recent_losses = {}
    print(f"开始 DMC 自博弈训练: 最多 {args.episodes} 局 / {args.max_minutes} 分钟", flush=True)

    ep = 0
    for ep in range(1, args.episodes + 1):
        frac = min(1.0, (time.time() - t0) / max(deadline - t0, 1e-9))
        agent.epsilon = args.eps_start + (args.eps_end - args.eps_start) * frac

        rewards = play_episode(env, agent, buffers, mixer=mixer,
                               mix_rng=mix_rng, mix_prob=args.mix_prob)
        landlord_wins += rewards["landlord"] > 0

        losses = train_step(agent, optimizers, buffers, args.batch_size, shuffle_rng)
        recent_losses.update(losses)

        if ep % 200 == 0:
            elapsed = time.time() - t0
            loss_str = " ".join(f"{p}:{v:.3f}" for p, v in recent_losses.items())
            print(f"[{elapsed:6.0f}s] 局数={ep}  自博弈地主胜率={landlord_wins / ep:.3f}  "
                  f"eps={agent.epsilon:.3f}  速度={ep / elapsed:.1f}局/s  loss({loss_str})",
                  flush=True)
        if ep % 1000 == 0:
            agent.save(CKPT_DIR / "dmc_latest.pt")
            eps_bak = agent.epsilon
            wr = quick_eval(agent, n_games=40)
            agent.epsilon = eps_bak
            print(f"    >>> 中期评估: DMC地主 vs 随机农民 胜率={wr['dmc_landlord']:.2f} | "
                  f"随机地主 vs DMC农民 地主胜率={wr['dmc_peasants']:.2f}", flush=True)
        if time.time() > deadline:
            print(f"达到时间上限 {args.max_minutes} 分钟，停止训练。", flush=True)
            break

    agent.save(CKPT_DIR / "dmc_latest.pt")
    elapsed = time.time() - t0
    print(f"\n训练完成: 共 {ep} 局, 用时 {elapsed:.0f}s, "
          f"模型已存至 {CKPT_DIR / 'dmc_latest.pt'}", flush=True)


if __name__ == "__main__":
    main()
