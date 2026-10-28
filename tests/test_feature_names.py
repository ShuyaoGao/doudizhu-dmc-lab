# -*- coding: utf-8 -*-
"""锁住大脑面板的输入特征名：play/js/engine.js 的 FEATURE_GROUPS（名称、起点、维数）和逐维名称
必须与 doudizhu/env.py 的 encode_state / encode_action 实际拼接顺序逐段、逐维对应。

做法：在 Node 里读出 JS 的分组表和 588 个维度名；在 Python 里构造一个已知局面，
按每组的语义自己算出“应该是什么”，再和 encode_state 在该组切片里的值逐位比对。
"""
import json
import random
import shutil
import subprocess
from collections import Counter
from pathlib import Path

import pytest

from doudizhu.cards import BIG_JOKER, RANK_NAMES, SMALL_JOKER, cards54, full_deck
from doudizhu.env import ACTION_DIM, STATE_DIM, encode_action, encode_state
from doudizhu.game import Game
from doudizhu.moves import Move, MoveType

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")

DUMP = r"""
const {loadPlay} = require('./tests/js/load');
const D = loadPlay(['engine.js']).DDZ;
const names = []; for (let d = 0; d < 588; d++) names.push(D.featureName(d));
process.stdout.write(JSON.stringify({groups: D.FEATURE_GROUPS, names}));
"""


@pytest.fixture(scope="module")
def js():
    if not NODE:
        pytest.skip("没装 Node.js")
    out = subprocess.run([NODE, "-e", DUMP], cwd=ROOT, capture_output=True, check=True)
    return json.loads(out.stdout.decode("utf-8"))


def _onehot(n, size):
    v = [0.0] * size
    v[max(0, min(size - 1, n))] = 1.0
    return v


def _game():
    """打几手牌，得到一个各组都非空的局面。"""
    rng = random.Random(5)
    g = Game(rng=rng)
    while len(g.history) < 9 and not g.done:
        legal = g.legal_moves()
        g.step(legal[-1] if len(legal) > 1 else legal[0], check=False)
    return g


def test_groups_cover_588_in_order(js):
    groups = js["groups"]
    off = 0
    for gr in groups:
        assert gr["offset"] == off
        off += gr["dim"]
    assert off == STATE_DIM + ACTION_DIM == 588
    assert groups[-1]["key"] == "action" and groups[-1]["offset"] == STATE_DIM


def test_each_group_matches_encode_state(js):
    g = _game()
    seat = g.turn
    st = encode_state(g, seat)
    nxt, prv = (seat + 1) % 3, (seat + 2) % 3
    unseen = Counter(full_deck())
    unseen.subtract(g.hands[seat])
    for p in g.played:
        unseen.subtract(p)
    expect = {
        "my_hand": cards54(g.hands[seat]),
        "unseen": cards54(+unseen),
        "to_beat": cards54(g.to_beat.cards) if g.to_beat else [0.0] * 54,
        "bottom": cards54(g.bottom),
        "next_last": cards54(g.last_action[nxt].cards),
        "prev_last": cards54(g.last_action[prv].cards),
        "played_landlord": cards54(g.played[g.seat_of("landlord")]),
        "played_down": cards54(g.played[g.seat_of("down")]),
        "played_up": cards54(g.played[g.seat_of("up")]),
        "next_left": _onehot(g.cards_left(nxt) - 1, 20),
        "prev_left": _onehot(g.cards_left(prv) - 1, 20),
        "bombs": _onehot(g.bombs, 8),
    }
    for gr in js["groups"]:
        if gr["key"] == "action":
            continue
        sl = list(st[gr["offset"]:gr["offset"] + gr["dim"]])
        assert sl == expect[gr["key"]], gr["name"]
    m = Move(MoveType.TRIO_SINGLE, 7, 1, (5, 7, 7, 7))
    assert list(encode_action(m)) == cards54(m.cards)


def test_per_dim_names(js):
    names, groups = js["names"], {g["key"]: g for g in js["groups"]}
    # 牌组：只放 c 张点数 r，亮起的维度名必须正好是“r·第1张..第c张”
    for key in ("my_hand", "action"):
        gr = groups[key]
        for r in list(range(3, 16)) + [SMALL_JOKER, BIG_JOKER]:
            for c in (1, 2, 3, 4) if r < 16 else (1,):
                on = [i for i, v in enumerate(cards54([r] * c)) if v]
                got = [names[gr["offset"] + i] for i in on]
                if r >= 16:
                    want = [f"{gr['name']}·{RANK_NAMES[r]}"]
                else:
                    want = [f"{gr['name']}·{RANK_NAMES[r]}·第{k}张" for k in range(1, c + 1)]
                assert got == want
    # one-hot 组：剩余张数 n → 下标 n-1；炸弹数 b → 下标 b（最后一格是“及以上”）
    gr = groups["next_left"]
    assert names[gr["offset"] + 4] == f"{gr['name']}=5"
    gr = groups["bombs"]
    assert names[gr["offset"] + 0] == f"{gr['name']}=0"
    assert names[gr["offset"] + 7] == f"{gr['name']}=7及以上"
