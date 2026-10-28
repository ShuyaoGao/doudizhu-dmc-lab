/* 自检与截图入口（只在地址带 ?selftest=1 或 ?demo=... 时生效，正常打开页面时什么都不做）。
 * tests/test_browser.py 用本机 Edge 无头打开 index.html?selftest=1，读回 <pre id="selftest-result">。
 */
(function (root) {
  'use strict';
  var q = (root.location && root.location.search) || '';
  if (q.indexOf('selftest=1') < 0 && q.indexOf('demo=') < 0) return;
  var errors = [];
  root.addEventListener('error', function (e) { errors.push(String(e.message) + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno); });
  root.addEventListener('unhandledrejection', function (e) { errors.push('unhandledrejection ' + e.reason); });
  var origErr = console.error;
  console.error = function () { errors.push('console.error ' + Array.prototype.join.call(arguments, ' ')); origErr.apply(console, arguments); };

  function param(name, dflt) {
    var m = new RegExp('[?&]' + name + '=([^&]*)').exec(q);
    return m ? decodeURIComponent(m[1]) : dflt;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function $(id) { return document.getElementById(id); }

  /** 我来玩：自动叫分 / 用提示出牌，直到本局结束或走满 maxSteps 步。返回在“人类回合”时看到的锁定情况。 */
  function autoPlay(App, maxSteps, stopAtHuman) {
    var A = App.A, seenLock = null;
    for (var i = 0; i < maxSteps; i++) {
      var d = A.deal;
      if (d.phase === 'over') break;
      if (d.phase === 'bidding' && d.bidOrder[d.bidIdx] === A.human) { App.humanBid(d.currentBid < 2 ? 2 : 0); continue; }
      if (d.phase === 'playing' && d.game.turn === A.human) {
        if (stopAtHuman && i >= stopAtHuman) { App.advance(); return seenLock; }
        if (seenLock === null) {
          var opp = ['landlord', 'down', 'up'].filter(function (r) { return r !== d.game.position(A.human); })[0];
          root.Brain.setView(opp);
          seenLock = !!document.querySelector('#brain-body .lock');
        }
        App.hint();
        var sel = Object.keys(A.sel).filter(function (k) { return A.sel[k]; });
        App.humanPlay(sel.length === 0);
        continue;
      }
      App.stepOnce();
    }
    return seenLock;
  }

  async function selftest() {
    var App = root.DDZApp, A = App.A, checks = [];
    function check(name, ok, info) { checks.push({name: name, ok: !!ok, info: info === undefined ? '' : String(info)}); }
    App.showHelp(false);
    check('页面加载，默认进入观战', A.mode === 'watch' && A.human === null);
    check('结构式从模型读出', /输入 588/.test($('brain-struct').textContent) && /465,921/.test($('brain-struct').textContent), $('brain-struct').textContent);

    // 观战：暂停后单步 80 次
    App.togglePause();
    for (var i = 0; i < 80; i++) App.stepOnce();
    await sleep(30);
    check('观战单步 80 次后已有决策', A.deal.decisions.length > 0 || A.dealNo > 1, A.deal.decisions.length);
    var views = ['all', 'landlord', 'down', 'up'];
    for (i = 0; i < views.length; i++) {
      root.Brain.setView(views[i]);
      await sleep(10);
      check('大脑视图 ' + views[i] + ' 有内容', $('brain-body').innerHTML.length > 50);
    }
    root.Brain.setView('all');
    check('全部模式画出 3 个紧凑大脑', document.querySelectorAll('.mini-brain').length === 4);
    // 找一个有决策的身份，点候选、敲神经元
    var role = A.deal.decisions.length ? A.deal.decisions[A.deal.decisions.length - 1].role : 'landlord';
    root.Brain.setView(role);
    await sleep(10);
    var rows = document.querySelectorAll('.orow');
    if (rows.length > 1) { rows[1].click(); await sleep(10); }
    check('点击候选后高亮', rows.length === 0 || document.querySelector('.orow.selc'), rows.length);
    check('网络图 canvas 存在', !!$('net-canvas'));
    for (i = 0; i < 5; i++) root.Brain.toggleNeuron(role, 1, i);
    check('敲掉 5 个神经元后恢复按钮可用', !$('restore-btn').disabled && /5/.test($('restore-btn').textContent));
    root.Brain.restoreAll();
    check('一键恢复', $('restore-btn').disabled);
    // 悬停提示（带动画演示）
    $('restore-btn').dispatchEvent(new MouseEvent('mouseover', {bubbles: true}));
    await sleep(400);
    check('悬停提示出现并带动画演示', !$('tip').hidden && !!$('tip').querySelector('.demo-knock'), $('tip').textContent.slice(0, 20));
    $('restore-btn').dispatchEvent(new MouseEvent('mouseout', {bubbles: true}));
    await sleep(20);
    check('移开后提示消失', $('tip').hidden);
    // 大屏模式
    $('big-toggle').click(); await sleep(80);
    var wBig = $('right').getBoundingClientRect().width;
    $('big-toggle').click(); await sleep(80);
    var wNorm = $('right').getBoundingClientRect().width;
    check('大屏模式加宽右栏', wBig > wNorm + 40, Math.round(wNorm) + ' → ' + Math.round(wBig));
    check('没有横向滚动条', document.documentElement.scrollWidth <= root.innerWidth + 1, document.documentElement.scrollWidth + ' / ' + root.innerWidth);
    // 牌型图鉴的例子都是合法牌型
    var bad = App.TYPES.filter(function (t) { return !root.DDZ.classify(t[1]).some(function (m) { return m.type === t[0]; }); });
    check('牌型图鉴 14 个例子都能被规则引擎识别', bad.length === 0, bad.map(function (t) { return t[0]; }).join(','));

    // 我来玩：对手大脑本局结束前锁住，结束后解锁
    App.setMode('play');
    App.togglePause();
    var locked = autoPlay(App, 600);
    check('我来玩：轮到人类时对手大脑是锁住的', locked === true, locked);
    check('我来玩：一局能打完', A.deal.phase === 'over', A.deal.phase);
    var opp = ['landlord', 'down', 'up'].filter(function (r) { return r !== A.deal.game.position(0); })[0];
    root.Brain.setView(opp); await sleep(10);
    check('我来玩：本局结束后对手大脑解锁', !document.querySelector('#brain-body .lock'));
    check('结算横幅显示', !$('result-banner').hidden);

    // 练习：牌型图鉴任务
    App.setMode('practice');
    App.togglePause();
    App.showType(0); App.showType(5); App.showType(13);
    check('练习：看 3 种牌型后任务打勾', !!A.tasks.types && document.querySelector('#tasks li.done'));
    check('练习面板可见', !$('practice-panel').hidden);
    App.showHelp(true);
    check('说明弹窗可打开', !$('help').hidden);
    App.showHelp(false);

    // 退出
    App.exit();
    await sleep(400);
    check('退出后显示结束页', !$('ended').hidden);
    finish(checks);
  }

  function finish(checks) {
    var ok = errors.length === 0 && checks.every(function (c) { return c.ok; });
    var pre = document.createElement('pre');
    pre.id = 'selftest-result';
    pre.textContent = JSON.stringify({ok: ok, size: [root.innerWidth, root.innerHeight], checks: checks, errors: errors});
    document.body.appendChild(pre);
    document.title = 'SELFTEST:' + (ok ? 'PASS' : 'FAIL');
  }

  async function demo() {
    var App = root.DDZApp, A = App.A, mode = param('demo', 'watch'), steps = +param('steps', '40');
    if (param('big', '0') === '1') { $('big-toggle').checked = true; document.body.classList.add('big'); }
    if (mode === 'help') { App.showHelp(true); return; }
    App.showHelp(false);
    if (mode === 'watch') {
      App.togglePause();
      for (var i = 0; i < steps; i++) App.stepOnce();
    } else {
      App.setMode(mode);
      App.togglePause();
      if (param('cheat', '0') === '1') { $('open-toggle').checked = true; $('open-toggle').onchange(); }
      autoPlay(App, 600, steps);
      if (mode === 'practice') { App.showType(5); App.showType(8); }
    }
    await sleep(30);
    var v = param('view', '');
    if (v) root.Brain.setView(v);
    var c = param('cand', '');
    if (c) { var rows = document.querySelectorAll('.orow'); if (rows[+c]) rows[+c].click(); }
    var k = +param('knock', '0');
    if (k && A.deal.decisions.length) {
      var role = root.Brain.state().view;
      for (var j = 0; j < k; j++) root.Brain.toggleNeuron(role === 'all' ? 'landlord' : role, 1, j * 7);
    }
    document.title = 'DEMO:READY';
  }

  function go() { setTimeout(q.indexOf('selftest=1') >= 0 ? selftest : demo, 60); }
  if (document.readyState === 'complete') go(); else root.addEventListener('load', go);
})(window);
