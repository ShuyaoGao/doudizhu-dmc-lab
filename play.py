# -*- coding: utf-8 -*-
"""人机对战：你 vs 两个 AI（有训练断点用 DMC，否则用贪心基线）。

用法:
  python play.py            # 默认你坐 0 号位
  python play.py --seat 1

输入格式：直接敲牌面字符，如 `334455`、`TJQKA`、`XD`(王炸)、`2`；
过牌输入 `p` 或回车；`q` 退出。10 用 T 或 10 表示。
"""

import os
os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")  # 绕开 torch 与 conda/MKL 的 OpenMP 重复加载冲突；不经 run.ps1 启动也不崩

import argparse
import random
from collections import Counter
from pathlib import Path

from doudizhu.cards import fmt_cards, parse_cards
from doudizhu.env import DouDizhuEnv
from doudizhu.game import LANDLORD
from doudizhu.moves import PASS, MoveType, classify, beats
from rl.agents import DMCAgent, GreedyAgent

CKPT = Path(__file__).parent / "checkpoints" / "dmc_latest.pt"
POS_ZH = {"landlord": "地主", "down": "下家农民", "up": "上家农民"}


def pick_human_move(game, seat):
    legal = game.legal_moves()
    hand = game.hands[seat]
    leading = game.to_beat is None
    while True:
        tip = "自由出牌" if leading else f"需压过 {game.to_beat}"
        raw = input(f"  [{tip}] 你的出牌> ").strip()
        if raw.lower() == "q":
            raise SystemExit("已退出对局。")
        if raw == "" or raw.lower() == "p":
            if PASS in legal:
                return PASS
            print("  ✗ 自由出牌阶段不能过！")
            continue
        try:
            ranks = parse_cards(raw)
        except ValueError as e:
            print(f"  ✗ {e}")
            continue
        need = Counter(ranks)
        if any(hand.get(r, 0) < c for r, c in need.items()):
            print("  ✗ 你没有这些牌。")
            continue
        interp = classify(ranks)
        valid = [m for m in interp if m.type != MoveType.PASS
                 and (leading or beats(m, game.to_beat))]
        if not valid:
            if not interp or all(m.type == MoveType.PASS for m in interp):
                print("  ✗ 这不是合法牌型。")
            else:
                print(f"  ✗ {interp[0]} 压不过 {game.to_beat}。")
            continue
        return valid[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seat", type=int, default=0, choices=[0, 1, 2])
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    if CKPT.exists():
        ai = DMCAgent().load(CKPT)
        print(f"AI 使用训练模型: {CKPT}")
    else:
        ai = GreedyAgent()
        print("未找到训练模型，AI 使用贪心策略。先运行 train.py 可获得更强对手。")

    env = DouDizhuEnv(rng=random.Random(args.seed))
    obs = env.reset()
    g = env.game
    you = args.seat

    print("\n" + "=" * 60)
    print(f"你是 {you} 号位，本局身份: {POS_ZH[g.position(you)]}   "
          f"叫分: {g.base}   底牌: {fmt_cards(g.bottom)}")
    print("=" * 60)

    while True:
        seat = obs["seat"]
        pos_zh = POS_ZH[obs["position"]]
        if seat == you:
            print(f"\n—— 轮到你（{pos_zh}）"
                  f"  其余两家剩 {g.cards_left((you + 1) % 3)} / {g.cards_left((you + 2) % 3)} 张")
            print(f"  你的手牌: {fmt_cards(g.hands[you])}")
            move = pick_human_move(g, you)
        else:
            move = ai.act(obs)
        print(f"  {seat}号位({pos_zh}): {move}")
        obs, rewards, done = env.step(move)
        if done:
            print("\n" + "=" * 60)
            side = "地主" if g.winner_side == LANDLORD else "农民"
            mult_info = f"倍数 ×{g.multiplier}" + ("（含春天）" if g.spring else "")
            print(f"对局结束：{side} 获胜！  {mult_info}")
            print(f"三家得分: {g.scores}   你的得分: {g.scores[you]:+d}")
            print("=" * 60)
            break


if __name__ == "__main__":
    main()
