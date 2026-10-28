# -*- coding: utf-8 -*-
"""三类智能体：随机、贪心（规则基线）、DMC（深度蒙特卡洛，可学习）。"""

import random

import numpy as np
import torch

from doudizhu.env import encode_pairs, encode_state, STATE_DIM, ACTION_DIM, POSITIONS
from doudizhu.moves import MoveType, PASS
from .model import QNet


class RandomAgent:
    """在合法动作中均匀随机选择。"""

    def __init__(self, seed=None):
        self.rng = random.Random(seed)

    def act(self, obs):
        return self.rng.choice(obs["legal_moves"])


class GreedyAgent:
    """规则贪心：自由出牌时打张数最多/最小的牌，压牌时打最小能压的牌；
    非必要不动炸弹。这是比随机强得多的基线。"""

    def act(self, obs):
        moves = obs["legal_moves"]
        normal = [m for m in moves
                  if m.type not in (MoveType.PASS, MoveType.BOMB, MoveType.ROCKET)]
        leading = PASS not in moves
        if leading:
            pool = normal or moves
            return min(pool, key=lambda m: (-len(m.cards), m.main))
        if normal:
            return min(normal, key=lambda m: (m.main, len(m.cards)))
        bombs = [m for m in moves if m.type in (MoveType.BOMB, MoveType.ROCKET)]
        if bombs:
            return min(bombs, key=lambda m: m.main)
        return PASS


class DMCAgent:
    """深度蒙特卡洛智能体：三个身份（地主/下家/上家）各一张 Q 网络。

    决策：epsilon-greedy；对每个合法动作算 Q(s,a) 取最大。
    """

    def __init__(self, device="cpu", epsilon=0.0, seed=None):
        self.device = device
        self.epsilon = epsilon
        self.rng = random.Random(seed)
        in_dim = STATE_DIM + ACTION_DIM
        self.nets = {p: QNet(in_dim).to(device) for p in POSITIONS}

    @torch.no_grad()
    def act(self, obs):
        moves = obs["legal_moves"]
        if len(moves) == 1:
            return moves[0]
        if self.epsilon > 0 and self.rng.random() < self.epsilon:
            return self.rng.choice(moves)
        x = encode_pairs(obs["state"], moves)
        q = self.nets[obs["position"]](torch.from_numpy(x).to(self.device))
        # 微噪声随机打破并列：防止 Q 塌缩成常数时 argmax 恒选首个动作
        #（合法动作列表首位是“过”，否则会陷入“永远过牌”的退化均衡）
        q = q + 1e-3 * torch.rand_like(q)
        return moves[int(torch.argmax(q).item())]

    # ------------------------------------------------------------ 存取
    def save(self, path):
        torch.save({p: n.state_dict() for p, n in self.nets.items()}, path)

    def load(self, path):
        ckpt = torch.load(path, map_location=self.device, weights_only=True)
        for p, n in self.nets.items():
            n.load_state_dict(ckpt[p])
        return self
