# 第三方组件与来源说明 / Third-party notices

## 网页 play/（下载后双击即玩的部分）

| 内容 | 说明 |
|---|---|
| 第三方 JavaScript 库 | **没有**。页面只用浏览器自带的 Canvas / DOM，全部代码在 `play/js/` |
| 字体 | **不内嵌任何字体**。只按名字引用操作系统自带的字体：Windows 用 Microsoft YaHei，macOS 用 PingFang SC，其余回退到系统无衬线字体。字体文件不随本仓库分发 |
| 扑克牌面 | 由 CSS 绘制；花色 ♠♥♣♦ 是 Unicode 字符，表情符号（👑 💡 🔒 等）由操作系统的表情字体显示。没有使用任何第三方牌面图片 |
| 图片、音效 | 没有。牌桌、网络图都由代码实时绘制；页面没有声音 |
| 模型权重 `play/js/model_dmc.js` | 由本仓库的 `checkpoints/dmc_latest.pt` 转成 float16 导出（`tools/export_model.py`）。作者用本仓库的 `train.py` 自己训练，许可证同代码（MIT） |
| 网络请求 | 没有。不用 CDN，不用 fetch / XHR，不用 service worker，`file://` 下即可运行 |

## Python（只在想自己训练 / 评估 / 跑测试时需要，不随仓库分发）

| 包 | 用途 | 许可证（来自 PyPI 元数据） |
|---|---|---|
| PyTorch (`torch`) | 训练与评估 | BSD-3-Clause 风格（PyTorch 的 LICENSE）；wheel 元数据还列出了所含组件的 Apache-2.0、BSD-2-Clause、BSL-1.0、MIT 等许可证 |
| NumPy (`numpy`) | 状态编码、训练 | BSD-3-Clause（另含 0BSD、MIT、Zlib、CC0-1.0 组件） |
| pytest | 测试 | MIT |

## 测试工具（不随仓库分发）

| 工具 | 用途 |
|---|---|
| Node.js | `tests/js/*.js`：在 Node 里运行 `play/js/*.js`，与 Python 引擎和 PyTorch 逐项比对 |
| 本机已安装的 Microsoft Edge | `tools/edge.py`：用 Playwright 的 channel="msedge" 无头打开页面跑自检、截电脑尺寸的图；不下载任何浏览器 |
| Playwright（Python 包，Apache-2.0） | `tools/mobile_check.py`、`tests/test_mobile.py`：用 DevTools 协议让本机 Edge 模拟手机尺寸和触屏做验收；只驱动已装的 Edge，不下载 Playwright 自带的浏览器 |

## 文本

- `LICENSE-docs` 中的 CC BY 4.0 法律文本来自 Creative Commons（creativecommons.org），按其规定原样附上。

## 代码来源

- 全部代码由作者编写（Claude Code 辅助，经作者审阅），没有从外部项目复制代码。
- `play/js/engine.js` 是本仓库 Python 规则引擎（`doudizhu/`）的 JavaScript 移植。
- 算法思想参考（只用了思想，没有复制代码或预训练权重）：
  - D. Zha, J. Xie, W. Ma, S. Zhang, X. Lian, X. Hu, J. Liu, "DouZero: Mastering DouDizhu with Self-Play Deep Reinforcement Learning", ICML 2021（<https://arxiv.org/abs/2106.06135>）：深度蒙特卡洛、把动作编码进网络输入、三个身份三张网络。本项目的状态编码、网络结构（不含 LSTM）和训练流程都是更小的简化版，与 DouZero 的代码无关。
  - 梯度 × 输入归因：K. Simonyan, A. Vedaldi, A. Zisserman, "Deep Inside Convolutional Networks: Visualising Image Classification Models and Saliency Maps", 2013；A. Shrikumar et al., "Not Just a Black Box: Learning Important Features Through Propagating Activation Differences", 2016。

## 名称与商标

- “斗地主 / DouDizhu” 是通用的传统纸牌游戏名。本项目不使用任何商业斗地主产品的名称、标志、角色或外观。
- “DouZero” 只在引用论文时出现。
- 学校名称只以文字形式出现在署名中，没有使用学校校标（logo）图片。
