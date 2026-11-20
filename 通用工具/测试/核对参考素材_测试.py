"""核对参考素材.py 的测试：素材只能从 资产/ 挂；成片/ 里的视频、图片都不行（11-18 起没有补片了）。
跑法：python -I -X utf8 核对参考素材_测试.py（本机用 Codex 自带的 python）"""

import hashlib
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("check_refs", HERE.parent / "核对参考素材.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def project_with(refs, text):
    root = Path(tempfile.mkdtemp())
    for rel, data in refs:
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
    (root / "提示词" / "第1-1段").mkdir(parents=True, exist_ok=True)
    (root / "提示词" / "第1-1段" / "稿.txt").write_text(text, encoding="utf-8")
    (root / "资产").mkdir(exist_ok=True)
    items = [{"ref": ref, "name": ref, "path": rel, "sha256": sha(data)}
             for (rel, data), ref in zip(refs, [r for r in REFS[: len(refs)]])]
    (root / "资产" / "参考素材映射.json").write_text(json.dumps({"schema_version": 1, "prompts": {
        "提示词/第1-1段/稿.txt": {"prompt_sha256": mod.prompt_hash(text), "references": items}}}, ensure_ascii=False), encoding="utf-8")
    return root


REFS = []
fails = 0


def case(name, refs, text, ok):
    global REFS, fails
    REFS = [r for _, r in refs]
    root = project_with([x for x, _ in refs], text)
    try:
        mod.check_manifest(root, "提示词/第1-1段/稿.txt")
        got = True
    except mod.CheckError:
        got = False
    print(("通过 " if got == ok else "失败 ") + name)
    fails += got != ok


case("图片从 资产/ 挂", [(("资产/人物和道具/面车.png", b"img"), "@图片1")], "面车对应@图片1。", True)
case("视频不能从 成片/ 挂", [(("成片/第1-1段/1-5.mp4", b"vid"), "@视频1")], "编辑@视频1。", False)
case("图片不能从 成片/ 挂", [(("成片/第1-1段/截图.png", b"img"), "@图片1")], "参考@图片1。", False)
case("视频不能从别的文件夹挂", [(("历史记录/第1-1段/旧.mp4", b"vid"), "@视频1")], "编辑@视频1。", False)
case("视频照旧能从 资产/ 挂", [(("资产/关键帧/第1-1段/白模.mp4", b"vid"), "@视频1")], "参考@视频1。", True)
sys.exit(1 if fails else 0)
