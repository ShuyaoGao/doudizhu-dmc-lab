# -*- coding: utf-8 -*-
"""牌型系统：定义、生成、比较、解析。

完整实现斗地主 15 种牌型：
  过、单张、对子、三张、三带一、三带二、顺子、连对、
  飞机（不带）、飞机带单、飞机带对、四带二单、四带两对、炸弹、王炸

规则要点：
  - 顺子 ≥5 张、连对 ≥3 对、飞机 ≥2 组，均只能用 3~A（不含 2 和王）
  - 三带一/飞机带翅膀的牌不能与三张部分同点数
  - 王炸不可拆：任何带牌不能同时带大小王
  - 炸弹大过除王炸/更大炸弹外的一切牌型；王炸最大
"""

import itertools
from collections import Counter
from dataclasses import dataclass, field
from enum import IntEnum

from .cards import SMALL_JOKER, BIG_JOKER, CHAIN_MAX_RANK, RANK_NAMES


class MoveType(IntEnum):
    PASS = 0            # 过
    SINGLE = 1          # 单张
    PAIR = 2            # 对子
    TRIO = 3            # 三张
    TRIO_SINGLE = 4     # 三带一
    TRIO_PAIR = 5       # 三带二
    STRAIGHT = 6        # 顺子
    PAIR_CHAIN = 7      # 连对
    PLANE = 8           # 飞机（不带翅膀）
    PLANE_SINGLE = 9    # 飞机带单
    PLANE_PAIR = 10     # 飞机带对
    QUAD_TWO_SINGLE = 11  # 四带二单
    QUAD_TWO_PAIR = 12    # 四带两对
    BOMB = 13           # 炸弹
    ROCKET = 14         # 王炸


TYPE_NAMES = {
    MoveType.PASS: "过", MoveType.SINGLE: "单张", MoveType.PAIR: "对子",
    MoveType.TRIO: "三张", MoveType.TRIO_SINGLE: "三带一", MoveType.TRIO_PAIR: "三带二",
    MoveType.STRAIGHT: "顺子", MoveType.PAIR_CHAIN: "连对", MoveType.PLANE: "飞机",
    MoveType.PLANE_SINGLE: "飞机带单", MoveType.PLANE_PAIR: "飞机带对",
    MoveType.QUAD_TWO_SINGLE: "四带二单", MoveType.QUAD_TWO_PAIR: "四带两对",
    MoveType.BOMB: "炸弹", MoveType.ROCKET: "王炸",
}

# 飞机/四带的翅膀组合数上限（防止极端手牌组合爆炸；正常对局几乎不会触及）
MAX_KICKER_COMBOS = 200


@dataclass(frozen=True)
class Move:
    type: MoveType
    main: int = 0       # 主牌点数（链型为最小点数）
    length: int = 1     # 链长（顺子张数/连对对数/飞机组数），非链型为 1
    cards: tuple = field(default_factory=tuple)  # 实际打出的全部牌（升序）

    def __str__(self):
        if self.type == MoveType.PASS:
            return "过"
        return f"{TYPE_NAMES[self.type]} [{' '.join(RANK_NAMES[r] for r in self.cards)}]"


PASS = Move(MoveType.PASS)


def beats(move, last):
    """move 能否压过 last（last 为非过牌型）。"""
    if move.type == MoveType.ROCKET:
        return True
    if last.type == MoveType.ROCKET:
        return False
    if move.type == MoveType.BOMB:
        return last.type != MoveType.BOMB or move.main > last.main
    if last.type == MoveType.BOMB:
        return False
    return (move.type == last.type and move.length == last.length
            and move.main > last.main)


# ---------------------------------------------------------------- 生成
def _chain_windows(counts, min_count, min_len, max_len):
    """在 3..A 范围内找所有满足每点 ≥min_count 张的连续窗口。"""
    out = []
    ok = [r for r in range(3, CHAIN_MAX_RANK + 1) if counts.get(r, 0) >= min_count]
    okset = set(ok)
    for start in ok:
        length = 0
        while start + length in okset:
            length += 1
            if min_len <= length <= max_len:
                out.append(tuple(range(start, start + length)))
    return out


def _kicker_singles(counts, banned, n):
    """从 counts 中选 n 张单牌做翅膀（排除 banned 点数，禁止同时含大小王）。"""
    pool = []
    for r in sorted(counts):
        if r in banned or counts[r] <= 0:
            continue
        pool.extend([r] * min(counts[r], n))
    seen = set()
    for combo in itertools.combinations(pool, n):
        if SMALL_JOKER in combo and BIG_JOKER in combo:
            continue
        if combo not in seen:
            seen.add(combo)
            if len(seen) >= MAX_KICKER_COMBOS:
                break
    return sorted(seen)


def _kicker_pairs(counts, banned, n):
    """选 n 个不同点数的对子做翅膀。"""
    avail = [r for r in sorted(counts)
             if r not in banned and r <= 15 and counts[r] >= 2]
    out = list(itertools.islice(itertools.combinations(avail, n), MAX_KICKER_COMBOS))
    return out


def gen_all(counts):
    """生成手牌 counts（Counter）能打出的所有牌型（不含过）。"""
    moves = []
    ranks = sorted(r for r in counts if counts[r] > 0)

    # 单张 / 对子 / 三张 / 炸弹
    for r in ranks:
        c = counts[r]
        moves.append(Move(MoveType.SINGLE, r, 1, (r,)))
        if c >= 2:
            moves.append(Move(MoveType.PAIR, r, 1, (r, r)))
        if c >= 3:
            moves.append(Move(MoveType.TRIO, r, 1, (r, r, r)))
        if c == 4:
            moves.append(Move(MoveType.BOMB, r, 1, (r, r, r, r)))

    # 王炸
    if counts.get(SMALL_JOKER, 0) and counts.get(BIG_JOKER, 0):
        moves.append(Move(MoveType.ROCKET, BIG_JOKER, 1, (SMALL_JOKER, BIG_JOKER)))

    # 三带一 / 三带二
    for r in ranks:
        if counts[r] < 3:
            continue
        for k in ranks:
            if k == r:
                continue
            moves.append(Move(MoveType.TRIO_SINGLE, r, 1, tuple(sorted((r, r, r, k)))))
            if counts[k] >= 2 and k <= 15:
                moves.append(Move(MoveType.TRIO_PAIR, r, 1,
                                  tuple(sorted((r, r, r, k, k)))))

    # 顺子（5~12 张）
    for win in _chain_windows(counts, 1, 5, 12):
        moves.append(Move(MoveType.STRAIGHT, win[0], len(win), win))

    # 连对（3~10 对）
    for win in _chain_windows(counts, 2, 3, 10):
        cards = tuple(sorted(win * 2))
        moves.append(Move(MoveType.PAIR_CHAIN, win[0], len(win), cards))

    # 飞机（2~6 组），可不带、带单、带对
    for win in _chain_windows(counts, 3, 2, 6):
        t = len(win)
        body = tuple(sorted(win * 3))
        moves.append(Move(MoveType.PLANE, win[0], t, body))
        rem = counts.copy()
        for r in win:
            rem[r] -= 3
        banned = set(win)
        for kick in _kicker_singles(rem, banned, t):
            moves.append(Move(MoveType.PLANE_SINGLE, win[0], t,
                              tuple(sorted(body + kick))))
        for kick in _kicker_pairs(rem, banned, t):
            moves.append(Move(MoveType.PLANE_PAIR, win[0], t,
                              tuple(sorted(body + tuple(kick) * 2))))

    # 四带二单 / 四带两对
    for r in ranks:
        if counts[r] != 4:
            continue
        rem = counts.copy()
        rem[r] = 0
        quad = (r, r, r, r)
        for kick in _kicker_singles(rem, {r}, 2):
            moves.append(Move(MoveType.QUAD_TWO_SINGLE, r, 1,
                              tuple(sorted(quad + kick))))
        for kick in _kicker_pairs(rem, {r}, 2):
            moves.append(Move(MoveType.QUAD_TWO_PAIR, r, 1,
                              tuple(sorted(quad + tuple(kick) * 2))))
    return moves


def gen_legal(counts, last):
    """当前要回应 last 时的所有合法选择；last 为 None 表示自由出牌（不可过）。"""
    if last is None or last.type == MoveType.PASS:
        return gen_all(counts)
    return [PASS] + [m for m in gen_all(counts) if beats(m, last)]


# ---------------------------------------------------------------- 解析
def classify(cards):
    """把一手牌（点数列表）解析成所有可能的 Move 解释（人机对战输入用）。"""
    cards = tuple(sorted(cards))
    n = len(cards)
    counts = Counter(cards)
    out = []

    if n == 0:
        return [PASS]
    if cards == (SMALL_JOKER, BIG_JOKER):
        return [Move(MoveType.ROCKET, BIG_JOKER, 1, cards)]

    by_count = {}
    for r, c in counts.items():
        by_count.setdefault(c, []).append(r)
    distinct = sorted(counts)

    def consecutive(rs):
        return (all(r <= CHAIN_MAX_RANK for r in rs)
                and all(rs[i + 1] - rs[i] == 1 for i in range(len(rs) - 1)))

    if n == 1:
        out.append(Move(MoveType.SINGLE, cards[0], 1, cards))
    if n == 2 and len(distinct) == 1:
        out.append(Move(MoveType.PAIR, cards[0], 1, cards))
    if n == 3 and len(distinct) == 1:
        out.append(Move(MoveType.TRIO, cards[0], 1, cards))
    if n == 4:
        if len(distinct) == 1:
            out.append(Move(MoveType.BOMB, cards[0], 1, cards))
        elif 3 in by_count:
            r = by_count[3][0]
            k = next(x for x in distinct if x != r)
            if k != r:
                out.append(Move(MoveType.TRIO_SINGLE, r, 1, cards))
    if n == 5 and 3 in by_count and 2 in by_count:
        out.append(Move(MoveType.TRIO_PAIR, by_count[3][0], 1, cards))
    if n >= 5 and len(distinct) == n and consecutive(distinct):
        out.append(Move(MoveType.STRAIGHT, distinct[0], n, cards))
    if n >= 6 and n % 2 == 0 and all(c == 2 for c in counts.values()) \
            and consecutive(distinct) and len(distinct) >= 3:
        out.append(Move(MoveType.PAIR_CHAIN, distinct[0], len(distinct), cards))
    if n >= 6 and n % 3 == 0 and all(c == 3 for c in counts.values()) \
            and consecutive(distinct) and len(distinct) >= 2:
        out.append(Move(MoveType.PLANE, distinct[0], len(distinct), cards))

    # 飞机带翅膀：枚举可能的三张链
    def plane_with_wings(t, wing_count, mtype):
        trio_ranks = sorted(r for r, c in counts.items()
                            if c >= 3 and r <= CHAIN_MAX_RANK)
        for i in range(len(trio_ranks) - t + 1):
            win = trio_ranks[i:i + t]
            if not consecutive(win):
                continue
            rem = counts.copy()
            for r in win:
                rem[r] -= 3
            rem = +rem
            if any(r in rem for r in win):
                continue  # 翅膀不能与三张同点
            if wing_count == 1 and sum(rem.values()) == t:
                if rem.get(SMALL_JOKER) and rem.get(BIG_JOKER):
                    continue  # 王炸不可拆带
                out.append(Move(mtype, win[0], t, cards))
            elif wing_count == 2 and sum(rem.values()) == 2 * t \
                    and all(c == 2 for c in rem.values()) and len(rem) == t \
                    and all(r <= 15 for r in rem):
                out.append(Move(mtype, win[0], t, cards))

    if n >= 8 and n % 4 == 0:
        plane_with_wings(n // 4, 1, MoveType.PLANE_SINGLE)
    if n >= 10 and n % 5 == 0:
        plane_with_wings(n // 5, 2, MoveType.PLANE_PAIR)

    # 四带二
    if n == 6 and 4 in by_count:
        for q in by_count[4]:
            rem = counts.copy()
            rem[q] -= 4
            rem = +rem
            if sum(rem.values()) == 2 and not (rem.get(SMALL_JOKER) and rem.get(BIG_JOKER)):
                out.append(Move(MoveType.QUAD_TWO_SINGLE, q, 1, cards))
    if n == 8 and 4 in by_count:
        for q in by_count[4]:
            rem = counts.copy()
            rem[q] -= 4
            rem = +rem
            if len(rem) == 2 and all(c == 2 for c in rem.values()) \
                    and all(r <= 15 for r in rem):
                out.append(Move(MoveType.QUAD_TWO_PAIR, q, 1, cards))

    return out
