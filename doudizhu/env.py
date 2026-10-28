# -*- coding: utf-8 -*-
"""强化学习环境：状态/动作编码（DouZero 风格的精简版）。

状态特征（534 维）：
  我的手牌(54) + 其余两家手牌并集(54) + 当前需压的牌(54) + 底牌(54)
  + 下一家/上一家最近动作(54×2) + 三个身份已出牌(54×3)
  + 其余两家剩余张数 one-hot(20×2) + 已出炸弹数 one-hot(8)
动作特征（54 维）：该动作打出的牌（过=全零）。
Q 网络输入 = 状态 ‖ 动作 = 588 维。
"""

import numpy as np
from collections import Counter

from .cards import cards54, full_deck
from .game import Game, LANDLORD, DOWN, UP
from .moves import MoveType

POSITIONS = (LANDLORD, DOWN, UP)
STATE_DIM = 54 * 9 + 20 * 2 + 8   # 534
ACTION_DIM = 54


def _onehot(n, size):
    v = [0.0] * size
    v[max(0, min(size - 1, n))] = 1.0
    return v


def encode_state(game, seat):
    """编码 seat 视角的信息集（不偷看他人手牌，仅用公开信息推断并集）。"""
    unseen = Counter(full_deck())
    unseen.subtract(game.hands[seat])
    for p in game.played:
        unseen.subtract(p)

    nxt, prv = (seat + 1) % 3, (seat + 2) % 3
    feats = []
    feats += cards54(game.hands[seat])
    feats += cards54(+unseen)                          # 其余两家手牌并集
    feats += cards54(game.to_beat.cards) if game.to_beat else [0.0] * 54
    feats += cards54(game.bottom)                      # 底牌（公开）
    feats += cards54(game.last_action[nxt].cards)
    feats += cards54(game.last_action[prv].cards)
    for pos in POSITIONS:                              # 按身份排列的已出牌
        feats += cards54(game.played[game.seat_of(pos)])
    feats += _onehot(game.cards_left(nxt) - 1, 20)
    feats += _onehot(game.cards_left(prv) - 1, 20)
    feats += _onehot(game.bombs, 8)
    return np.asarray(feats, dtype=np.float32)


def encode_action(move):
    if move.type == MoveType.PASS:
        return np.zeros(54, dtype=np.float32)
    return np.asarray(cards54(move.cards), dtype=np.float32)


def encode_pairs(state, moves):
    """[状态‖动作] 批量编码，形状 (len(moves), STATE_DIM+ACTION_DIM)。"""
    acts = np.stack([encode_action(m) for m in moves])
    states = np.tile(state, (len(moves), 1))
    return np.concatenate([states, acts], axis=1)


class DouDizhuEnv:
    """轻量环境：reset() 开局；obs() 给出当前行动方的信息集；step() 出牌。

    奖励在终局给出：地主胜 → 地主 +1、农民各 -1；反之取反（WP 目标）。
    """

    def __init__(self, rng=None):
        self.game = Game(rng=rng)

    def reset(self):
        self.game.reset()
        return self.obs()

    def obs(self):
        g = self.game
        seat = g.turn
        return {
            "seat": seat,
            "position": g.position(seat),
            "state": encode_state(g, seat),
            "legal_moves": g.legal_moves(),
        }

    def step(self, move):
        g = self.game
        g.step(move, check=False)
        if g.done:
            sign = 1 if g.winner_side == LANDLORD else -1
            rewards = {LANDLORD: float(sign), DOWN: float(-sign), UP: float(-sign)}
            return None, rewards, True
        return self.obs(), None, False
