#!/usr/bin/env python3
"""校验视频提示词、源素材及可选的生成节点回读。

映射位于项目的 资产/参考素材映射.json。正文统一为 LF 后计算 SHA-256，
素材按原始文件字节计算。不会修改任何文件，也不会提交生成。

--actual 接受本地回读格式：
{"prompt": "节点实际正文", "references": [
  {"ref": "@图片1", "source_sha256": "本轮核实的节点源文件哈希"}
]}
actual 必须来自本轮真实节点回读。source_sha256 必须通过本轮节点或资源
的来源核对追溯到已核实的本地源文件，不能复制期望清单充当回读。
该格式是本地核对约定，并非生成平台的接口格式。
"""

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path, PurePosixPath, PureWindowsPath


REFERENCE = re.compile(r"@(图片|视频|音频)([1-9][0-9]*)\Z")
MENTION = re.compile(r"@(图片|视频|音频)[ \t]*([0-9]+)")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
EXTENSIONS = {
    "图片": {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"},
    "视频": {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"},
    "音频": {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac", ".opus"},
}


class CheckError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise CheckError(message)


def read_json(path):
    with path.open(encoding="utf-8-sig") as source:
        return json.load(source, object_pairs_hook=unique_keys)


def unique_keys(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, f"JSON 存在重复键 {key}")
        result[key] = value
    return result


def normalize_prompt(text):
    return text.removeprefix("\ufeff").replace("\r\n", "\n").replace("\r", "\n")


def prompt_hash(text):
    return hashlib.sha256(normalize_prompt(text).encode("utf-8")).hexdigest()


def file_hash(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def checked_path(project, relative, first_folder):
    require(isinstance(relative, str) and relative, "文件路径必须是非空字符串")
    normalized = relative.replace("\\", "/")
    parts = PurePosixPath(normalized).parts
    require(not PureWindowsPath(relative).drive and not normalized.startswith("/"),
            f"必须使用项目相对路径 {relative}")
    require(parts and parts[0] == first_folder and ".." not in parts,
            f"路径必须位于 {first_folder}/ 内 {relative}")
    path = project.joinpath(*parts).resolve()
    require(path.is_relative_to((project / first_folder).resolve()),
            f"解析后的路径越出 {first_folder}/ {relative}")
    require(path.is_file(), f"找不到文件 {relative}")
    return path, PurePosixPath(*parts).as_posix()


def check_manifest(project, prompt_relative):
    prompt_path, key = checked_path(project, prompt_relative, "提示词")
    manifest_path = project / "资产" / "参考素材映射.json"
    require(manifest_path.is_file(), "缺少 资产/参考素材映射.json")
    manifest = read_json(manifest_path)
    require(isinstance(manifest, dict) and type(manifest.get("schema_version")) is int
            and manifest["schema_version"] == 1,
            "参考素材映射的 schema_version 必须为 1")
    prompts = manifest.get("prompts")
    require(isinstance(prompts, dict) and key in prompts, f"未登记该稿 {key}")
    entry = prompts[key]
    require(isinstance(entry, dict), f"该稿登记格式错误 {key}")
    text = prompt_path.read_text(encoding="utf-8-sig")
    require(entry.get("prompt_sha256") == prompt_hash(text),
            "提示词正文已变化，需核实素材对应关系并更新登记")
    references = entry.get("references")
    require(isinstance(references, list) and references, "references 必须是非空有序列表")
    found = {}
    numbers = {kind: [] for kind in EXTENSIONS}
    for item in references:
        require(isinstance(item, dict), "每项参考素材必须是对象")
        ref = item.get("ref")
        match = REFERENCE.fullmatch(ref) if isinstance(ref, str) else None
        require(match is not None, f"无效参考编号 {ref}")
        require(ref not in found, f"重复参考编号 {ref}")
        require(isinstance(item.get("name"), str) and item["name"].strip(), f"{ref} 缺少名称")
        kind, number = match.groups()
        numbers[kind].append(int(number))
        # 审片补片（11-15）：剪下的原片放在样片旁的「视频名_补片」文件夹，只有视频能从 成片/ 挂
        root = "成片" if kind == "视频" and str(item.get("path", "")).replace("\\", "/").startswith("成片/") else "资产"
        source, _ = checked_path(project, item.get("path"), root)
        require(source.suffix.lower() in EXTENSIONS[kind], f"{ref} 文件扩展名与媒体类型不符")
        expected_hash = item.get("sha256")
        require(isinstance(expected_hash, str) and SHA256.fullmatch(expected_hash),
                f"{ref} 缺少有效 SHA-256")
        require(file_hash(source) == expected_hash, f"{ref} 源素材已变化 {item['path']}")
        found[ref] = item
    for kind, values in numbers.items():
        require(sorted(values) == list(range(1, len(values) + 1)), f"{kind}编号必须从 1 连续递增")
        require(values == sorted(values), f"{kind}在清单中的顺序必须与编号一致")
    used = {f"@{kind}{number}" for kind, number in MENTION.findall(text)}
    require(used == set(found),
            f"正文与清单编号不一致，未登记 {sorted(used - set(found))}，正文未使用 {sorted(set(found) - used)}")
    return text, references


def check_actual(path, text, references):
    actual = read_json(path)
    require(isinstance(actual, dict) and isinstance(actual.get("prompt"), str),
            "actual 必须包含节点实际 prompt 字符串")
    require(normalize_prompt(actual["prompt"]) == normalize_prompt(text),
            "节点实际正文与审核稿不一致")
    actual_refs = actual.get("references")
    require(isinstance(actual_refs, list) and len(actual_refs) == len(references),
            "节点实际参考素材数量与审核清单不一致")
    for position, (actual_ref, expected) in enumerate(zip(actual_refs, references), 1):
        require(isinstance(actual_ref, dict), f"节点第 {position} 项参考格式错误")
        require(actual_ref.get("ref") == expected["ref"],
                f"节点第 {position} 项编号或媒体类型不一致，应为 {expected['ref']}")
        require(actual_ref.get("source_sha256") == expected["sha256"],
                f"节点 {expected['ref']} 的来源与审核素材不一致或尚未核实")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, type=Path, help="项目绝对路径")
    parser.add_argument("--prompt", required=True, help="项目内提示词相对路径")
    parser.add_argument("--actual", type=Path, help="可选的生成节点实际正文及有序引用回读 JSON")
    args = parser.parse_args()
    try:
        require(args.project.is_absolute(), "--project 必须是绝对路径")
        project = args.project.resolve()
        require(project.is_dir(), "项目目录不存在")
        text, references = check_manifest(project, args.prompt)
        if args.actual is not None:
            check_actual(args.actual, text, references)
        print("通过：提示词、素材编号和源文件一致" + ("，节点回读一致" if args.actual else ""))
        for item in references:
            print(f"{item['ref']}\t{item['name']}\t{item['path']}\t{item['sha256']}")
        return 0
    except (CheckError, OSError, ValueError, TypeError) as error:
        print(f"未通过：{error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
