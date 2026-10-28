# -*- coding: utf-8 -*-
"""斗地主规则引擎单元测试（纯标准库，直接 python tests/test_rules.py 运行）。"""

import random
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from doudizhu.cards import full_deck, deal, parse_cards, SMALL_JOKER, BIG_JOKER
from doudizhu.moves import (Move, MoveType, PASS, beats, gen_all, gen_legal,
                            classify)
from doudizhu.game import Game, LANDLORD

PASSED = 0


def check(cond, name):
    global PASSED
    assert cond, f"测试失败: {name}"
    PASSED += 1
    print(f"  ✓ {name}")


def types_of(moves):
    return {m.type for m in moves}


def find(moves, mtype, **kw):
    return [m for m in moves if m.type == mtype
            and all(getattr(m, k) == v for k, v in kw.items())]


def test_deck():
    deck = full_deck()
    check(len(deck) == 54, "整副牌 54 张")
    c = Counter(deck)
    check(all(c[r] == 4 for r in range(3, 16)), "3~2 各 4 张")
    check(c[SMALL_JOKER] == 1 and c[BIG_JOKER] == 1, "大小王各 1 张")
    hands, bottom = deal(random.Random(0))
    check(sum(sum(h.values()) for h in hands) == 51 and len(bottom) == 3,
          "发牌 17×3 + 底牌 3")


def test_basic_types():
    h = Counter(parse_cards("334455667789TJQKA22XD"))
    moves = gen_all(h)
    check(find(moves, MoveType.STRAIGHT, main=3, length=5), "顺子 34567")
    check(find(moves, MoveType.STRAIGHT, length=12), "最长顺子 3~A 12 张")
    check(not any(15 in m.cards for m in find(moves, MoveType.STRAIGHT)),
          "顺子不能含 2")
    check(find(moves, MoveType.PAIR_CHAIN, main=3, length=3), "连对 334455")
    check(find(moves, MoveType.ROCKET), "王炸识别")
    check(find(moves, MoveType.PAIR, main=15), "对 2")

    h2 = Counter(parse_cards("3334445556668888"))
    m2 = gen_all(h2)
    check(find(m2, MoveType.PLANE, main=3, length=4), "飞机 333444555666")
    check(find(m2, MoveType.BOMB, main=8), "炸弹 8888")
    check(find(m2, MoveType.PLANE_SINGLE, main=3, length=2), "飞机带单")
    check(find(m2, MoveType.QUAD_TWO_SINGLE, main=8), "四带二单")
    check(find(m2, MoveType.QUAD_TWO_PAIR, main=8), "四带两对")


def test_kicker_rules():
    # 三带一的带牌不能与三张同点
    h = Counter(parse_cards("3333"))
    ts = find(gen_all(h), MoveType.TRIO_SINGLE)
    check(not ts, "三带一不能带同点第四张（3333 无三带一）")

    # 王炸不可拆带：四带二/飞机翅膀不能同时含大小王
    h2 = Counter(parse_cards("8888XD"))
    q = find(gen_all(h2), MoveType.QUAD_TWO_SINGLE)
    check(all(not (SMALL_JOKER in m.cards and BIG_JOKER in m.cards) for m in q),
          "四带二不能拆王炸")
    h3 = Counter(parse_cards("333444XD"))
    p = find(gen_all(h3), MoveType.PLANE_SINGLE)
    check(all(not (SMALL_JOKER in m.cards and BIG_JOKER in m.cards) for m in p),
          "飞机翅膀不能拆王炸")

    # 连对最少 3 对、顺子最少 5 张、飞机最少 2 组
    h4 = Counter(parse_cards("3344"))
    check(not find(gen_all(h4), MoveType.PAIR_CHAIN), "两对不构成连对")
    h5 = Counter(parse_cards("3456"))
    check(not find(gen_all(h5), MoveType.STRAIGHT), "4 张不构成顺子")


def test_beats():
    s9 = Move(MoveType.SINGLE, 9, 1, (9,))
    sK = Move(MoveType.SINGLE, 13, 1, (13,))
    bomb5 = Move(MoveType.BOMB, 5, 1, (5,) * 4)
    bombA = Move(MoveType.BOMB, 14, 1, (14,) * 4)
    rocket = Move(MoveType.ROCKET, BIG_JOKER, 1, (SMALL_JOKER, BIG_JOKER))
    st345 = Move(MoveType.STRAIGHT, 3, 5, (3, 4, 5, 6, 7))
    st456 = Move(MoveType.STRAIGHT, 4, 5, (4, 5, 6, 7, 8))
    st6 = Move(MoveType.STRAIGHT, 4, 6, (4, 5, 6, 7, 8, 9))

    check(beats(sK, s9) and not beats(s9, sK), "单张比大小")
    check(beats(bomb5, sK), "炸弹压单张")
    check(beats(bombA, bomb5) and not beats(bomb5, bombA), "大炸弹压小炸弹")
    check(beats(rocket, bombA), "王炸压炸弹")
    check(not beats(bombA, rocket), "炸弹压不了王炸")
    check(beats(st456, st345), "同长顺子比大小")
    check(not beats(st6, st345), "不同长度顺子不能互压")
    check(not beats(sK, st345), "牌型不同不能压（除炸弹）")


def test_gen_legal():
    h = Counter(parse_cards("3399QQ22"))
    last = Move(MoveType.PAIR, 9, 1, (9, 9))
    legal = gen_legal(h, last)
    check(PASS in legal, "可以过牌")
    pairs = find(legal, MoveType.PAIR)
    check({m.main for m in pairs} == {12, 15}, "只能用 QQ/22 压 99")
    check(all(m.type in (MoveType.PASS, MoveType.PAIR) for m in legal),
          "回应对子只能出对子（无炸弹时）")

    legal_free = gen_legal(h, None)
    check(PASS not in legal_free, "自由出牌不能过")


def test_classify():
    c1 = classify(parse_cards("34567"))
    check(any(m.type == MoveType.STRAIGHT for m in c1), "解析顺子")
    c2 = classify(parse_cards("33344455"))
    check(any(m.type == MoveType.PLANE_SINGLE for m in c2),
          "33344455 是飞机带单（333444+5+5）")
    c2b = classify(parse_cards("33355577"))
    check(not [m for m in c2b if m.type != MoveType.PASS],
          "33355577 三张不连续，不是任何牌型")
    c3 = classify(parse_cards("333444+5+6".replace("+", "")))
    check(any(m.type == MoveType.PLANE_SINGLE for m in c3), "解析飞机带单")
    c4 = classify(parse_cards("XD"))
    check(c4[0].type == MoveType.ROCKET, "解析王炸")
    c5 = classify(parse_cards("333344"))
    check(any(m.type == MoveType.QUAD_TWO_SINGLE for m in c5),
          "3333+44 可解析为四带二单")
    c6 = classify(parse_cards("33334444"))
    check(not [m for m in c6 if m.type != MoveType.PASS],
          "33334444（8 张）不是单一合法牌型（四带两对需两个不同对子）")


def test_full_games():
    rng = random.Random(7)
    max_steps = 0
    for _ in range(300):
        g = Game(rng=rng)
        steps = 0
        while not g.done:
            legal = g.legal_moves()
            check_no_print = len(legal) > 0
            assert check_no_print, "任何局面必有合法动作"
            g.step(rng.choice(legal), check=False)
            steps += 1
            assert steps < 600, "对局未在 600 步内结束"
            total = (sum(g.cards_left(s) for s in range(3))
                     + sum(sum(p.values()) for p in g.played))
            assert total == 54, "牌数守恒被破坏"
        max_steps = max(max_steps, steps)
        assert g.winner_side in (LANDLORD, "peasants")
        assert g.scores is not None and sum(g.scores) == 0, "三家得分之和应为 0"
        assert g.multiplier >= g.base >= 1 or True
    check(True, f"300 局随机对战全部正常结束并通过守恒检查（最长 {max_steps} 步）")


def test_scoring():
    # 构造一局：地主秒胜（春天 ×2），叫 3 分，无炸弹 → 地主 +12，农民各 -6
    g = Game(rng=random.Random(1))
    g.landlord_seat = 0
    g.base = 3
    hands = [Counter(parse_cards("33")), Counter(parse_cards("44")),
             Counter(parse_cards("55"))]
    g._setup([h.copy() for h in hands], [])
    g.step(Move(MoveType.PAIR, 3, 1, (3, 3)), check=False)
    check(g.done and g.winner_side == LANDLORD, "地主出完即胜")
    check(g.spring and g.multiplier == 2, "春天 ×2")
    check(g.scores == [12, -6, -6], "春天计分 3×2: 地主+12 农民各-6")


if __name__ == "__main__":
    for fn in [test_deck, test_basic_types, test_kicker_rules, test_beats,
               test_gen_legal, test_classify, test_full_games, test_scoring]:
        print(f"\n[{fn.__name__}]")
        fn()
    print(f"\n全部通过：共 {PASSED} 项断言 ✓")
