# -*- coding: utf-8 -*-
"""牌的定义与基础工具。

斗地主中花色无意义，只用点数表示牌：
  3=3, 4=4, ..., 10=10, J=11, Q=12, K=13, A=14, 2=15, 小王=16, 大王=17
牌的大小顺序：3 < 4 < ... < K < A < 2 < 小王 < 大王
"""

from collections import Counter

SMALL_JOKER = 16
BIG_JOKER = 17

# 普通点数（可有 4 张）：3..2
NORMAL_RANKS = list(range(3, 16))
ALL_RANKS = NORMAL_RANKS + [SMALL_JOKER, BIG_JOKER]

# 顺子/连对/飞机允许的点数：3..A（不含 2 和王）
CHAIN_MAX_RANK = 14

RANK_CHARS = {3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9",
              10: "T", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2",
              SMALL_JOKER: "X", BIG_JOKER: "D"}
RANK_NAMES = {**{r: c for r, c in RANK_CHARS.items()},
              10: "10", SMALL_JOKER: "小王", BIG_JOKER: "大王"}
CHAR_RANKS = {c: r for r, c in RANK_CHARS.items()}
CHAR_RANKS["10"] = 10  # 允许输入 10


def full_deck():
    """54 张牌的点数列表。"""
    deck = []
    for r in NORMAL_RANKS:
        deck.extend([r] * 4)
    deck.extend([SMALL_JOKER, BIG_JOKER])
    return deck


def deal(rng):
    """发牌：三家各 17 张 + 3 张底牌。返回 (hands: list[Counter], bottom: list)。"""
    deck = full_deck()
    rng.shuffle(deck)
    hands = [Counter(deck[i * 17:(i + 1) * 17]) for i in range(3)]
    bottom = sorted(deck[51:])
    return hands, bottom


def cards54(counts):
    """把牌（Counter 或可迭代点数）编码成 54 维 0/1 数组（list[float]）。

    每个普通点数占 4 位（有几张点亮几位），小王 52 位，大王 53 位。
    """
    if not isinstance(counts, Counter):
        counts = Counter(counts)
    arr = [0.0] * 54
    for r, c in counts.items():
        if c <= 0:
            continue
        if r == SMALL_JOKER:
            arr[52] = 1.0
        elif r == BIG_JOKER:
            arr[53] = 1.0
        else:
            base = (r - 3) * 4
            for i in range(min(c, 4)):
                arr[base + i] = 1.0
    return arr


def fmt_cards(cards):
    """把点数列表/Counter 格式化为可读字符串，如 '3 3 4 J 2 小王'。"""
    if isinstance(cards, Counter):
        cards = sorted(cards.elements())
    else:
        cards = sorted(cards)
    return " ".join(RANK_NAMES[r] for r in cards)


def parse_cards(text):
    """解析用户输入的牌，如 '334455'、'TJQKA'、'X D'、'10 10'。返回点数列表。"""
    text = text.strip().upper().replace("10", "T")
    ranks = []
    for ch in text:
        if ch in (" ", ",", "，"):
            continue
        if ch not in CHAR_RANKS:
            raise ValueError(f"无法识别的牌: {ch}（可用 3-9 T J Q K A 2 X D）")
        ranks.append(CHAR_RANKS[ch])
    return ranks
