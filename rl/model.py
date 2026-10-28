# -*- coding: utf-8 -*-
"""Q 网络：输入 [状态‖动作] 588 维，输出该动作的价值估计 Q(s,a)。

斗地主动作空间巨大（约 2.7 万种），无法用固定输出头枚举；
DouZero 的做法是把动作编码进输入、网络只输出一个标量，
决策时对所有合法动作批量前向、取 Q 最大者。本项目沿用该思路。
"""

import torch
import torch.nn as nn


class QNet(nn.Module):
    def __init__(self, in_dim, hidden=(512, 256, 128)):
        super().__init__()
        layers, d = [], in_dim
        for h in hidden:
            layers += [nn.Linear(d, h), nn.ReLU()]
            d = h
        layers.append(nn.Linear(d, 1))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x).squeeze(-1)
