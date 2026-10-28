# -*- coding: utf-8 -*-
"""游戏流程：发牌 → 叫分定地主 → 轮流出牌 → 结算。

完整规则：
  - 三人，各 17 张，3 张底牌归地主（亮给所有人）
  - 叫分制：从随机一家开始，每人一次机会叫 1/2/3 分或不叫；
    叫 3 分立即定地主；全不叫则重新发牌
  - 地主先出；其余两家须压牌或过；连续两家过则由最后出牌者重新自由出牌
  - 先出完者获胜：地主出完 → 地主胜；任一农民出完 → 农民方胜
  - 计分：底分(叫分) × 2^(炸弹+王炸数) × 春天加倍
      春天：地主胜且两农民一张未出 ×2
      反春天：农民胜且地主只出过第一手 ×2
    地主输赢为每农民得失的 2 倍
"""

import random
from collections import Counter

from .moves import Move, MoveType, PASS, gen_legal

LANDLORD, DOWN, UP = "landlord", "down", "up"  # 地主 / 下家(地主下) / 上家


def heuristic_bid(hand):
    """简单手牌强度叫分：按 2、王、炸弹数量估分。返回 0(不叫)/1/2/3。"""
    bombs = sum(1 for r, c in hand.items() if c == 4)
    rocket = hand.get(16, 0) and hand.get(17, 0)
    s = (hand.get(15, 0) + 2 * hand.get(16, 0) + 2 * hand.get(17, 0)
         + 2 * bombs + (1 if rocket else 0))
    if s >= 5:
        return 3
    if s >= 3:
        return 2
    if s >= 1:
        return 1
    return 0


class Game:
    """一局斗地主。seat 0/1/2 为座位号；position 为相对身份（地主/下家/上家）。"""

    def __init__(self, rng=None, bid_fn=None):
        self.rng = rng or random.Random()
        self.bid_fn = bid_fn or (lambda seat, hand, cur: heuristic_bid(hand)
                                 if heuristic_bid(hand) > cur else 0)
        self.reset()

    @classmethod
    def from_setup(cls, hands, bottom, landlord_seat, base, rng=None):
        """跳过内部发牌叫分，用外部结果直接开局（交互式叫分场景用）。"""
        g = cls.__new__(cls)
        g.rng = rng or random.Random()
        g.bid_fn = None
        g.landlord_seat = landlord_seat
        g.base = base
        g._setup([h.copy() for h in hands], list(bottom))
        return g

    # ------------------------------------------------------------ 开局
    def reset(self):
        for attempt in range(10):
            hands, bottom = self._deal_and_bid()
            if hands is not None:
                break
        else:  # 连续流局：强制第一叫分人当 1 分地主
            from .cards import deal
            hands, bottom = deal(self.rng)
            self.landlord_seat = self.rng.randrange(3)
            self.base = 1
            self._setup(hands, bottom)
            return self
        self._setup(hands, bottom)
        return self

    def _deal_and_bid(self):
        from .cards import deal
        hands, bottom = deal(self.rng)
        first = self.rng.randrange(3)
        best_seat, best_bid = None, 0
        for i in range(3):
            seat = (first + i) % 3
            bid = self.bid_fn(seat, hands[seat], best_bid)
            if bid > best_bid:
                best_seat, best_bid = seat, bid
                if bid == 3:
                    break
        if best_seat is None:
            return None, None  # 流局
        self.landlord_seat = best_seat
        self.base = best_bid
        return hands, bottom

    def _setup(self, hands, bottom):
        self.hands = hands
        self.bottom = bottom
        for r in bottom:
            self.hands[self.landlord_seat][r] += 1
        self.turn = self.landlord_seat          # 地主先出
        self.to_beat = None                     # 当前需要压的牌（None=自由出牌）
        self.last_mover = None
        self.pass_streak = 0
        self.played = [Counter(), Counter(), Counter()]   # 每家已打出的牌
        self.last_action = [PASS, PASS, PASS]   # 每家最近一次动作
        self.play_counts = [0, 0, 0]            # 每家非过出牌次数
        self.bombs = 0
        self.history = []                       # (seat, Move)
        self.done = False
        self.winner_side = None
        self.scores = None
        self.multiplier = 1
        self.spring = False

    # ------------------------------------------------------------ 查询
    def position(self, seat):
        d = (seat - self.landlord_seat) % 3
        return (LANDLORD, DOWN, UP)[d]

    def seat_of(self, position):
        d = (LANDLORD, DOWN, UP).index(position)
        return (self.landlord_seat + d) % 3

    def legal_moves(self):
        return gen_legal(self.hands[self.turn], self.to_beat)

    def cards_left(self, seat):
        return sum(self.hands[seat].values())

    # ------------------------------------------------------------ 出牌
    def step(self, move, check=True):
        assert not self.done, "对局已结束"
        seat = self.turn
        if check:
            legal = self.legal_moves()
            assert move in legal, f"非法出牌: {move}"

        self.history.append((seat, move))
        self.last_action[seat] = move

        if move.type == MoveType.PASS:
            self.pass_streak += 1
        else:
            hand = self.hands[seat]
            for r in move.cards:
                hand[r] -= 1
                if hand[r] == 0:
                    del hand[r]
            self.played[seat].update(move.cards)
            self.play_counts[seat] += 1
            if move.type in (MoveType.BOMB, MoveType.ROCKET):
                self.bombs += 1
            self.to_beat = move
            self.last_mover = seat
            self.pass_streak = 0
            if not hand:
                self._finish(seat)
                return self

        self.turn = (self.turn + 1) % 3
        if self.pass_streak == 2:               # 两家都过，最后出牌者重新自由出牌
            self.to_beat = None
            self.pass_streak = 0
        return self

    # ------------------------------------------------------------ 结算
    def _finish(self, winner_seat):
        self.done = True
        L = self.landlord_seat
        self.winner_side = LANDLORD if winner_seat == L else "peasants"

        peasant_plays = sum(self.play_counts[s] for s in range(3) if s != L)
        if self.winner_side == LANDLORD and peasant_plays == 0:
            self.spring = True                  # 春天
        if self.winner_side == "peasants" and self.play_counts[L] == 1:
            self.spring = True                  # 反春天

        self.multiplier = (2 ** self.bombs) * (2 if self.spring else 1)
        stake = self.base * self.multiplier
        sign = 1 if self.winner_side == LANDLORD else -1
        self.scores = [0, 0, 0]
        for s in range(3):
            self.scores[s] = sign * 2 * stake if s == L else -sign * stake
