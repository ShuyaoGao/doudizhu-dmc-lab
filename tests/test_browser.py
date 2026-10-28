# -*- coding: utf-8 -*-
"""用本机 Edge / Chrome 无头打开 play/index.html?selftest=1，在 1920×1080 和 1366×768 下跑一遍关键操作：
观战单步、四种大脑视图、点候选、敲掉 / 恢复神经元、大屏模式、我来玩一整局（对手大脑锁住 → 结束后解锁）、
练习任务、说明弹窗、退出。断言没有 JS 报错。

没装 Edge / Chrome 时跳过。Firefox 未测；Safari 需要在真实 Mac 上确认。
"""
import pytest

from tools import edge

pytestmark = pytest.mark.skipif(edge.find_browser() is None, reason="没装 Edge / Chrome")


@pytest.mark.parametrize("size", ["1920,1080", "1366,768"])
def test_selftest(size):
    edge.wait_for_memory(1.5)
    r = edge.selftest(size)
    failed = [c for c in r.get("checks", []) if not c["ok"]]
    assert not r.get("errors"), r.get("errors")
    assert r.get("checks"), r
    assert not failed, failed
    assert r["ok"]
