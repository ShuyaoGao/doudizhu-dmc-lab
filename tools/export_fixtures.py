# -*- coding: utf-8 -*-
"""用 Python 引擎和 PyTorch 生成“标准答案”夹具，给 JS 版做差分测试（tests/js/*.js）。

  tests/fixtures/engine_cases.json   随机手牌 × 随机要压的牌 → gen_legal 全列表（含顺序）；classify；heuristic_bid
  tests/fixtures/game_cases.json     完整对局：开局设定 + 每一步的合法动作列表、534 维状态（亮着的下标）、
                                     实际出牌；终局得分/倍数/春天
  tests/fixtures/parity_cases.json   DMC 决策局面：状态、候选、PyTorch 的 Q（原始 fp32 权重、fp16 反量化权重各一份）

用法:  python -m tools.export_fixtures [--games 40] [--seed 2026]
"""
import argparse
import json
import os
import random
import sys
from collections import Counter
from pathlib import Path

os.environ.setdefault("KMP_DUPLICATE_LIB_OK", "TRUE")
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np
import torch

from doudizhu.cards import deal, full_deck
from doudizhu.env import encode_pairs, encode_state
from doudizhu.game import Game, heuristic_bid
from doudizhu.moves import classify, gen_all, gen_legal
from rl.agents import DMCAgent, GreedyAgent, RandomAgent

OUT = ROOT / "tests" / "fixtures"
CKPT = ROOT / "checkpoints" / "dmc_latest.pt"


def mv(m):
    return [int(m.type), int(m.main), int(m.length), [int(c) for c in m.cards]]


def counts_list(c):
    return sorted(int(r) for r in Counter(c).elements())


def engine_cases(rng, n=600):
    cases = []
    deck = full_deck()
    for i in range(n):
        size = rng.choice([rng.randint(1, 20), 17, 20, rng.randint(8, 20)])
        hand = Counter(rng.sample(deck, size))
        last = None
        if rng.random() < 0.7:
            other = Counter(rng.sample(deck, rng.randint(1, 20)))
            last = rng.choice(gen_all(other))
        legal = gen_legal(hand, last)
        cases.append({"hand": counts_list(hand), "last": mv(last) if last else None,
                      "legal": [mv(m) for m in legal]})
    # 特意构造的组合爆炸手牌（触发翅膀组合上限 200）
    for text in ([3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 7, 8, 9, 10, 11, 12, 16, 17],
                 [3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 7, 8, 9, 10, 11, 16, 17],
                 [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12, 13, 13, 13, 3, 4, 5, 6, 7]):
        hand = Counter(text)
        cases.append({"hand": counts_list(hand), "last": None,
                      "legal": [mv(m) for m in gen_legal(hand, None)]})
    cls = []
    for i in range(1500):
        hand = rng.sample(deck, rng.randint(1, 12))
        cls.append({"cards": sorted(hand), "out": [mv(m) for m in classify(hand)]})
    # 从合法动作里取样，保证 classify 覆盖各种牌型
    for i in range(400):
        hand = Counter(rng.sample(deck, 20))
        m = rng.choice(gen_all(hand))
        cls.append({"cards": list(m.cards), "out": [mv(x) for x in classify(list(m.cards))]})
    bids = []
    for i in range(300):
        hands, _ = deal(rng)
        bids.append({"hand": counts_list(hands[0]), "bid": heuristic_bid(hands[0])})
    return {"legal": cases, "classify": cls, "bids": bids}


def snapshot_setup(rng):
    """发牌 + 启发式叫分，返回 (hands, bottom, landlord, base) —— 与 Game._deal_and_bid 同一规则。"""
    while True:
        hands, bottom = deal(rng)
        first = rng.randrange(3)
        best_seat, best_bid = None, 0
        for i in range(3):
            seat = (first + i) % 3
            b = heuristic_bid(hands[seat])
            b = b if b > best_bid else 0
            if b > best_bid:
                best_seat, best_bid = seat, b
                if b == 3:
                    break
        if best_seat is not None:
            return hands, bottom, best_seat, best_bid


def game_and_parity_cases(rng, n_games, agent32, agent16):
    games, parity = [], []
    rnd, greedy = RandomAgent(rng.random()), GreedyAgent()
    for gi in range(n_games):
        hands, bottom, L, base = snapshot_setup(rng)
        rec = {"hands": [counts_list(h) for h in hands], "bottom": sorted(bottom),
               "landlord": L, "base": base, "steps": []}
        g = Game.from_setup(hands, bottom, L, base)
        style = ("dmc", "greedy", "random")[gi % 3]
        while not g.done:
            seat, pos = g.turn, g.position(g.turn)
            legal = g.legal_moves()
            st = encode_state(g, seat)
            obs = {"seat": seat, "position": pos, "state": st, "legal_moves": legal}
            if style == "dmc":
                move = agent32.act(obs)
            elif style == "greedy":
                move = greedy.act(obs)
            else:
                move = rnd.act(obs)
            rec["steps"].append({"seat": seat, "position": pos,
                                 "state_on": [int(i) for i in np.flatnonzero(st)],
                                 "legal": [mv(m) for m in legal], "move": mv(move)})
            if len(legal) > 1 and (len(parity) < 400 or len(legal) > 60):
                x = torch.from_numpy(encode_pairs(st, legal))
                with torch.no_grad():
                    q32 = agent32.nets[pos](x).numpy()
                    q16 = agent16.nets[pos](x).numpy()
                parity.append({"position": pos, "state_on": [int(i) for i in np.flatnonzero(st)],
                               "legal": [mv(m) for m in legal],
                               "q_fp32": [float(v) for v in q32], "q_fp16w": [float(v) for v in q16]})
            g.step(move, check=False)
        rec["result"] = {"winner_side": g.winner_side, "scores": g.scores,
                         "multiplier": g.multiplier, "spring": bool(g.spring), "bombs": g.bombs}
        games.append(rec)
    return games, parity


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--games", type=int, default=45)
    ap.add_argument("--seed", type=int, default=2026)
    a = ap.parse_args()
    torch.manual_seed(a.seed)
    torch.set_num_threads(1)
    rng = random.Random(a.seed)
    agent32 = DMCAgent(seed=a.seed).load(CKPT)
    agent16 = DMCAgent(seed=a.seed).load(CKPT)
    for n in agent16.nets.values():
        for p in n.parameters():
            p.data = p.data.half().float()
    OUT.mkdir(parents=True, exist_ok=True)
    eng = engine_cases(rng)
    (OUT / "engine_cases.json").write_text(json.dumps(eng, separators=(",", ":")), encoding="utf-8")
    games, parity = game_and_parity_cases(rng, a.games, agent32, agent16)
    (OUT / "game_cases.json").write_text(json.dumps(games, separators=(",", ":")), encoding="utf-8")
    (OUT / "parity_cases.json").write_text(json.dumps(parity, separators=(",", ":")), encoding="utf-8")
    print(f"engine: legal {len(eng['legal'])} / classify {len(eng['classify'])} / bids {len(eng['bids'])}；"
          f"games {len(games)}（{sum(len(g['steps']) for g in games)} 步）；parity {len(parity)} 个局面")


if __name__ == "__main__":
    main()
