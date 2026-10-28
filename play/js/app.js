/* 页面主逻辑：模式（观战 / 我来玩 / 练习）、发牌叫分出牌流程、人类操作、新手引导、退出。
 * 规则在 engine.js，网络在 nn.js，大脑面板在 brain.js。纯静态，file:// 下双击即可运行。
 */
(function (root) {
  'use strict';
  var D = root.DDZ, NN = root.DDZNN, Brain = root.Brain;
  var SUITS = ['♠', '♥', '♣', '♦'];
  var ROLE_ZH = D.POS_ZH;
  var KIND_ZH = {random: '随机', greedy: '贪心', dmc: 'DMC', human: '你'};
  var SEAT_POS = ['下座', '右座', '左座'];    // 座位 0 在下方；出牌顺序 0 → 1（右）→ 2（左）
  var DEMO_SEED = 20261012;
  var PRESETS = {
    novice: {name: '新手', kinds: ['random', 'random', 'random'], desc: '随机：在所有合法出牌里随便挑一个。'},
    normal: {name: '普通', kinds: ['greedy', 'greedy', 'greedy'], desc: '贪心规则：能压就用最小的牌压；自己先出时出张数最多的一手；不到万不得已不用炸弹。'},
    hard: {name: '困难', kinds: ['dmc', 'dmc', 'dmc'], desc: 'DMC 网络：三张 Q 网络给每个合法出牌打分，出分最高的那一手。'},
    mixed: {name: '混搭', kinds: ['dmc', 'dmc', 'greedy'], desc: '混搭：右座 DMC 网络、左座贪心规则（观战时下座也是 DMC），同一桌上对比规则和网络。'}
  };
  var SPEEDS = [['慢', 1600], ['中', 900], ['快', 350]];
  var TYPES = [
    [1, [7], '单张：任意一张牌。'], [2, [9, 9], '对子：两张同点。'], [3, [5, 5, 5], '三张：三张同点。'],
    [4, [8, 8, 8, 3], '三带一：三张 + 一张别的牌（不能是同点的第四张）。'], [5, [10, 10, 10, 4, 4], '三带二：三张 + 一对。'],
    [6, [3, 4, 5, 6, 7], '顺子：至少 5 张连续单牌，只能用 3 到 A（不含 2 和王）。'], [7, [5, 5, 6, 6, 7, 7], '连对：至少 3 对连续的对子，只能用 3 到 A。'],
    [8, [6, 6, 6, 7, 7, 7], '飞机：至少 2 组连续的三张。'], [9, [9, 9, 9, 10, 10, 10, 3, 5], '飞机带单：每组三张各带一张单牌。'],
    [10, [11, 11, 11, 12, 12, 12, 4, 4, 8, 8], '飞机带对：每组三张各带一对。'], [11, [7, 7, 7, 7, 3, 9], '四带二单：四张 + 两张单牌。'],
    [12, [13, 13, 13, 13, 5, 5, 6, 6], '四带两对：四张 + 两个不同的对子。'], [13, [12, 12, 12, 12], '炸弹：四张同点，能压除王炸、更大炸弹以外的任何牌，倍数 ×2。'],
    [14, [16, 17], '王炸：大小王，最大，倍数 ×2。']
  ];
  var TASKS = [
    {id: 'types', text: '在「牌型图鉴」里点开 3 种牌型看看例子', el: 'types'},
    {id: 'bid', text: '叫一次分（叫或不叫都算）', el: 'me-actions'},
    {id: 'hint', text: '用一次 💡 提示（或在大脑面板点「看看网络怎么想」）', el: 'hint-btn'},
    {id: 'chain', text: '自己选牌，出一手顺子、连对或飞机', el: 'me-hand'},
    {id: 'cand', text: '在大脑面板的输出列表里点一行，看网络给那一手的打分', el: 'brain-body'},
    {id: 'knock', text: '在大脑面板的网络图上点一个神经元把它敲掉（看完点「恢复神经元」）', el: 'brain-body'},
    {id: 'all', text: '把大脑面板切到「全部」，同时看三个大脑', el: 'brain-tabs'},
    {id: 'win', text: '赢一局（对手：新手）', el: null}
  ];
  var TIPS = {
    'mode-watch': {t: '三个 AI 自动对打，右边实时显示它们的大脑。打开页面默认就是这个模式。'},
    'mode-play': {t: '你坐下座，和两个 AI 打。对手的大脑在本局结束前锁住（防止偷看手牌）。'},
    'mode-practice': {t: '带任务清单的「我来玩」，对手默认是新手（随机出牌），做完一项自动打勾。'},
    select: {demo: 'select', t: '点一张牌把它抬起来（选中），再点一次放下。可以连着点多张，选好后按回车出牌。'},
    play: {demo: 'play', t: '把选中的牌打出去（快捷键：回车）。牌型不对或压不过时会提示原因。'},
    pass: {t: '这一轮不出（快捷键：空格）。轮到你自由出牌时不能过。'},
    hint: {demo: 'select', t: '让你这个身份的网络挑分最高的一手，并替你选好牌（快捷键：T）。网络和你一样看不到对手的牌，所以公平。'},
    knock: {demo: 'knock', t: '在右边网络图上点圆点或方阵格子 = 把这个神经元置零（敲掉），网络会重新给所有候选打分，看它会不会改主意。这个按钮一键全部恢复。'},
    step: {demo: 'step', t: '暂停后每点一次只走一步：叫一次分或出一手牌（快捷键：N）。'},
    pause: {t: '暂停 / 继续（快捷键：P）。暂停时可以慢慢看大脑面板。'},
    open: {t: '明牌：显示所有人的手牌。观战时默认打开；我来玩时打开就等于作弊，同时解锁对手的大脑。'},
    follow: {t: '打开时，大脑面板自动切到正在出牌的那一家；用 ◀ ▶ 翻看以前的决策时会自动关掉。'},
    bigscreen: {t: '投影用：左右比例从约 45:55 调到 35:65，大脑面板更大。'},
    cand: {demo: 'cand', t: '每一行是一个候选出牌和网络给它的 Q。点一行，网络图就换成“给这一手打分时”的激活。'}
  };

  var A = {
    mode: 'watch', preset: {watch: 'hard', play: 'hard', practice: 'novice'}, kinds: null,
    speed: 900, paused: false, open: {watch: true, play: false, practice: false},
    human: null, deal: null, dealNo: 0, seed: DEMO_SEED, decId: 0,
    totals: null, timers: [], sel: {}, tasks: {}, typesSeen: {}, stopped: false
  };
  var nets = NN.loadModel(root.DDZ_MODEL);
  var MU = root.MobileUI || null;     // 手机竖屏工具（js/mobile.js），没有也能跑
  var sheets = null;                  // 手机上的全屏面板控制器（看大脑 / 选项）
  var noise = D.mulberry32(7);
  var dmc = new NN.DMCAgent(nets, noise);
  var greedy = new NN.GreedyAgent();
  var random = new NN.RandomAgent(D.mulberry32(11));

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
  function store(k, v) { try { if (v === undefined) return root.localStorage.getItem(k); root.localStorage.setItem(k, v); } catch (e) { return null; } return null; }
  function later(fn, ms) { var t = setTimeout(function () { A.timers = A.timers.filter(function (x) { return x !== t; }); fn(); }, ms); A.timers.push(t); return t; }
  function clearTimers() { A.timers.forEach(clearTimeout); A.timers = []; }
  function toast(msg, err) {
    var t = $('toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(t._h); t._h = setTimeout(function () { t.className = ''; }, 2200);
  }
  function moveText(m) {
    if (m.type === D.T.PASS) return '过';
    return D.TYPE_NAMES[m.type] + ' ' + m.cards.slice().reverse().map(function (r) { return D.RANK_NAMES[r]; }).join(' ');
  }
  function argmax(q) { var b = 0; for (var i = 1; i < q.length; i++) if (q[i] > q[b]) b = i; return b; }
  function fmtQ(v) { return (v >= 0 ? '+' : '') + v.toFixed(2); }

  // ------------------------------------------------------------------ 牌面
  function sortSuited(cards) {
    return cards.slice().sort(function (a, b) { return (b.r - a.r) || (SUITS.indexOf(a.s) - SUITS.indexOf(b.s)); });
  }
  function cardHTML(c, cls, idx) {
    cls = cls || '';
    var attr = idx === undefined ? '' : ' data-i="' + idx + '"';
    if (c.r >= 16) return '<span class="card joker' + (c.r === 17 ? ' big' : '') + ' ' + cls + '"' + attr + '>' + D.RANK_NAMES[c.r] + '</span>';
    var red = (c.s === '♥' || c.s === '♦') ? ' red' : '';
    return '<span class="card' + red + ' ' + cls + '"' + attr + '><span class="rk">' + D.RANK_NAMES[c.r] + '</span><span class="st">' + c.s + '</span></span>';
  }
  function cardsHTML(cards, cls) { return cards.map(function (c) { return cardHTML(c, cls); }).join(''); }
  function plainCards(ranks) { return ranks.map(function (r) { return {r: r, s: SUITS[r % 4]}; }); }

  // ------------------------------------------------------------------ 发牌 / 叫分（对应 server.py 的 Session）
  function seatKind(seat) { return seat === A.human ? 'human' : A.kinds[seat]; }
  function seatName(seat) {
    if (seat === A.human) return '你';
    return SEAT_POS[seat] + ' · ' + KIND_ZH[A.kinds[seat]];
  }
  function log(msg, sys) { A.deal.log.push({t: msg, sys: !!sys}); }

  function newDeal(keepSeed, redeal) {
    clearTimers();
    if (!keepSeed) A.seed += 1;
    var rnd = D.mulberry32(A.seed), deck = [];
    for (var r = 3; r <= 15; r++) SUITS.forEach(function (s) { deck.push({r: r, s: s}); });
    deck.push({r: 16, s: ''}, {r: 17, s: ''});
    D.shuffle(deck, rnd);
    var first = Math.floor(rnd() * 3), prevLog = A.deal ? A.deal.log.slice(-20) : [];
    A.deal = {
      rnd: rnd, suited: [0, 1, 2].map(function (i) { return sortSuited(deck.slice(i * 17, i * 17 + 17)); }),
      suitedBottom: sortSuited(deck.slice(51)), phase: 'bidding', bidOrder: [first, (first + 1) % 3, (first + 2) % 3],
      bidIdx: 0, bids: [], currentBid: 0, bidWinner: null, redeals: redeal && A.deal ? A.deal.redeals : 0,
      game: null, lastSuited: [null, null, null], acted: [false, false, false], log: prevLog, decisions: [], over: null
    };
    if (!redeal) A.dealNo += 1;
    A.sel = {};
    log('—— 第 ' + A.dealNo + ' 局：发牌，从' + SEAT_POS[first] + '开始叫分 ——', true);
    Brain.onNewDeal();
    renderAll();
    schedule(A.speed * 0.6);
  }

  function handCounts(seat) { return D.countsFrom(A.deal.suited[seat].map(function (c) { return c.r; })); }

  function applyBid(seat, bid) {
    var d = A.deal;
    d.bids.push({seat: seat, bid: bid});
    log(SEAT_POS[seat] + (seat === A.human ? '（你）' : '') + '：' + (bid ? '叫 ' + bid + ' 分' : '不叫'));
    if (bid > d.currentBid) { d.currentBid = bid; d.bidWinner = seat; }
    d.bidIdx += 1;
    if (d.currentBid === 3 || d.bidIdx >= 3) finishBidding();
  }

  function finishBidding() {
    var d = A.deal;
    if (d.bidWinner === null) {
      d.redeals += 1;
      if (d.redeals >= 20) { d.bidWinner = d.bidOrder[0]; d.currentBid = 1; log('连续流局，首叫者以 1 分当地主。', true); }
      else { log('三家都不叫，流局重新发牌。', true); newDeal(false, true); return; }
    }
    var counts = [0, 1, 2].map(handCounts);
    d.game = new D.Game(counts, d.suitedBottom.map(function (c) { return c.r; }), d.bidWinner, d.currentBid);
    d.suited[d.bidWinner] = sortSuited(d.suited[d.bidWinner].concat(d.suitedBottom));
    d.phase = 'playing';
    log((d.bidWinner === A.human ? '你' : SEAT_POS[d.bidWinner]) + ' 成为地主（' + d.currentBid + ' 分），底牌 ' +
      d.suitedBottom.map(function (c) { return D.RANK_NAMES[c.r]; }).join(' '), true);
  }

  function takeSuited(seat, ranks) {
    var hand = A.deal.suited[seat], taken = [];
    ranks.slice().sort(function (a, b) { return a - b; }).forEach(function (r) {
      for (var i = 0; i < hand.length; i++) if (hand[i].r === r) { taken.push(hand.splice(i, 1)[0]); return; }
    });
    return sortSuited(taken);
  }

  function applyMove(seat, move) {
    var d = A.deal, g = d.game, role = g.position(seat);
    if (move.type === D.T.PASS) { d.lastSuited[seat] = null; log(SEAT_POS[seat] + '［' + ROLE_ZH[role] + '］' + (seat === A.human ? '（你）' : '') + '：过'); }
    else {
      d.lastSuited[seat] = takeSuited(seat, move.cards);
      log(SEAT_POS[seat] + '［' + ROLE_ZH[role] + '］' + (seat === A.human ? '（你）' : '') + '：' + moveText(move));
    }
    d.acted[seat] = true;
    g.step(move);
    if (g.done) onOver();
  }

  function onOver() {
    var d = A.deal, g = d.game;
    d.phase = 'over';
    var side = g.winnerSide === D.LANDLORD ? '地主' : '农民';
    d.over = {side: side, scores: g.scores.slice(), multiplier: g.multiplier, spring: g.spring};
    A.totals.games += 1;
    for (var i = 0; i < 3; i++) { A.totals.scores[i] += g.scores[i]; if (g.scores[i] > 0) A.totals.wins[i] += 1; }
    log('★ ' + side + '获胜，倍数 ×' + g.multiplier + (g.spring ? '（春天）' : '') + '，得分 ' +
      g.scores.map(function (s, k) { return SEAT_POS[k] + (s > 0 ? '+' : '') + s; }).join(' / '), true);
    if (A.human !== null && g.scores[A.human] > 0 && A.mode === 'practice' && A.kinds[1] === 'random' && A.kinds[2] === 'random') task('win');
  }

  // ------------------------------------------------------------------ 决策（每一步都给行动方的网络打分，供大脑面板显示）
  function observe(seat) {
    var g = A.deal.game;
    return {seat: seat, position: g.position(seat), state: D.encodeState(g, seat), legal: g.legalMoves()};
  }
  function record(obs, chosen, kind, pending) {
    var q0 = NN.scoreAll(nets[obs.position], obs.state, obs.legal);
    var dec = {id: ++A.decId, role: obs.position, seat: obs.seat, state: obs.state, legal: obs.legal, q0: q0,
      chosen: chosen, kind: kind, actorName: seatName(obs.seat) + '（' + KIND_ZH[kind] + '）', pending: !!pending};
    if (kind === 'human') dec.actorName = '你';
    A.deal.decisions.push(dec);
    return dec;
  }

  function aiMove(seat) {
    var obs = observe(seat), kind = A.kinds[seat], idx;
    if (kind === 'dmc') {
      var mk = Brain.masksFor(obs.position);
      if (obs.legal.length === 1) idx = 0;
      else idx = dmc.pick(mk ? NN.scoreAll(nets[obs.position], obs.state, obs.legal, mk) : NN.scoreAll(nets[obs.position], obs.state, obs.legal));
    } else {
      var m = (kind === 'greedy' ? greedy : random).act(obs);
      idx = obs.legal.findIndex(function (x) { return D.moveEq(x, m); });
    }
    var dec = record(obs, idx, kind);
    explainMove(dec);
    applyMove(seat, obs.legal[idx]);
    Brain.onDecision(dec);
  }

  function humanPending() {
    var d = A.deal, g = d.game;
    var last = d.decisions[d.decisions.length - 1];
    if (last && last.pending) return last;
    var dec = record(observe(A.human), null, 'human', true);
    Brain.onDecision(dec);
    return dec;
  }

  // ------------------------------------------------------------------ 主循环
  function schedule(ms) {
    clearTimers();
    if (A.paused || A.stopped) return;
    later(function () { if (advance()) schedule(A.deal.phase === 'bidding' ? A.speed * 0.6 : A.speed); }, ms);
  }

  /** 走一步；返回 true 表示还会继续自动走（没在等人）。 */
  function advance() {
    var d = A.deal;
    if (!d || A.stopped) return false;
    if (d.phase === 'bidding') {
      var seat = d.bidOrder[d.bidIdx];
      if (seat === A.human) { renderAll(); return false; }
      var b = D.heuristicBid(handCounts(seat));
      applyBid(seat, b > d.currentBid ? b : 0);
      setExplain('叫分阶段：每家看自己的牌估一个分（2、王、炸弹越多叫得越高），叫得最高的当地主。<b>叫分用的是简单规则，不是神经网络</b>；网络只负责出牌。');
      renderAll();
      return d === A.deal;
    }
    if (d.phase === 'playing') {
      var g = d.game;
      if (g.turn === A.human) { humanPending(); setExplain(humanExplain()); renderAll(); return false; }
      aiMove(g.turn);
      renderAll();
      if (d.phase === 'over') { afterOver(); return false; }
      return true;
    }
    return false;
  }

  function afterOver() {
    renderAll();
    Brain.render();
    if (A.mode === 'watch' && !A.paused) later(function () { newDeal(); }, Math.max(2600, A.speed * 3));
  }

  // ------------------------------------------------------------------ 人类操作
  function humanBid(b) {
    var d = A.deal;
    if (!d || d.phase !== 'bidding' || d.bidOrder[d.bidIdx] !== A.human) return;
    if (b !== 0 && b <= d.currentBid) { toast('必须叫得比当前 ' + d.currentBid + ' 分高，或者不叫', true); return; }
    task('bid');
    applyBid(A.human, b);
    renderAll();
    schedule(A.speed * 0.6);
  }

  function selectedRanks() {
    var hand = A.deal.suited[A.human];
    return Object.keys(A.sel).filter(function (i) { return A.sel[i]; }).map(function (i) { return hand[+i].r; });
  }

  function humanPlay(pass) {
    var d = A.deal;
    if (!d || d.phase !== 'playing' || d.game.turn !== A.human) return;
    var g = d.game, move;
    if (pass) {
      if (!g.toBeat) { toast('自由出牌时不能过，请任选一手牌', true); return; }
      move = D.PASS;
    } else {
      var ranks = selectedRanks();
      if (!ranks.length) { toast('请先点牌选中，或者选择「过」', true); return; }
      var interp = D.classify(ranks).filter(function (m) { return m.type !== D.T.PASS; });
      var valid = interp.filter(function (m) { return !g.toBeat || D.beats(m, g.toBeat); });
      if (!valid.length) { toast(interp.length ? moveText(interp[0]) + ' 压不过 ' + moveText(g.toBeat) : '这不是合法牌型', true); return; }
      move = valid[0];
      if ([D.T.STRAIGHT, D.T.PAIR_CHAIN, D.T.PLANE, D.T.PLANE_SINGLE, D.T.PLANE_PAIR].indexOf(move.type) >= 0 && !A.usedHintForThis) task('chain');
    }
    var dec = humanPending();
    var idx = dec.legal.findIndex(function (m) { return D.moveEq(m, move); });
    dec.chosen = idx; dec.pending = false;
    A.sel = {}; A.usedHintForThis = false;
    applyMove(A.human, move);
    var best = argmax(dec.q0);
    setExplain('你出了 <b>' + esc(moveText(move)) + '</b>。你这个身份的网络在 ' + dec.legal.length + ' 个合法出牌里最看好 <b>' +
      esc(moveText(dec.legal[best])) + '</b>（Q ' + fmtQ(dec.q0[best]) + '）' + (idx === best ? '——和你想的一样。' : (idx >= 0 ? '；你出的这手 Q ' + fmtQ(dec.q0[idx]) + '。' : '。')));
    Brain.onDecision(dec);
    renderAll();
    if (d.phase === 'over') { afterOver(); return; }
    schedule(A.speed);
  }

  function hint() {
    var d = A.deal;
    if (!d || d.phase !== 'playing' || d.game.turn !== A.human) return;
    var dec = humanPending(), mk = Brain.masksFor(dec.role);
    var q = mk ? NN.scoreAll(nets[dec.role], dec.state, dec.legal, mk) : dec.q0;
    var m = dec.legal[dec.legal.length === 1 ? 0 : dmc.pick(q)];
    task('hint');
    A.usedHintForThis = true;
    Brain.reveal(dec.id);
    A.sel = {};
    if (m.type === D.T.PASS) { toast('网络建议：过'); renderAll(); return; }
    var need = m.cards.slice();
    d.suited[A.human].forEach(function (c, i) {
      var k = need.indexOf(c.r);
      if (k >= 0) { A.sel[i] = true; need.splice(k, 1); }
    });
    toast('网络建议：' + moveText(m));
    renderAll();
  }

  // ------------------------------------------------------------------ 讲解文字
  function setExplain(html) { A.explain = html; }
  function explainMove(dec) {
    var best = argmax(dec.q0), m = dec.legal[dec.chosen], who = SEAT_POS[dec.seat] + '（' + ROLE_ZH[dec.role] + '）';
    if (dec.legal.length === 1) { setExplain(who + '只有一个选择：<b>' + esc(moveText(m)) + '</b>，不用打分。'); return; }
    var base = who + '有 <b>' + dec.legal.length + '</b> 个合法出牌。';
    if (dec.kind === 'dmc') {
      var extra = m.type === D.T.PASS ? '网络认为这时候“过”比任何压牌都好——比如队友刚出的牌，或者想留着大牌。' : '';
      var mk = Brain.masksFor(dec.role) ? '（这张网络有神经元被敲掉了，选择可能和平时不同）' : '';
      setExplain(base + '网络给每一个打分，最高的是 <b>' + esc(moveText(dec.legal[best])) + '</b>（Q ' + fmtQ(dec.q0[best]) + '），于是出了 <b>' + esc(moveText(m)) + '</b>。' + extra + mk);
    } else {
      setExplain(base + '这一家按<b>' + KIND_ZH[dec.kind] + '</b>出了 <b>' + esc(moveText(m)) + '</b>（网络给它 Q ' + fmtQ(dec.q0[dec.chosen]) +
        '）；如果换成网络，会出 <b>' + esc(moveText(dec.legal[best])) + '</b>（Q ' + fmtQ(dec.q0[best]) + '）。');
    }
  }
  function isTouchUI() { return document.body.classList.contains('touchp'); }
  function humanExplain() {
    var g = A.deal.game;
    return '<b>轮到你出牌</b>（你是' + ROLE_ZH[g.position(A.human)] + '）。' +
      (isTouchUI() ? '点牌选中，再点「出牌」；压不过点「不出」。' : '点牌选中，回车出牌，空格不出，T 提示。') +
      (g.toBeat ? '要压的是 <b>' + esc(moveText(g.toBeat)) + '</b>，压不过可以过。' : '现在是自由出牌，可以出任意牌型。');
  }

  // ------------------------------------------------------------------ 渲染
  function renderAll() {
    if (A.stopped || !A.deal) return;
    renderSeats(); renderCenter(); renderMe(); renderInfo(); renderCounter(); renderScores(); renderLog(); renderBanner(); renderTasks();
  }

  function isOpen() { return A.mode === 'watch' ? A.open.watch : A.open[A.mode]; }

  function badgeHTML(seat) {
    var d = A.deal, g = d.game, role = g ? g.position(seat) : null;
    var turn = (d.phase === 'playing' && g.turn === seat) || (d.phase === 'bidding' && d.bidOrder[d.bidIdx] === seat);
    var left = g ? g.cardsLeft(seat) : 17, danger = g && left <= 2 && d.phase !== 'over';
    var roleHTML = role ? '<span class="role role-' + role + '">' + (role === D.LANDLORD ? '👑 ' : '') + ROLE_ZH[role] + '</span>' :
      '<span class="role muted">' + bidText(seat) + '</span>';
    return '<div class="badge' + (turn ? ' turn' : '') + (danger ? ' danger' : '') + '"><span class="nm">' + esc(seatName(seat)) + '</span>' +
      roleHTML + '<span class="cnt">剩 <b>' + left + '</b> 张' + (danger ? ' ⚠' : '') + '</span></div>';
  }
  function bidText(seat) {
    var b = A.deal.bids.filter(function (x) { return x.seat === seat; })[0];
    return b ? (b.bid ? '叫 ' + b.bid + ' 分' : '不叫') : '等待叫分';
  }
  function frontHTML(seat) {
    var d = A.deal;
    if (!d.acted[seat] || !d.game) return '';
    var lm = d.game.lastAction[seat];
    if (lm.type === D.T.PASS) return '<span class="passmark">过</span>';
    return cardsHTML(d.lastSuited[seat] || [], 'sm') + '<span class="typetag">' + D.TYPE_NAMES[lm.type] + '</span>';
  }
  function renderSeats() {
    [[2, 'seat-left'], [1, 'seat-right']].forEach(function (p) {
      var seat = p[0], d = A.deal, cards = d.suited[seat];
      var showHand = isOpen() || d.phase === 'over';
      var hand = showHand ? '<div class="mini-hand">' + cardsHTML(cards, 'sm') + '</div>' : '<div class="backs">🂠 × ' + cards.length + '</div>';
      $(p[1]).innerHTML = badgeHTML(seat) + hand + '<div class="front">' + frontHTML(seat) + '</div>';
    });
  }
  function renderCenter() {
    var d = A.deal, g = d.game, html;
    if (d.phase === 'bidding') html = '叫分中<br>当前最高 <b>' + d.currentBid + '</b> 分';
    else {
      html = '底牌 ' + d.suitedBottom.map(function (c) { return D.RANK_NAMES[c.r]; }).join(' ') + '<br>底分 <b>' + g.base + '</b> · 炸弹 <b>' + g.bombs +
        '</b> · 倍数 <b>×' + (g.base * Math.pow(2, g.bombs)) + '</b><br>';
      if (d.phase === 'over') html += '本局结束';
      else if (g.toBeat) html += '要压：<b>' + esc(moveText(g.toBeat)) + '</b><br><span class="muted small">（' + SEAT_POS[g.lastMover] + ' 出的）</span>';
      else html += '<b>自由出牌</b>';
    }
    $('center-info').innerHTML = '<div class="box">' + html + '</div>';
  }
  function renderMe() {
    var d = A.deal, seat = 0, isHuman = A.human === 0, g = d.game;
    var hand = d.suited[seat], myTurn = isHuman && d.phase === 'playing' && g.turn === 0;
    var bidTurn = isHuman && d.phase === 'bidding' && d.bidOrder[d.bidIdx] === 0;
    $('front-me').innerHTML = frontHTML(seat);
    var hEl = $('me-hand');
    hEl.className = 'hand' + (isHuman ? ' clickable' : '');
    hEl.innerHTML = hand.map(function (c, i) { return cardHTML(c, A.sel[i] ? 'sel' : '', i); }).join('');
    $('me-zone').className = (myTurn || bidTurn) ? 'turn' : '';
    var acts = '', st = '';
    if (!isHuman) {
      st = esc(seatName(0)) + (g ? ' · <span class="role-' + g.position(0) + '">' + ROLE_ZH[g.position(0)] + '</span>' : ' · ' + bidText(0)) + ' · 剩 <b>' + (g ? g.cardsLeft(0) : 17) + '</b> 张' +
        ((d.phase === 'playing' && g.turn === 0) || (d.phase === 'bidding' && d.bidOrder[d.bidIdx] === 0) ? ' · <b>出牌中…</b>' : '');
    } else if (d.phase === 'bidding') {
      st = bidTurn ? '<b>轮到你叫分</b>（叫得越高，输赢越大）' : '叫分中…（你：' + bidText(0) + '）';
      if (bidTurn) acts = '<button class="btn cbtn" data-bid="0">不叫</button>' + [1, 2, 3].map(function (b) {
        return '<button class="btn primary cbtn" data-bid="' + b + '"' + (b <= d.currentBid ? ' disabled' : '') + '>' + b + ' 分</button>';
      }).join('');
    } else if (d.phase === 'playing') {
      st = myTurn ? '<b>轮到你出牌</b>（你是 <span class="role-' + g.position(0) + '">' + ROLE_ZH[g.position(0)] + '</span>）' : '等待 ' + SEAT_POS[g.turn] + ' 出牌…（你是 ' + ROLE_ZH[g.position(0)] + '）';
      acts = '<button class="btn cbtn" id="hint-btn" data-act="hint" data-tip="hint"' + (myTurn ? '' : ' disabled') + '>💡 提示</button>' +
        '<button class="btn cbtn" data-act="clear"' + (Object.keys(A.sel).some(function (k) { return A.sel[k]; }) ? '' : ' disabled') + '>清空</button>' +
        '<button class="btn cbtn" data-act="pass" data-tip="pass"' + (myTurn && g.toBeat ? '' : ' disabled') + '>不出</button>' +
        '<button class="btn go cbtn" data-act="play" data-tip="play"' + (myTurn ? '' : ' disabled') + '>出牌</button>';
    } else {
      st = '本局结束';
      acts = '<button class="btn primary cbtn" data-act="new">再来一局</button>';
    }
    $('status-line').innerHTML = st;
    $('me-actions').innerHTML = acts;
    $('me-badge').textContent = isHuman ? '快捷键：回车 出牌 · 空格 不出 · T 提示 · Esc 清空 · H 说明' : '观战中：下座也是 AI。切到「我来玩」自己坐下。';
  }
  function renderInfo() { $('explain').innerHTML = A.explain || ''; $('mob-explain').innerHTML = A.explain || ''; }
  function renderCounter() {
    var d = A.deal, g = d.game, cnt = D.countsFrom(D.fullDeck()), r, p;
    if (A.human !== null) {
      $('counter-h').textContent = '记牌器（除你手牌和已出的牌）';
      var mine = handCounts(A.human);
      for (r = 3; r <= 17; r++) cnt[r] -= mine[r];
    } else $('counter-h').textContent = '记牌器（还没出的牌）';
    if (g) for (p = 0; p < 3; p++) for (r = 3; r <= 17; r++) cnt[r] -= g.played[p][r];
    var order = [17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3];
    $('counter').innerHTML = order.map(function (r) {
      var n = Math.max(0, cnt[r]);
      return '<div class="cnt-cell' + (n ? '' : ' zero') + '">' + (r >= 16 ? (r === 17 ? '大王' : '小王') : D.RANK_NAMES[r]) + '<b>' + n + '</b></div>';
    }).join('');
  }
  function renderScores() {
    var t = A.totals;
    $('scores').innerHTML = [0, 1, 2].map(function (i) {
      var v = t.scores[i];
      return esc(seatName(i)) + '：<b style="color:' + (v > 0 ? '#7fe39b' : v < 0 ? '#ff8f8f' : '#ddd') + '">' + (v > 0 ? '+' : '') + v + '</b> 分，胜 ' + t.wins[i];
    }).join('<br>') + '<br><span class="muted small">已打完 ' + t.games + ' 局</span>';
  }
  function renderLog() {
    var el = $('log');
    el.innerHTML = A.deal.log.slice(-60).map(function (l) { return '<div class="' + (l.sys ? 'sys' : '') + '">' + esc(l.t) + '</div>'; }).join('');
    el.scrollTop = 1e9;
  }
  function renderBanner() {
    var d = A.deal, b = $('result-banner');
    if (d.phase !== 'over' || !d.over) { b.hidden = true; return; }
    var o = d.over, you = A.human !== null ? (o.scores[A.human] > 0 ? '🎉 你赢了！' : '你输了') : o.side + '获胜';
    b.innerHTML = '<h3>' + you + '</h3><div>' + o.side + '方获胜，倍数 ×' + o.multiplier + (o.spring ? '（春天 ×2）' : '') + '</div><div class="small">' +
      o.scores.map(function (s, i) { return esc(seatName(i)) + ' ' + (s > 0 ? '+' : '') + s; }).join('　') + '</div>' +
      (A.mode === 'watch' ? '<div class="muted small">' + (A.paused ? '已暂停：点「新一局」继续' : '几秒后自动开下一局') + '</div>' :
        '<div class="row"><button class="btn primary" data-act="new">再来一局</button></div><div class="muted small">对手的大脑已解锁，可以在右边翻看它们每一步的打分。</div>');
    b.hidden = false;
  }

  // ------------------------------------------------------------------ 选项面板
  function renderPresets() {
    var key = A.preset[A.mode];
    $('preset-scope').textContent = A.mode === 'watch' ? '（三个座位）' : '（两个对手）';
    $('presets').innerHTML = Object.keys(PRESETS).map(function (k) {
      return '<button class="preset' + (k === key ? ' active' : '') + '" data-preset="' + k + '">' + PRESETS[k].name + '</button>';
    }).join('') + (key === 'custom' ? '<button class="preset active">自定义</button>' : '');
    $('preset-desc').textContent = key === 'custom' ? '自定义：按下面的“细调”逐个座位设置。' : PRESETS[key].desc;
    $('seat-kinds').innerHTML = [0, 1, 2].map(function (s) {
      if (s === A.human) return '<span>' + SEAT_POS[s] + '：你</span>';
      return '<label>' + SEAT_POS[s] + ' <select data-seat="' + s + '">' + ['random', 'greedy', 'dmc'].map(function (k) {
        return '<option value="' + k + '"' + (A.kinds[s] === k ? ' selected' : '') + '>' + KIND_ZH[k] + '</option>';
      }).join('') + '</select></label>';
    }).join('');
  }
  function setPreset(k) {
    A.preset[A.mode] = k;
    A.kinds = PRESETS[k].kinds.slice();
    renderPresets(); renderAll();
    toast('对手强度：' + PRESETS[k].name + '（从下一手起生效）');
  }
  function renderPlayback() {
    $('pause-btn').textContent = $('mob-pause').textContent = A.paused ? '▶ 继续' : '⏸ 暂停';
    $('step-btn').disabled = $('mob-step').disabled = !A.paused;
    $('menu-open').textContent = (isOpen() ? '✔ ' : '') + (A.mode === 'watch' ? '明牌（看全部手牌）' : '明牌（作弊）');
    $('speed').value = A.speed;
    $('speed-val').textContent = (A.speed / 1000).toFixed(2) + ' 秒';
    $('speed-presets').innerHTML = SPEEDS.map(function (s) {
      return '<button class="btn small' + (Math.abs(A.speed - s[1]) < 1 ? ' on' : '') + '" data-speed="' + s[1] + '">' + s[0] + '</button>';
    }).join('');
    $('open-toggle').checked = isOpen();
    $('open-label').textContent = A.mode === 'watch' ? '明牌（看全部手牌）' : '明牌（作弊）';
  }

  // ------------------------------------------------------------------ 练习
  function task(id) {
    if (A.tasks[id]) return;
    if (A.mode !== 'practice' && id !== 'types') return;
    A.tasks[id] = true;
    store('ddz-tasks', JSON.stringify(A.tasks));
    var t = TASKS.filter(function (x) { return x.id === id; })[0];
    if (t && A.mode === 'practice') toast('✔ 完成：' + t.text);
    renderTasks();
  }
  function renderTasks() {
    var panel = $('practice-panel');
    panel.hidden = A.mode !== 'practice';
    document.querySelectorAll('.pulse').forEach(function (e) { e.classList.remove('pulse'); });
    $('ctrl-toggle').textContent = '选项';
    if (A.mode !== 'practice') return;
    var next = null;
    $('tasks').innerHTML = TASKS.map(function (t) {
      var done = !!A.tasks[t.id], isNext = !done && !next;
      if (isNext) next = t;
      return '<li class="' + (done ? 'done' : '') + (isNext ? ' next' : '') + '">' + esc(t.text) + '</li>';
    }).join('');
    var n = TASKS.filter(function (t) { return A.tasks[t.id]; }).length;
    $('task-progress').textContent = n + ' / ' + TASKS.length + (n === TASKS.length ? ' 全部完成！' : '');
    $('ctrl-toggle').textContent = '任务 ' + n + '/' + TASKS.length;
    if (next && next.el && $(next.el)) $(next.el).classList.add('pulse');
  }
  function renderTypes() {
    $('types').innerHTML = TYPES.map(function (t, i) { return '<button class="btn" data-type="' + i + '">' + D.TYPE_NAMES[t[0]] + '</button>'; }).join('');
  }
  function showType(i) {
    var t = TYPES[i];
    A.typesSeen[i] = true;
    $('type-demo').innerHTML = '<div class="cards">' + plainCards(t[1].slice().sort(function (a, b) { return b - a; })).map(function (c, k) {
      return cardHTML(c, 'sm').replace('class="card', 'style="animation-delay:' + (k * 0.08) + 's" class="card');
    }).join('') + '</div>' + esc(t[2]);
    if (Object.keys(A.typesSeen).length >= 3) task('types');
  }

  // ------------------------------------------------------------------ 模式
  function setMode(mode) {
    clearTimers();
    A.mode = mode;
    A.human = mode === 'watch' ? null : 0;
    A.kinds = (A.preset[mode] === 'custom' ? A.kinds : PRESETS[A.preset[mode]].kinds).slice();
    A.totals = {scores: [0, 0, 0], wins: [0, 0, 0], games: 0};
    A.paused = false;
    A.dealNo = 0;
    A.seed = mode === 'watch' ? DEMO_SEED : DEMO_SEED + (mode === 'play' ? 1000 : 2000);
    document.querySelectorAll('.mode').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-mode') === mode); });
    ['watch', 'play', 'practice'].forEach(function (m) { document.body.classList.toggle('m-' + m, m === mode); });
    if (sheets) sheets.close();
    A.deal = null;
    A.explain = mode === 'watch' ? '三个 AI 自动对打。右边是正在出牌那一家的“大脑”：它把每个合法出牌都送进网络打一个分（Q），出分最高的。' :
      mode === 'play' ? '你坐在下座。先叫分，再出牌。对手的大脑在本局结束前锁住，你自己身份的网络可以随时看（等同于提示）。' :
      '练习模式：照着左边的任务清单一项项做，做完自动打勾。对手默认是「新手」（随机出牌）。';
    renderPresets(); renderPlayback(); renderTypes();
    newDeal(true);
  }

  // ------------------------------------------------------------------ 悬停提示（带动画）
  var tipTimer = null;
  function demoHTML(kind) {
    if (kind === 'select') return '<div class="demo demo-select"><div class="dc">7</div><div class="dc">8</div><div class="dc">9</div><div class="ptr"></div></div>';
    if (kind === 'play') return '<div class="demo demo-play"><div class="dc">Q</div><div class="dc">Q</div><span class="key">回车</span></div>';
    if (kind === 'knock') return '<div class="demo demo-knock"><div class="nd"></div><div class="nd"></div><div class="nd"></div><div class="ptr"></div></div>';
    if (kind === 'cand') return '<div class="demo demo-cand"><div class="bar"></div><div class="bar"></div><div class="bar"></div><div class="ptr"></div></div>';
    if (kind === 'step') return '<div class="demo demo-step"><div class="dc">3</div><div class="dc">4</div><div class="dc">5</div></div>';
    return '';
  }
  function onTipOver(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-tip]') : null, tip = $('tip');
    if (!t) return;
    var info = TIPS[t.getAttribute('data-tip')];
    if (!info) return;
    clearTimeout(tipTimer);
    tipTimer = setTimeout(function () {
      if (A.stopped) return;
      var r = t.getBoundingClientRect();
      tip.innerHTML = demoHTML(info.demo) + esc(info.t);
      tip.dataset.src = 'tip';
      tip.hidden = false;
      var x = Math.min(Math.max(8, r.left), root.innerWidth - 300), y = r.bottom + 8;
      if (y + 150 > root.innerHeight) y = Math.max(8, r.top - 160);
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    }, 280);
  }
  function onTipOut(ev) {
    var t = ev.target.closest ? ev.target.closest('[data-tip]') : null;
    if (!t) return;
    clearTimeout(tipTimer);
    var tip = $('tip');
    if (tip.dataset.src === 'tip') tip.hidden = true;
  }

  // ------------------------------------------------------------------ 说明、退出
  function showHelp(show) { $('help').hidden = !show; if (!show) store('ddz-help-seen', '1'); }

  function exitApp() {
    A.stopped = true;
    clearTimers();
    clearTimeout(tipTimer);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('mouseover', onTipOver);
    document.removeEventListener('mouseout', onTipOut);
    document.removeEventListener('click', onClick);
    if (MU) MU.destroy();
    Brain.destroy();
    A.deal = null; nets = null; dmc = null;
    root.DDZ_MODEL = null;
    try { root.close(); } catch (e) { /* 浏览器不允许关闭时显示结束页 */ }
    setTimeout(function () { $('app').hidden = true; $('app').style.display = 'none'; $('tip').hidden = true; $('help').hidden = true; $('ended').hidden = false; }, 150);
  }

  // ------------------------------------------------------------------ 事件
  /** 点一张手牌：选中 / 取消（鼠标和触屏都走这里，由 MobileUI.bindCardTaps 或下面的后备委托调用）。 */
  function onCardTap(card) {
    if (A.human !== 0 || !A.deal || A.deal.phase !== 'playing' || A.stopped) return;
    var i = +card.getAttribute('data-i'); A.sel[i] = !A.sel[i]; renderMe();
  }
  function onClick(ev) {
    var t = ev.target;
    if (t.closest('#me-hand .card')) return;   // 手牌点选在 onCardTap 里处理
    var b = t.closest('[data-bid]'); if (b && !b.disabled) { humanBid(+b.getAttribute('data-bid')); return; }
    var a = t.closest('[data-act]');
    if (a && !a.disabled) {
      var act = a.getAttribute('data-act');
      if (act === 'hint') hint();
      else if (act === 'clear') { A.sel = {}; renderMe(); }
      else if (act === 'pass') humanPlay(true);
      else if (act === 'play') humanPlay(false);
      else if (act === 'new') newDeal();
      return;
    }
    var p = t.closest('[data-preset]'); if (p) { setPreset(p.getAttribute('data-preset')); return; }
    var sp = t.closest('[data-speed]'); if (sp) { A.speed = +sp.getAttribute('data-speed'); renderPlayback(); return; }
    var ty = t.closest('[data-type]'); if (ty) { showType(+ty.getAttribute('data-type')); return; }
    var m = t.closest('.mode'); if (m) { setMode(m.getAttribute('data-mode')); return; }
  }
  function onKey(e) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) { if (e.code !== 'Escape') return; }
    if (!$('help').hidden) { if (e.code === 'Escape' || e.code === 'Enter' || e.code === 'KeyH') { e.preventDefault(); showHelp(false); } return; }
    if (e.code === 'KeyH') { showHelp(true); return; }
    if (e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyN') { stepOnce(); return; }
    if (A.human === null) return;
    if (e.code === 'Enter') { e.preventDefault(); humanPlay(false); }
    else if (e.code === 'Space') { e.preventDefault(); humanPlay(true); }
    else if (e.code === 'KeyT') hint();
    else if (e.code === 'Escape') { A.sel = {}; renderMe(); }
  }
  function togglePause() {
    A.paused = !A.paused;
    renderPlayback();
    if (A.paused) clearTimers();
    else if (A.deal && A.deal.phase === 'over' && A.mode === 'watch') newDeal();
    else schedule(150);
    renderBanner();
  }
  function stepOnce() {
    if (!A.paused) { A.paused = true; clearTimers(); renderPlayback(); }
    if (A.deal.phase === 'over') { newDeal(); clearTimers(); return; }
    advance();
    if (A.deal.phase === 'over') renderAll();
  }

  function bind() {
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mouseover', onTipOver);
    document.addEventListener('mouseout', onTipOut);
    $('help-btn').onclick = function () { showHelp(true); };
    $('help-close').onclick = $('help-ok').onclick = function () { showHelp(false); };
    $('exit-btn').onclick = exitApp;
    $('pause-btn').onclick = togglePause;
    $('step-btn').onclick = stepOnce;
    $('new-btn').onclick = function () { newDeal(); };
    $('speed').oninput = function () { A.speed = +this.value; renderPlayback(); };
    $('open-toggle').onchange = function () {
      A.open[A.mode] = this.checked;
      if (this.checked && A.mode !== 'watch') toast('明牌（作弊）已打开：对手手牌和大脑都能看了', true);
      renderAll(); Brain.render(); renderPlayback();
    };
    $('seat-kinds').onchange = function (ev) {
      var s = ev.target.getAttribute('data-seat'); if (s === null) return;
      A.kinds[+s] = ev.target.value; A.preset[A.mode] = 'custom'; renderPresets(); renderAll();
    };
    $('big-toggle').onchange = function () {
      document.body.classList.toggle('big', this.checked); store('ddz-big', this.checked ? '1' : '0');
      setTimeout(function () { Brain.render(); }, 60);
    };
    // ---- 手机：☰ 菜单、看大脑 / 选项全屏面板、主画面下方的一行按钮、横屏提示、防误触 ----
    $('menu-help').onclick = function () { showHelp(true); };
    $('menu-ctrl').onclick = function () { if (sheets) sheets.open('ctrl'); };
    $('menu-open').onclick = function () { var o = $('open-toggle'); o.checked = !o.checked; o.onchange(); };
    $('menu-new').onclick = function () { newDeal(); };
    $('menu-exit').onclick = exitApp;
    $('mob-pause').onclick = togglePause;
    $('mob-step').onclick = stepOnce;
    $('brain-toggle').onclick = function () { if (sheets) sheets.open('brain'); };
    $('ctrl-toggle').onclick = function () { if (sheets) sheets.open('ctrl'); };
    if (MU) {
      MU.detect({onChange: function () { renderAll(); setTimeout(function () { Brain.render(); }, 60); }});
      MU.menu($('menu-btn'), $('menu'));
      sheets = MU.sheets($('brain-close'), function (name) { if (name === 'brain') setTimeout(function () { Brain.render(); }, 30); });
      MU.rotateHint($('rotate-hint'), $('rot-ok'));
      MU.bindCardTaps($('me-hand'), '.card', onCardTap);
      MU.pressFeedback(document.body, '.btn, .mode, .mbtn, .preset, .btab, #menu button');
      MU.guard(document.body, {});
    } else {
      $('me-hand').addEventListener('click', function (e) { var c = e.target.closest('.card'); if (c) onCardTap(c); });
    }
  }

  function footer() {
    var c = root.DDZ_CREDITS || {};
    $('footer').textContent = '作者 ' + (c.AUTHOR || '') + (c.AUTHOR_EMAIL ? '（' + c.AUTHOR_EMAIL + '）' : '') + ' · ' + (c.UNIVERSITY_EN || '') + ' · ' + (c.UNIVERSITY_KO || '') +
      ' · 属于 ' + (c.SERIES_NAME || '') + '系列 · 代码 MIT，文档 CC BY 4.0';
  }

  function brainCtx() {
    return {
      nets: nets,
      decisions: function () { return A.deal ? A.deal.decisions : []; },
      locked: function (role) {
        var d = A.deal;
        if (!d || !d.game || A.human === null || d.phase === 'over' || A.open[A.mode]) return false;
        if (d.game.position(A.human) === role) return false;
        return '它的输入里有这一家自己的手牌，候选列表也会暴露它手里有什么牌，看了就等于偷看。打完这局自动解锁；也可以打开左边的「明牌（作弊）」。';
      },
      roleSeatName: function (role) {
        var d = A.deal;
        if (!d || !d.game) return '';
        var s = d.game.seatOf(role);
        return s === A.human ? '你' : SEAT_POS[s];
      },
      emptyText: function (role) {
        var d = A.deal;
        if (!d || d.phase === 'bidding') return '叫分阶段：叫分用简单规则（数 2、王和炸弹），不用神经网络。<br>出牌开始后，这里显示 <b>' + ROLE_ZH[role] + '</b> 的大脑。';
        return '这一家还没出过牌。';
      },
      task: task,
      onReveal: function () { A.usedHintForThis = true; },
      onMasks: function () { if (A.deal) { renderInfo(); } }
    };
  }

  function start() {
    footer();
    bind();
    Brain.init(brainCtx());
    if (store('ddz-big') === '1') { $('big-toggle').checked = true; document.body.classList.add('big'); }
    try { A.tasks = JSON.parse(store('ddz-tasks') || '{}') || {}; } catch (e) { A.tasks = {}; }
    setMode('watch');
    var q = root.location ? root.location.search : '';
    if (!store('ddz-help-seen') && q.indexOf('nohelp') < 0 && q.indexOf('selftest') < 0 && q.indexOf('demo=') < 0) showHelp(true);
  }

  // 给 selftest.js / 截图用的入口（不影响正常使用）
  root.DDZApp = {
    A: A, setMode: setMode, advance: advance, newDeal: newDeal, humanBid: humanBid, humanPlay: humanPlay, hint: hint,
    togglePause: togglePause, stepOnce: stepOnce, showType: showType, exit: exitApp, setPreset: setPreset, showHelp: showHelp,
    TYPES: TYPES, PRESETS: PRESETS, task: task, renderAll: renderAll,
    sheets: function () { return sheets; }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
