# -*- coding: utf-8 -*-
"""把 tests/js 下的 Node 测试接进 pytest：JS 规则引擎差分测试、浏览器前向 vs PyTorch。

夹具（tests/fixtures/*.json）由 python -m tools.export_fixtures 生成并随仓库提交；
改了规则引擎或模型后先重新生成夹具再跑。
"""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NODE = shutil.which("node")


@pytest.mark.parametrize("script", ["test_engine.js", "test_parity.js"])
def test_node(script):
    if not NODE:
        pytest.skip("没装 Node.js")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    r = subprocess.run([NODE, str(ROOT / "tests" / "js" / script)], cwd=ROOT,
                       capture_output=True, env=env, timeout=300)
    out = r.stdout.decode("utf-8", "replace") + r.stderr.decode("utf-8", "replace")
    print(out)
    assert r.returncode == 0, out
