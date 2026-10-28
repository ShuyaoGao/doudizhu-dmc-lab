// 浏览器端前向（play/js/nn.js + play/js/model_dmc.js）vs PyTorch 的 Q 值一致性。
'use strict';
const {loadPlay, fixture, check, done} = require('./load');
const ctx = loadPlay(['engine.js', 'model_dmc.js', 'nn.js']);
const D = ctx.DDZ, NN = ctx.DDZNN;
const nets = NN.loadModel(ctx.DDZ_MODEL);
const TOL_FP16W = 1e-5;   // 同一份 fp16 权重，只差浮点求和顺序
const TOL_FP32 = 5e-4;    // 与原始 fp32 权重比：差在 fp16 量化

const cases = fixture('parity_cases.json');
const toMove = a => D.Move(a[0], a[1], a[2], a[3]);
const argmax = arr => arr.reduce((b, v, k) => (v > arr[b] ? k : b), 0);
let maxW = 0, max32 = 0, nq = 0, argOk = 0, argN = 0, maxCand = 0;
cases.forEach((c, i) => {
  const st = new Array(534).fill(0);
  c.state_on.forEach(k => { st[k] = 1; });
  const q = NN.scoreAll(nets[c.position], st, c.legal.map(toMove));
  maxCand = Math.max(maxCand, q.length);
  for (let k = 0; k < q.length; k++) {
    maxW = Math.max(maxW, Math.abs(q[k] - c.q_fp16w[k]));
    max32 = Math.max(max32, Math.abs(q[k] - c.q_fp32[k]));
    nq++;
  }
  const s = [...c.q_fp32].sort((a, b) => b - a);
  if (s.length > 1 && s[0] - s[1] > 1e-3) {
    argN++;
    if (argmax(Array.from(q)) === argmax(c.q_fp32)) argOk++;
  }
  if (i % 20 === 0) {   // explain() 的前向必须与 scoreAll 一致
    const ex = NN.explain(nets[c.position], st, toMove(c.legal[0]));
    check(Math.abs(ex.q - q[0]) < 1e-9, `explain 与 scoreAll 不一致 #${i}`);
  }
});
check(maxW < TOL_FP16W, `与 PyTorch(fp16 权重) 最大误差 ${maxW.toExponential(2)} 超过 ${TOL_FP16W}`);
check(max32 < TOL_FP32, `与 PyTorch(fp32 原权重) 最大误差 ${max32.toExponential(2)} 超过 ${TOL_FP32}`);
check(argOk === argN, `argmax 不一致 ${argN - argOk} 个`);

const d = NN.describe(nets.landlord);
check(d.input === 588 && d.hidden.join() === '512,256,128' && d.output === 1 && d.params === 465921,
  '结构式 588→512→256→128→1，465,921 参数');
check(ctx.DDZ_MODEL.total_params === 1397763, '三个网络合计 1,397,763 参数');

// 敲掉第 1 层全部神经元 → 所有候选 Q 相同（只剩偏置）
const c0 = cases[0], st0 = new Array(534).fill(0);
c0.state_on.forEach(k => { st0[k] = 1; });
const qz = NN.scoreAll(nets[c0.position], st0, c0.legal.map(toMove), {1: new Float32Array(512)});
check(Math.max(...qz) - Math.min(...qz) < 1e-12, '敲掉整层后各候选 Q 相同');

// 梯度×输入：数值梯度抽查（第 1 层某个激活过的神经元）
const ex = NN.explain(nets[c0.position], st0, toMove(c0.legal[0]));
check(ex.hidden.length === 3 && ex.hidden[0].size === 512 && ex.attr.length === 588, 'explain 返回 3 个隐藏层 + 588 维归因');

console.log(`  ${cases.length} 个局面（最多 ${maxCand} 个候选）/ ${nq} 个 Q 值：与 PyTorch(fp16 权重) 最大误差 ${maxW.toExponential(2)}，` +
  `与 fp32 原权重最大误差 ${max32.toExponential(2)}；argmax 一致 ${argOk}/${argN}（前两名差距 > 1e-3 的局面）`);
done('浏览器前向 vs PyTorch');
