/* 斗地主规则引擎（浏览器版）。
 * 逐条移植自 doudizhu/cards.py、doudizhu/moves.py、doudizhu/game.py、doudizhu/env.py。
 * 合法动作的生成顺序与 Python 版逐项一致（tests/js/test_engine.js 用 Python 导出的夹具逐局核对）。
 * 普通 <script> 加载，挂在全局 DDZ 上；不用 ES module（file:// 下 Chrome 会拦）。
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------------ cards.py
  var SMALL_JOKER = 16, BIG_JOKER = 17, CHAIN_MAX_RANK = 14;
  var NORMAL_RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  var ALL_RANKS = NORMAL_RANKS.concat([SMALL_JOKER, BIG_JOKER]);
  var RANK_NAMES = {3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
    11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: '2', 16: '小王', 17: '大王'};

  function emptyCounts() { var a = new Array(18); for (var i = 0; i < 18; i++) a[i] = 0; return a; }
  function countsFrom(ranks) { var c = emptyCounts(); for (var i = 0; i < ranks.length; i++) c[ranks[i]]++; return c; }
  function countsTotal(c) { var s = 0; for (var r = 3; r <= 17; r++) s += Math.max(0, c[r]); return s; }
  function countsToList(c) { var out = []; for (var r = 3; r <= 17; r++) for (var k = 0; k < c[r]; k++) out.push(r); return out; }

  function fullDeck() {
    var d = [];
    NORMAL_RANKS.forEach(function (r) { d.push(r, r, r, r); });
    d.push(SMALL_JOKER, BIG_JOKER);
    return d;
  }

  /** 54 维 0/1 编码：普通点数 r 占 (r-3)*4 起的 4 位（有几张点亮几位），小王 52，大王 53。 */
  function cards54(counts) {
    var arr = new Array(54); for (var i = 0; i < 54; i++) arr[i] = 0;
    for (var r = 3; r <= 17; r++) {
      var c = counts[r]; if (c <= 0) continue;
      if (r === SMALL_JOKER) arr[52] = 1;
      else if (r === BIG_JOKER) arr[53] = 1;
      else { var base = (r - 3) * 4; for (var k = 0; k < Math.min(c, 4); k++) arr[base + k] = 1; }
    }
    return arr;
  }

  // ------------------------------------------------------------------ moves.py
  var T = {PASS: 0, SINGLE: 1, PAIR: 2, TRIO: 3, TRIO_SINGLE: 4, TRIO_PAIR: 5, STRAIGHT: 6,
    PAIR_CHAIN: 7, PLANE: 8, PLANE_SINGLE: 9, PLANE_PAIR: 10, QUAD_TWO_SINGLE: 11,
    QUAD_TWO_PAIR: 12, BOMB: 13, ROCKET: 14};
  var TYPE_NAMES = ['过', '单张', '对子', '三张', '三带一', '三带二', '顺子', '连对', '飞机',
    '飞机带单', '飞机带对', '四带二单', '四带两对', '炸弹', '王炸'];
  var MAX_KICKER_COMBOS = 200;

  function Move(type, main, length, cards) {
    return {type: type, main: main || 0, length: length || 1, cards: cards || []};
  }
  var PASS = Move(T.PASS, 0, 1, []);
  function sortNum(a) { return a.slice().sort(function (x, y) { return x - y; }); }
  function moveKey(m) { return m.type + ':' + m.main + ':' + m.length + ':' + m.cards.join(','); }
  function moveEq(a, b) { return moveKey(a) === moveKey(b); }
  function moveStr(m) {
    if (m.type === T.PASS) return '过';
    return TYPE_NAMES[m.type] + ' [' + m.cards.map(function (r) { return RANK_NAMES[r]; }).join(' ') + ']';
  }

  function beats(move, last) {
    if (move.type === T.ROCKET) return true;
    if (last.type === T.ROCKET) return false;
    if (move.type === T.BOMB) return last.type !== T.BOMB || move.main > last.main;
    if (last.type === T.BOMB) return false;
    return move.type === last.type && move.length === last.length && move.main > last.main;
  }

  function range(a, b) { var o = []; for (var i = a; i < b; i++) o.push(i); return o; }

  function chainWindows(counts, minCount, minLen, maxLen) {
    var out = [], ok = [], okset = {};
    for (var r = 3; r <= CHAIN_MAX_RANK; r++) if (counts[r] >= minCount) { ok.push(r); okset[r] = true; }
    for (var i = 0; i < ok.length; i++) {
      var start = ok[i], length = 0;
      while (okset[start + length]) {
        length += 1;
        if (length >= minLen && length <= maxLen) out.push(range(start, start + length));
      }
    }
    return out;
  }

  /** 与 itertools.combinations 相同顺序地枚举下标组合，回调返回 false 时停止。 */
  function combinations(n, k, cb) {
    if (k > n) return;
    var idx = range(0, k);
    while (true) {
      if (cb(idx) === false) return;
      var i = k - 1;
      while (i >= 0 && idx[i] === i + n - k) i--;
      if (i < 0) return;
      idx[i]++;
      for (var j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }

  function cmpTuple(a, b) {
    for (var i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
    return a.length - b.length;
  }

  function kickerSingles(counts, banned, n) {
    var pool = [];
    for (var r = 3; r <= 17; r++) {
      if (banned[r] || counts[r] <= 0) continue;
      for (var k = 0; k < Math.min(counts[r], n); k++) pool.push(r);
    }
    var seen = {}, list = [];
    combinations(pool.length, n, function (idx) {
      var combo = idx.map(function (i) { return pool[i]; });
      if (combo.indexOf(SMALL_JOKER) >= 0 && combo.indexOf(BIG_JOKER) >= 0) return true;
      var key = combo.join(',');
      if (!seen[key]) {
        seen[key] = true; list.push(combo);
        if (list.length >= MAX_KICKER_COMBOS) return false;
      }
      return true;
    });
    list.sort(cmpTuple);
    return list;
  }

  function kickerPairs(counts, banned, n) {
    var avail = [];
    for (var r = 3; r <= 17; r++) if (!banned[r] && r <= 15 && counts[r] >= 2) avail.push(r);
    var out = [];
    combinations(avail.length, n, function (idx) {
      out.push(idx.map(function (i) { return avail[i]; }));
      return out.length < MAX_KICKER_COMBOS;
    });
    return out;
  }

  function rep(arr, times) { var o = []; for (var t = 0; t < times; t++) o = o.concat(arr); return o; }
  function setOf(arr) { var s = {}; arr.forEach(function (r) { s[r] = true; }); return s; }

  function genAll(counts) {
    var moves = [], ranks = [], r, k, i;
    for (r = 3; r <= 17; r++) if (counts[r] > 0) ranks.push(r);

    ranks.forEach(function (r) {
      var c = counts[r];
      moves.push(Move(T.SINGLE, r, 1, [r]));
      if (c >= 2) moves.push(Move(T.PAIR, r, 1, [r, r]));
      if (c >= 3) moves.push(Move(T.TRIO, r, 1, [r, r, r]));
      if (c === 4) moves.push(Move(T.BOMB, r, 1, [r, r, r, r]));
    });
    if (counts[SMALL_JOKER] > 0 && counts[BIG_JOKER] > 0)
      moves.push(Move(T.ROCKET, BIG_JOKER, 1, [SMALL_JOKER, BIG_JOKER]));

    ranks.forEach(function (r) {
      if (counts[r] < 3) return;
      ranks.forEach(function (k) {
        if (k === r) return;
        moves.push(Move(T.TRIO_SINGLE, r, 1, sortNum([r, r, r, k])));
        if (counts[k] >= 2 && k <= 15) moves.push(Move(T.TRIO_PAIR, r, 1, sortNum([r, r, r, k, k])));
      });
    });

    chainWindows(counts, 1, 5, 12).forEach(function (win) {
      moves.push(Move(T.STRAIGHT, win[0], win.length, win.slice()));
    });
    chainWindows(counts, 2, 3, 10).forEach(function (win) {
      moves.push(Move(T.PAIR_CHAIN, win[0], win.length, sortNum(rep(win, 2))));
    });
    chainWindows(counts, 3, 2, 6).forEach(function (win) {
      var t = win.length, body = sortNum(rep(win, 3));
      moves.push(Move(T.PLANE, win[0], t, body));
      var rem = counts.slice();
      win.forEach(function (r) { rem[r] -= 3; });
      var banned = setOf(win);
      kickerSingles(rem, banned, t).forEach(function (kick) {
        moves.push(Move(T.PLANE_SINGLE, win[0], t, sortNum(body.concat(kick))));
      });
      kickerPairs(rem, banned, t).forEach(function (kick) {
        moves.push(Move(T.PLANE_PAIR, win[0], t, sortNum(body.concat(kick, kick))));
      });
    });

    ranks.forEach(function (r) {
      if (counts[r] !== 4) return;
      var rem = counts.slice(); rem[r] = 0;
      var quad = [r, r, r, r], banned = {}; banned[r] = true;
      kickerSingles(rem, banned, 2).forEach(function (kick) {
        moves.push(Move(T.QUAD_TWO_SINGLE, r, 1, sortNum(quad.concat(kick))));
      });
      kickerPairs(rem, banned, 2).forEach(function (kick) {
        moves.push(Move(T.QUAD_TWO_PAIR, r, 1, sortNum(quad.concat(kick, kick))));
      });
    });
    return moves;
  }

  function genLegal(counts, last) {
    if (!last || last.type === T.PASS) return genAll(counts);
    return [PASS].concat(genAll(counts).filter(function (m) { return beats(m, last); }));
  }

  /** 把一手牌（点数数组）解析成所有可能的 Move 解释（人类出牌用），与 moves.classify 一致。 */
  function classify(cardsIn) {
    var cards = sortNum(cardsIn), n = cards.length, counts = countsFrom(cards), out = [];
    if (n === 0) return [PASS];
    if (n === 2 && cards[0] === SMALL_JOKER && cards[1] === BIG_JOKER) return [Move(T.ROCKET, BIG_JOKER, 1, cards)];
    var byCount = {}, distinct = [];
    for (var r = 3; r <= 17; r++) if (counts[r] > 0) {
      distinct.push(r);
      (byCount[counts[r]] = byCount[counts[r]] || []).push(r);
    }
    function consecutive(rs) {
      for (var i = 0; i < rs.length; i++) if (rs[i] > CHAIN_MAX_RANK) return false;
      for (i = 0; i + 1 < rs.length; i++) if (rs[i + 1] - rs[i] !== 1) return false;
      return true;
    }
    function allCounts(v) { return distinct.every(function (r) { return counts[r] === v; }); }

    if (n === 1) out.push(Move(T.SINGLE, cards[0], 1, cards));
    if (n === 2 && distinct.length === 1) out.push(Move(T.PAIR, cards[0], 1, cards));
    if (n === 3 && distinct.length === 1) out.push(Move(T.TRIO, cards[0], 1, cards));
    if (n === 4) {
      if (distinct.length === 1) out.push(Move(T.BOMB, cards[0], 1, cards));
      else if (byCount[3]) out.push(Move(T.TRIO_SINGLE, byCount[3][0], 1, cards));
    }
    if (n === 5 && byCount[3] && byCount[2]) out.push(Move(T.TRIO_PAIR, byCount[3][0], 1, cards));
    if (n >= 5 && distinct.length === n && consecutive(distinct)) out.push(Move(T.STRAIGHT, distinct[0], n, cards));
    if (n >= 6 && n % 2 === 0 && allCounts(2) && consecutive(distinct) && distinct.length >= 3)
      out.push(Move(T.PAIR_CHAIN, distinct[0], distinct.length, cards));
    if (n >= 6 && n % 3 === 0 && allCounts(3) && consecutive(distinct) && distinct.length >= 2)
      out.push(Move(T.PLANE, distinct[0], distinct.length, cards));

    function planeWithWings(t, wingCount, mtype) {
      var trio = distinct.filter(function (r) { return counts[r] >= 3 && r <= CHAIN_MAX_RANK; });
      for (var i = 0; i + t <= trio.length; i++) {
        var win = trio.slice(i, i + t);
        if (!consecutive(win)) continue;
        var rem = counts.slice();
        win.forEach(function (r) { rem[r] -= 3; });
        if (win.some(function (r) { return rem[r] > 0; })) continue;
        var remRanks = [], remSum = 0;
        for (var r = 3; r <= 17; r++) if (rem[r] > 0) { remRanks.push(r); remSum += rem[r]; }
        if (wingCount === 1 && remSum === t) {
          if (rem[SMALL_JOKER] > 0 && rem[BIG_JOKER] > 0) continue;
          out.push(Move(mtype, win[0], t, cards));
        } else if (wingCount === 2 && remSum === 2 * t &&
                   remRanks.every(function (r) { return rem[r] === 2; }) && remRanks.length === t &&
                   remRanks.every(function (r) { return r <= 15; })) {
          out.push(Move(mtype, win[0], t, cards));
        }
      }
    }
    if (n >= 8 && n % 4 === 0) planeWithWings(n / 4, 1, T.PLANE_SINGLE);
    if (n >= 10 && n % 5 === 0) planeWithWings(n / 5, 2, T.PLANE_PAIR);

    if (n === 6 && byCount[4]) byCount[4].forEach(function (q) {
      var rem = counts.slice(); rem[q] -= 4;
      if (countsTotal(rem) === 2 && !(rem[SMALL_JOKER] > 0 && rem[BIG_JOKER] > 0))
        out.push(Move(T.QUAD_TWO_SINGLE, q, 1, cards));
    });
    if (n === 8 && byCount[4]) byCount[4].forEach(function (q) {
      var rem = counts.slice(); rem[q] -= 4;
      var rr = []; for (var r = 3; r <= 17; r++) if (rem[r] > 0) rr.push(r);
      if (rr.length === 2 && rr.every(function (r) { return rem[r] === 2 && r <= 15; }))
        out.push(Move(T.QUAD_TWO_PAIR, q, 1, cards));
    });
    return out;
  }

  // ------------------------------------------------------------------ game.py
  var LANDLORD = 'landlord', DOWN = 'down', UP = 'up';
  var POSITIONS = [LANDLORD, DOWN, UP];
  var POS_ZH = {landlord: '地主', down: '农民·下家', up: '农民·上家'};

  function heuristicBid(hand) {
    var bombs = 0;
    for (var r = 3; r <= 17; r++) if (hand[r] === 4) bombs++;
    var rocket = hand[16] > 0 && hand[17] > 0;
    var s = hand[15] + 2 * hand[16] + 2 * hand[17] + 2 * bombs + (rocket ? 1 : 0);
    if (s >= 5) return 3;
    if (s >= 3) return 2;
    if (s >= 1) return 1;
    return 0;
  }

  /** 对应 Game.from_setup：hands 是三个 counts 数组（叫分前，各 17 张），bottom 是 3 张点数。 */
  function Game(hands, bottom, landlordSeat, base) {
    this.landlordSeat = landlordSeat;
    this.base = base;
    this.hands = hands.map(function (h) { return h.slice(); });
    this.bottom = sortNum(bottom);
    var self = this;
    this.bottom.forEach(function (r) { self.hands[landlordSeat][r] += 1; });
    this.turn = landlordSeat;
    this.toBeat = null;
    this.lastMover = null;
    this.passStreak = 0;
    this.played = [emptyCounts(), emptyCounts(), emptyCounts()];
    this.lastAction = [PASS, PASS, PASS];
    this.playCounts = [0, 0, 0];
    this.bombs = 0;
    this.history = [];
    this.done = false;
    this.winnerSide = null;
    this.scores = null;
    this.multiplier = 1;
    this.spring = false;
  }
  Game.prototype.position = function (seat) { return POSITIONS[(seat - this.landlordSeat + 3) % 3]; };
  Game.prototype.seatOf = function (pos) { return (this.landlordSeat + POSITIONS.indexOf(pos)) % 3; };
  Game.prototype.legalMoves = function () { return genLegal(this.hands[this.turn], this.toBeat); };
  Game.prototype.cardsLeft = function (seat) { return countsTotal(this.hands[seat]); };
  Game.prototype.step = function (move) {
    if (this.done) throw new Error('对局已结束');
    var seat = this.turn;
    this.history.push([seat, move]);
    this.lastAction[seat] = move;
    if (move.type === T.PASS) {
      this.passStreak += 1;
    } else {
      var hand = this.hands[seat];
      for (var i = 0; i < move.cards.length; i++) {
        hand[move.cards[i]] -= 1;
        this.played[seat][move.cards[i]] += 1;
      }
      this.playCounts[seat] += 1;
      if (move.type === T.BOMB || move.type === T.ROCKET) this.bombs += 1;
      this.toBeat = move;
      this.lastMover = seat;
      this.passStreak = 0;
      if (countsTotal(hand) === 0) { this._finish(seat); return this; }
    }
    this.turn = (this.turn + 1) % 3;
    if (this.passStreak === 2) { this.toBeat = null; this.passStreak = 0; }
    return this;
  };
  Game.prototype._finish = function (winner) {
    this.done = true;
    var L = this.landlordSeat;
    this.winnerSide = winner === L ? LANDLORD : 'peasants';
    var peasantPlays = 0;
    for (var s = 0; s < 3; s++) if (s !== L) peasantPlays += this.playCounts[s];
    if (this.winnerSide === LANDLORD && peasantPlays === 0) this.spring = true;
    if (this.winnerSide === 'peasants' && this.playCounts[L] === 1) this.spring = true;
    this.multiplier = Math.pow(2, this.bombs) * (this.spring ? 2 : 1);
    var stake = this.base * this.multiplier, sign = this.winnerSide === LANDLORD ? 1 : -1;
    this.scores = [0, 1, 2].map(function (s) { return s === L ? sign * 2 * stake : -sign * stake; });
  };

  // ------------------------------------------------------------------ env.py
  var STATE_DIM = 54 * 9 + 20 * 2 + 8;   // 534
  var ACTION_DIM = 54;
  var CARD_ORDER = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

  /** 输入特征分组：顺序、维数与 env.encode_state + encode_action 的拼接顺序逐段对应
   *  （tests/test_feature_names.py 用 Python 的 encode_state 逐组核对）。 */
  var FEATURE_GROUPS = [
    {key: 'my_hand', name: '我的手牌', dim: 54, kind: 'cards'},
    {key: 'unseen', name: '其余两家手牌并集（没见过的牌）', dim: 54, kind: 'cards'},
    {key: 'to_beat', name: '当前要压的牌', dim: 54, kind: 'cards'},
    {key: 'bottom', name: '底牌', dim: 54, kind: 'cards'},
    {key: 'next_last', name: '我的下一家最近一手', dim: 54, kind: 'cards'},
    {key: 'prev_last', name: '我的上一家最近一手', dim: 54, kind: 'cards'},
    {key: 'played_landlord', name: '地主已出的牌', dim: 54, kind: 'cards'},
    {key: 'played_down', name: '农民·下家已出的牌', dim: 54, kind: 'cards'},
    {key: 'played_up', name: '农民·上家已出的牌', dim: 54, kind: 'cards'},
    {key: 'next_left', name: '我的下一家剩余张数', dim: 20, kind: 'onehot', base: 1},
    {key: 'prev_left', name: '我的上一家剩余张数', dim: 20, kind: 'onehot', base: 1},
    {key: 'bombs', name: '已出炸弹数', dim: 8, kind: 'onehot', base: 0},
    {key: 'action', name: '候选动作（这一手要出的牌）', dim: 54, kind: 'cards'}
  ];
  (function () { var off = 0; FEATURE_GROUPS.forEach(function (g) { g.offset = off; off += g.dim; }); })();

  /** 54 维牌组里第 i 维的含义：返回 {rank, copy}（copy 从 1 起；王只有 1 张）。 */
  function cardDim(i) {
    if (i === 52) return {rank: SMALL_JOKER, copy: 1};
    if (i === 53) return {rank: BIG_JOKER, copy: 1};
    return {rank: 3 + Math.floor(i / 4), copy: (i % 4) + 1};
  }
  /** 第 d 维（0..587）的中文名，例如“我的手牌·7·第2张”“我的下一家剩余张数=5”。 */
  function featureName(d) {
    for (var gi = 0; gi < FEATURE_GROUPS.length; gi++) {
      var g = FEATURE_GROUPS[gi];
      if (d >= g.offset && d < g.offset + g.dim) {
        var i = d - g.offset;
        if (g.kind === 'cards') {
          var cd = cardDim(i);
          return g.name + '·' + RANK_NAMES[cd.rank] + (cd.rank >= 16 ? '' : '·第' + cd.copy + '张');
        }
        var v = i + g.base;
        return g.name + '=' + (g.key === 'bombs' && i === g.dim - 1 ? v + '及以上' : String(v));
      }
    }
    return '?';
  }

  function onehot(n, size) {
    var v = new Array(size); for (var i = 0; i < size; i++) v[i] = 0;
    v[Math.max(0, Math.min(size - 1, n))] = 1;
    return v;
  }

  /** seat 视角的 534 维信息集编码（不偷看他人手牌），与 env.encode_state 逐位一致。 */
  function encodeState(g, seat) {
    var unseen = countsFrom(fullDeck()), r, p;
    for (r = 3; r <= 17; r++) unseen[r] -= g.hands[seat][r];
    for (p = 0; p < 3; p++) for (r = 3; r <= 17; r++) unseen[r] -= g.played[p][r];
    for (r = 3; r <= 17; r++) if (unseen[r] < 0) unseen[r] = 0;
    var nxt = (seat + 1) % 3, prv = (seat + 2) % 3, f = [];
    f = f.concat(cards54(g.hands[seat]));
    f = f.concat(cards54(unseen));
    f = f.concat(g.toBeat ? cards54(countsFrom(g.toBeat.cards)) : cards54(emptyCounts()));
    f = f.concat(cards54(countsFrom(g.bottom)));
    f = f.concat(cards54(countsFrom(g.lastAction[nxt].cards)));
    f = f.concat(cards54(countsFrom(g.lastAction[prv].cards)));
    POSITIONS.forEach(function (pos) { f = f.concat(cards54(g.played[g.seatOf(pos)])); });
    f = f.concat(onehot(g.cardsLeft(nxt) - 1, 20));
    f = f.concat(onehot(g.cardsLeft(prv) - 1, 20));
    f = f.concat(onehot(g.bombs, 8));
    return f;
  }
  function encodeAction(move) {
    if (move.type === T.PASS) { var z = []; for (var i = 0; i < 54; i++) z.push(0); return z; }
    return cards54(countsFrom(move.cards));
  }

  // ------------------------------------------------------------------ 随机数（可设种子）
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  root.DDZ = {
    SMALL_JOKER: SMALL_JOKER, BIG_JOKER: BIG_JOKER, NORMAL_RANKS: NORMAL_RANKS, ALL_RANKS: ALL_RANKS,
    RANK_NAMES: RANK_NAMES, CARD_ORDER: CARD_ORDER,
    emptyCounts: emptyCounts, countsFrom: countsFrom, countsTotal: countsTotal, countsToList: countsToList,
    fullDeck: fullDeck, cards54: cards54,
    T: T, TYPE_NAMES: TYPE_NAMES, Move: Move, PASS: PASS, moveKey: moveKey, moveEq: moveEq, moveStr: moveStr,
    beats: beats, genAll: genAll, genLegal: genLegal, classify: classify,
    LANDLORD: LANDLORD, DOWN: DOWN, UP: UP, POSITIONS: POSITIONS, POS_ZH: POS_ZH,
    heuristicBid: heuristicBid, Game: Game,
    STATE_DIM: STATE_DIM, ACTION_DIM: ACTION_DIM, FEATURE_GROUPS: FEATURE_GROUPS,
    cardDim: cardDim, featureName: featureName, encodeState: encodeState, encodeAction: encodeAction,
    mulberry32: mulberry32, shuffle: shuffle
  };
})(typeof window !== 'undefined' ? window : globalThis);
