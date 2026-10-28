// JS 规则引擎 vs Python 引擎的差分测试（夹具由 python -m tools.export_fixtures 生成）。
'use strict';
const {loadPlay, fixture, check, done} = require('./load');
const ctx = loadPlay(['engine.js']);
const D = ctx.DDZ;

const mv = m => [m.type, m.main, m.length, m.cards];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const toMove = a => D.Move(a[0], a[1], a[2], a[3]);

const eng = fixture('engine_cases.json');
let maxLegal = 0;
eng.legal.forEach((c, i) => {
  const legal = D.genLegal(D.countsFrom(c.hand), c.last ? toMove(c.last) : null).map(mv);
  maxLegal = Math.max(maxLegal, legal.length);
  check(same(legal, c.legal), `合法动作列表（含顺序）不一致 #${i}：JS ${legal.length} 个 / Python ${c.legal.length} 个`);
});
eng.classify.forEach((c, i) => {
  check(same(D.classify(c.cards).map(mv), c.out), `classify 不一致 #${i} ${c.cards}`);
});
eng.bids.forEach((c, i) => check(D.heuristicBid(D.countsFrom(c.hand)) === c.bid, `叫分不一致 #${i}`));

const games = fixture('game_cases.json');
let steps = 0;
games.forEach((g, gi) => {
  const G = new D.Game(g.hands.map(h => D.countsFrom(h)), g.bottom, g.landlord, g.base);
  g.steps.forEach((s, si) => {
    steps++;
    check(G.turn === s.seat && G.position(G.turn) === s.position, `第 ${gi} 局第 ${si} 步行动方不一致`);
    const legal = G.legalMoves().map(mv);
    check(same(legal, s.legal), `第 ${gi} 局第 ${si} 步合法动作不一致`);
    const st = D.encodeState(G, G.turn);
    const on = [];
    st.forEach((v, k) => { if (v) on.push(k); });
    check(st.length === 534 && same(on, s.state_on), `第 ${gi} 局第 ${si} 步状态编码不一致`);
    G.step(toMove(s.move));
  });
  check(G.done, `第 ${gi} 局没有结束`);
  const r = g.result;
  check(G.winnerSide === r.winner_side && same(G.scores, r.scores) && G.multiplier === r.multiplier &&
        G.spring === r.spring && G.bombs === r.bombs, `第 ${gi} 局结算不一致`);
});

// 从 tests/test_rules.py 移植的关键断言
const CH = {T: 10, J: 11, Q: 12, K: 13, A: 14, '2': 15, X: 16, D: 17};
const P = s => s.split('').map(c => CH[c] || Number(c));
const has = (ms, t, kw = {}) => ms.some(m => m.type === t && Object.keys(kw).every(k => m[k] === kw[k]));
const T = D.T;
let ms = D.genAll(D.countsFrom(P('334455667789TJQKA22XD')));
check(has(ms, T.STRAIGHT, {main: 3, length: 5}) && has(ms, T.STRAIGHT, {length: 12}), '顺子 34567 / 最长 12 张');
check(!ms.some(m => m.type === T.STRAIGHT && m.cards.includes(15)), '顺子不能含 2');
check(has(ms, T.ROCKET) && has(ms, T.PAIR_CHAIN, {main: 3, length: 3}), '王炸 / 连对');
ms = D.genAll(D.countsFrom(P('3334445556668888')));
check(has(ms, T.PLANE, {main: 3, length: 4}) && has(ms, T.BOMB, {main: 8}) &&
      has(ms, T.QUAD_TWO_PAIR, {main: 8}) && has(ms, T.PLANE_SINGLE, {main: 3, length: 2}), '飞机/炸弹/四带两对/飞机带单');
check(!has(D.genAll(D.countsFrom(P('3333'))), T.TRIO_SINGLE), '3333 无三带一');
check(D.genAll(D.countsFrom(P('8888XD'))).filter(m => m.type === T.QUAD_TWO_SINGLE)
  .every(m => !(m.cards.includes(16) && m.cards.includes(17))), '四带二不拆王炸');
check(D.classify(P('33355577')).length === 0, '33355577 不是牌型');
check(D.classify(P('XD'))[0].type === T.ROCKET, '解析王炸');
check(D.classify(P('33334444')).length === 0, '33334444 不是单一牌型');
const legal = D.genLegal(D.countsFrom(P('3399QQ22')), D.Move(T.PAIR, 9, 1, [9, 9]));
check(legal[0].type === T.PASS && legal.filter(m => m.type === T.PAIR).map(m => m.main).join() === '12,15', '只能用 QQ/22 压 99');
const G = new D.Game([D.countsFrom([3, 3]), D.countsFrom([4, 4]), D.countsFrom([5, 5])], [], 0, 3);
G.step(D.Move(T.PAIR, 3, 1, [3, 3]));
check(G.done && G.spring && G.multiplier === 2 && same(G.scores, [12, -6, -6]), '春天计分 3×2');
const FG = D.FEATURE_GROUPS;
check(FG.reduce((s, g) => s + g.dim, 0) === 588 && FG[FG.length - 1].offset === 534, '特征分组合计 588 维，候选动作从第 534 维起');

console.log(`  合法动作夹具 ${eng.legal.length} 个（最多 ${maxLegal} 个候选），classify ${eng.classify.length} 个，` +
  `叫分 ${eng.bids.length} 个，完整对局 ${games.length} 局 / ${steps} 步`);
done('JS 规则引擎差分测试');
