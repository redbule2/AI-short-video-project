#!/usr/bin/env python3
"""台词/旁白耗时计量（纯标准库）。

五种用法：

1) 直接传文本，逐条输出发音单位与耗时区间：
     python3 count_chars.py "台词1" "台词2" ...
     python3 count_chars.py --mode slow "诗句1"        # 吟诵慢速口径

2) 片段模式：加 --duration，判断这几句台词放进一个 N 秒的片段是否超载：
     python3 count_chars.py --duration 10 "女主：台词1" "男主：台词2"
     python3 count_chars.py --duration 12 --max-duration 15 --min-duration 4 "台词1" "台词2" --json
   写成「角色：台词」时按说话人变化计换人停顿。
     ERROR  台词耗时下限（含换人停顿）> 片段时长；片段时长不是整数秒；超出 --max/--min-duration；台词为空
     WARN   台词耗时上限贴近片段时长（慢语速收不住口型）；对白句数偏多
            （<=8s 建议最多 2 句，<=15s 建议最多 4 句）；不说话的时间偏长（可能空转）
   判定结果都在输出里，退出码为 0；只有用法错误（文件不存在、参数不对）才非 0。

3) 传分镜 shots/E01.md（有「## S01」小节）：逐段抽出引号里的台词，按分段表的时长（或正文时间锚点）判断是否超载：
     python3 count_chars.py shots/E01.md --max-duration 15
   说话人取引号前最近的 {{别名}} 或「旁白」，用来计换人停顿。

4) 传剧本 .md（统一剧本格式，可一次传多集），统计台词字数、全文字数并判断是否在档：
     python3 count_chars.py story/E01.md
     python3 count_chars.py story/E0*.md --seconds 60-90   # 不传则读项目 README.md 里「单集时长：60-90 秒」这一行
   台词 = 角色台词 + os + vo（不含 △、场头、出场、【…】）；全文 = 去掉空白和 # 后的全部字符。
   档位：台词 = 秒数 × 3-4，全文 = 秒数 × 8-11（与 references/script/episode-writing.md 一致）。
   判定结果在输出里，退出码为 0；用法错误才非 0。

5) 改了某段时长后重排时码：把这一段各分镜的「分镜N：X秒」按原比例改写到新总时长（整数秒，每个分镜至少 1 秒），并改分段表里这一段的时长：
     python3 count_chars.py --retime shots/E01.md#S02 --duration 12           # 只打印 diff
     python3 count_chars.py --retime shots/E01.md#S02 --duration 12 --write   # 写回
   正文里别的秒数（「3 秒内缓推」）不动，输出里逐行提醒。

传入其他类型的文件（.json、.txt、.docx 等）或不存在的文件路径会直接报错，不会当成台词计时。

计量口径：
  - CJK 等 Lo 字符逐字计；数字逐位计；连续拉丁字母按一个英文词计。
  - 省略号（…… / ...）与破折号（—— / --）每处计一次语气停顿。
  - 片段内相邻两句说话人不同，计一次换人停顿。
  - 所有语速与停顿常量都是经验值，未在目标视频模型上实测；实测校准后改下方常量。
"""

import argparse
import difflib
import json
import math
import os
import re
import sys
import unicodedata
from typing import NamedTuple

# ---- 经验值，未实测（来源：既有短视频分镜规则的约定值） ----
CHAR_FAST_RATE = 3.5        # 中文 字/秒，快口径 → 耗时下限
CHAR_SLOW_RATE = 2.8        # 中文 字/秒，慢口径 → 耗时上限
ENGLISH_FAST_RATE = 2.5     # 英文 词/秒
ENGLISH_SLOW_RATE = 2.2
RECITAL_CHAR_RATE = 2.0     # 吟诵口径
RECITAL_ENGLISH_RATE = 1.5
PAUSE_SECONDS = (0.3, 0.6)  # 每处省略号/破折号的语气停顿（下限, 上限）
TURN_GAP_SECONDS = (0.3, 0.6)  # 每次换人说话的间隔（下限, 上限）
CLOSE_SECONDS = 0.5         # 片段收束时间（片段时长公式中的 +0.5s）
SCRIPT_LINE_RATE = (3, 4)   # 剧本档位：台词字数 / 单集秒数
SCRIPT_FULL_RATE = (8, 11)  # 剧本档位：全文字数 / 单集秒数
SCRIPT_MAX_LINE = 20        # 单句台词字数上限
# ------------------------------------------------------------

PAUSE_RE = re.compile(r"(…+|\.{3,}|—+|-{2,})")


class SpeechUnits(NamedTuple):
    chars: int
    digits: int
    english_words: int
    pauses: int


def count_speech_units(text):
    """统计逐字发音单位、数字、英文词和语气停顿。"""
    if not text:
        return SpeechUnits(0, 0, 0, 0)

    chars = 0
    digits = 0
    english_words = 0
    in_word = False

    for ch in text:
        cat = unicodedata.category(ch)
        if cat == "Lo":
            if in_word:
                english_words += 1
                in_word = False
            chars += 1
        elif cat == "Nd":
            if in_word:
                english_words += 1
                in_word = False
            digits += 1
        elif cat.startswith("L"):
            in_word = True
        elif cat.startswith("M") and in_word:
            continue
        elif ch in ("'", "’") and in_word:
            continue
        else:
            if in_word:
                english_words += 1
                in_word = False
    if in_word:
        english_words += 1
    pauses = len(PAUSE_RE.findall(text))
    return SpeechUnits(chars, digits, english_words, pauses)


def estimate_speech(text, mode="normal"):
    """返回 (SpeechUnits, 耗时下限秒, 耗时上限秒)。"""
    if mode not in ("normal", "slow"):
        raise ValueError("mode 取值只能是 normal 或 slow")
    units = count_speech_units(text)
    char_units = units.chars + units.digits
    if mode == "slow":
        seconds = (char_units / RECITAL_CHAR_RATE
                   + units.english_words / RECITAL_ENGLISH_RATE
                   + units.pauses * PAUSE_SECONDS[1])
        rounded = round(seconds, 1)
        return units, rounded, rounded
    lower = (char_units / CHAR_FAST_RATE
             + units.english_words / ENGLISH_FAST_RATE
             + units.pauses * PAUSE_SECONDS[0])
    upper = (char_units / CHAR_SLOW_RATE
             + units.english_words / ENGLISH_SLOW_RATE
             + units.pauses * PAUSE_SECONDS[1])
    return units, round(lower, 1), round(upper, 1)


def format_units(units):
    parts = []
    if units.chars:
        parts.append(f"{units.chars}字")
    if units.digits:
        parts.append(f"{units.digits}数字")
    if units.english_words:
        parts.append(f"{units.english_words}英文词")
    label = "+".join(parts) if parts else "0字"
    if units.pauses:
        label += f"（{units.pauses}处停顿）"
    return label


def short(text, n=20):
    return text if len(text) <= n else text[:n] + "…"


# ---------------- 文本模式 ----------------

def run_texts(texts, mode):
    slow = mode == "slow"
    sum_lo = sum_hi = 0.0
    total = SpeechUnits(0, 0, 0, 0)
    for text in texts:
        units, lo, hi = estimate_speech(text, mode)
        total = SpeechUnits(*(a + b for a, b in zip(total, units)))
        sum_lo += lo
        sum_hi += hi
        if slow:
            print(f"「{short(text)}」{format_units(units)}，吟诵耗时[{lo}s]")
        else:
            print(f"「{short(text)}」{format_units(units)}，耗时[{lo}s~{hi}s]")
    if len(texts) > 1:
        if slow:
            print(f"【合计】{len(texts)}段共{format_units(total)}，吟诵耗时累加[{round(sum_lo, 1)}s]")
        else:
            print(f"【合计】{len(texts)}段共{format_units(total)}，"
                  f"耗时累加[{round(sum_lo, 1)}s~{round(sum_hi, 1)}s]（未含换人停顿）")
    print("注：语速与停顿常量为经验值，未实测。")
    return 0


# ---------------- 片段模式（--duration） ----------------

def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


SPEAKER_RE = re.compile(r"^\s*(?P<who>[^\s：:「“\"]{1,12})\s*[：:]\s*(?P<line>.+)$")


def split_speaker(text):
    """「角色：台词」→ (角色, 台词)；没写说话人时返回 (None, 原文)。"""
    m = SPEAKER_RE.match(text)
    return (m.group("who"), m.group("line").strip()) if m else (None, text)


def check_segment(texts, duration, mode, max_d, min_d):
    """把这几句台词放进一个 duration 秒的片段，判断装不装得下。返回 (lines, summary, issues)。"""
    issues = []

    def add(level, msg):
        issues.append((level, msg))

    if duration <= 0:
        add("ERROR", "--duration 要是正数")
    elif duration != int(duration):
        add("ERROR", f"片段时长 {duration:g}s 不是整数秒（视频生成只接受整数秒）")
    if max_d is not None and duration > max_d:
        add("ERROR", f"片段时长 {duration:g}s 超过模型上限 {max_d:g}s：在叙事节拍边界拆分")
    if min_d is not None and duration < min_d:
        add("ERROR", f"片段时长 {duration:g}s 低于模型下限 {min_d:g}s：和相邻同场片段合并，或补上真实的动作")

    lines = []
    for text in texts:
        who, line = split_speaker(text)
        if not line.strip():
            add("ERROR", f"有空台词：{text}")
            continue
        units, lo, hi = estimate_speech(line, mode)
        lines.append({"who": who, "line": line, "units": format_units(units), "lo": lo, "hi": hi})
    turns = sum(1 for x, y in zip(lines, lines[1:]) if x["who"] and y["who"] and x["who"] != y["who"])
    total_lo = round(sum(x["lo"] for x in lines) + turns * TURN_GAP_SECONDS[0], 1)
    total_hi = round(sum(x["hi"] for x in lines) + turns * TURN_GAP_SECONDS[1], 1)
    n = len(lines)
    need = math.ceil(total_lo + CLOSE_SECONDS - 1e-9) if n else None
    action = round(duration - total_lo - CLOSE_SECONDS, 1) if n else None
    if n and duration > 0:
        if total_lo > duration:
            add("ERROR", f"装不下：台词耗时下限 {total_lo}s > 片段时长 {duration:g}s。加时长或调整分段，台词不删改（要删先问用户）")
        elif total_hi > duration - CLOSE_SECONDS:
            add("WARN", f"偏紧：台词耗时上限 {total_hi}s 已占满片段（留不出 {CLOSE_SECONDS}s 收束），"
                        "语速慢时会截断或抢拍，建议加 1s")
        if duration <= 8 and n > 2:
            add("WARN", f"对白偏多：{duration:g}s 片段 {n} 句（8s 以内建议最多 2 句），加时长或拆分段")
        elif 8 < duration <= 15 and n > 4:
            add("WARN", f"对白偏多：{duration:g}s 片段 {n} 句（15s 以内建议最多 4 句），拆分段")
        if action is not None and action >= max(4.0, duration * 0.5):
            add("WARN", f"不说话的时间约 {action}s：确认这段里真有这么多独立动作，没有就缩短时长"
                        "（时长远大于内容时模型会呆站、重复台词）")
    summary = {"duration": duration, "lineCount": n, "turns": turns,
               "speech": {"lo": total_lo, "hi": total_hi}, "minDurationForSpeech": need,
               "silentSeconds": action}
    return lines, summary, issues


def run_segment(texts, duration, mode, max_d, min_d, as_json):
    lines, summary, issues = check_segment(texts, duration, mode, max_d, min_d)
    n_err = sum(1 for lv, _ in issues if lv == "ERROR")
    if as_json:
        print(json.dumps({**summary, "lines": lines, "issues": [{"level": lv, "msg": m} for lv, m in issues],
                          "note": "语速与停顿常量为经验值，未实测"}, ensure_ascii=False, indent=2))
        return 0
    for x in lines:
        who = f"{x['who']}：" if x["who"] else ""
        print(f"{who}「{short(x['line'], 24)}」{x['units']}，耗时[{x['lo']}s~{x['hi']}s]")
    if lines:
        print(f"【片段 {duration:g}s】台词 {summary['lineCount']} 句（换人 {summary['turns']} 次），"
              f"合计 {summary['speech']['lo']}~{summary['speech']['hi']}s（含换人停顿）；"
              f"只算台词最短需要 {summary['minDurationForSpeech']}s" + (f"；不说话的时间约 {summary['silentSeconds']}s" if summary["silentSeconds"] is not None and summary["silentSeconds"] >= 0 else ""))
    for lv, m in issues:
        print(f"  {lv}  {m}")
    if not issues:
        print("  OK  装得下")
    print("注：语速与停顿常量为经验值，未实测。")
    return 0


# ---------------- 分镜模式（shots/E01.md） ----------------

SEG_HEAD_RE = re.compile(r"^##\s*(S\d+[A-Za-z]?)\b.*$", re.M)
TABLE_DUR_RE = re.compile(r"^\|\s*(S\d+[A-Za-z]?)\s*\|\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\|", re.M)
ANCHOR_RE = re.compile(r"(\d+(?:\.\d+)?)\s*[-–~～到至]\s*(\d+(?:\.\d+)?)\s*秒")
SHOT_RE = re.compile(r"^(\s*分镜\s*(\d+)\s*[：:]\s*)(\d+)(\s*秒)", re.M)
QUOTE_RE = re.compile(r"[“\"]([^”\"\n]+)[”\"]")
ALIAS_NAME_RE = re.compile(r"\{\{([^{}]+)\}\}")
NARR_RE = re.compile(r"旁白")
VOICE_RE = re.compile(r"(?:画外传来|传出|响起)([^，。：:\s{}（(]{1,8}?)(?:本人)?(?:的)?(?:声音|内心独白|旁白)")


def is_shots_md(text):
    return bool(SEG_HEAD_RE.search(text))


def parse_shots(text):
    """返回 [(段号, 时长或 None, [「角色：台词」…])]。时长取分段表，没有就取正文各「分镜N：X秒」之和。"""
    table = {m.group(1): float(m.group(2)) for m in TABLE_DUR_RE.finditer(text)}
    heads = list(SEG_HEAD_RE.finditer(text))
    out = []
    for i, h in enumerate(heads):
        sid = h.group(1)
        body = text[h.end(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        dur = table.get(sid)
        if dur is None:
            secs = [float(m.group(3)) for m in SHOT_RE.finditer(body)]
            ends = [float(m.group(2)) for m in ANCHOR_RE.finditer(body)]
            dur = sum(secs) if secs else (max(ends) if ends else None)
        lines = []
        for line in body.splitlines():
            for m in QUOTE_RE.finditer(line):
                before = line[: m.start()]
                if before.rfind("<") > before.rfind(">"):
                    continue  # <音效> 里的拟声词不是台词
                # 取离引号最近的说话人标记：{{别名}}、「画外传来某某的声音」或「旁白」
                marks = [(n.end(), n.group(1)) for n in ALIAS_NAME_RE.finditer(before)]
                marks += [(n.end(), n.group(1)) for n in VOICE_RE.finditer(before)]
                marks += [(n.end(), "旁白") for n in NARR_RE.finditer(before)]
                who = max(marks)[1].strip() if marks else None
                lines.append(f"{who}：{m.group(1)}" if who else m.group(1))
        out.append((sid, dur, lines))
    return out


def run_shots(path, mode, max_d, min_d, as_json):
    text = open(path, encoding="utf-8").read()
    segs = parse_shots(text)
    results = []
    for sid, dur, lines in segs:
        if dur is None:
            results.append({"id": sid, "error": "找不到时长：分段表里写「| S01 | 10s |」，或正文写「分镜1：3秒：」"})
            continue
        if not lines:
            results.append({"id": sid, "duration": dur, "lineCount": 0, "issues": [], "lines": []})
            continue
        ls, summary, issues = check_segment(lines, dur, mode, max_d, min_d)
        results.append({"id": sid, **summary, "lines": ls, "issues": [{"level": lv, "msg": m} for lv, m in issues]})
    if as_json:
        print(json.dumps({"file": path, "segments": results, "note": "语速与停顿常量为经验值，未实测；台词按引号抽取，说话人取引号前最近的 {{别名}} 或「旁白」"},
                         ensure_ascii=False, indent=2))
        return 0
    total = sum(r.get("duration") or 0 for r in results)
    print(f"# {path}：{len(results)} 段，合计 {total:g}s")
    for r in results:
        if r.get("error"):
            print(f"\n## {r['id']}  {r['error']}")
            continue
        head = f"\n## {r['id']}  {r['duration']:g}s  台词 {r['lineCount']} 句"
        if r["lineCount"]:
            sp = r["speech"]
            head += f"，合计 {sp['lo']}~{sp['hi']}s，只算台词最短需要 {r['minDurationForSpeech']}s"
        print(head)
        for x in r["lines"]:
            who = f"{x['who']}：" if x["who"] else ""
            print(f"  {who}「{short(x['line'], 24)}」{x['lo']}~{x['hi']}s")
        for i in r["issues"]:
            print(f"  {i['level']}  {i['msg']}")
        if r["lineCount"] and not r["issues"]:
            print("  OK  装得下")
    print("注：台词按引号抽取，说话人取引号前最近的 {{别名}} 或「旁白」；语速与停顿常量为经验值，未实测。")
    return 0


# ---------------- 重排时码（--retime shots/E01.md#S02 --duration 12） ----------------

STAGE_RE = re.compile(r"^(\s*)(\d+(?:\.\d+)?)\s*([-–~～到至])\s*(\d+(?:\.\d+)?)\s*秒", re.M)
OTHER_SEC_RE = re.compile(r"\d+(?:\.\d+)?\s*秒")


def _fmt(x):
    return f"{x:g}" if abs(x - round(x)) > 1e-9 else str(int(round(x)))


def _scaled_bounds(bounds, new_total):
    """按比例把各拍边界映射到新总时长：整数优先，挤在一起就退到 0.5 秒；还不行返回 None。"""
    f = new_total / bounds[-1]
    for step in (1.0, 0.5):
        vals = [round(b * f / step) * step for b in bounds]
        vals[0], vals[-1] = bounds[0] * f, new_total
        if all(b > a for a, b in zip(vals, vals[1:])):
            return vals
    return None


def run_retime(target, new_total, write):
    path, _, sid = target.partition("#")
    if not sid:
        print("错误：--retime 写成 shots/E01.md#S02", file=sys.stderr)
        return 2
    if new_total is None or new_total <= 0:
        print("错误：--retime 要配 --duration <新时长秒数>", file=sys.stderr)
        return 2
    try:
        text = open(path, encoding="utf-8").read()
    except (OSError, UnicodeDecodeError) as e:
        print(f"错误：{path}：{e}", file=sys.stderr)
        return 2
    heads = list(SEG_HEAD_RE.finditer(text))
    idx = next((i for i, h in enumerate(heads) if h.group(1) == sid), None)
    if idx is None:
        print(f"错误：{path} 里没有 ## {sid}", file=sys.stderr)
        return 2
    start = heads[idx].end()
    end = heads[idx + 1].start() if idx + 1 < len(heads) else len(text)
    body = text[start:end]
    shots = list(SHOT_RE.finditer(body))
    if shots:
        return _retime_shots(path, text, start, end, sid, shots, new_total, write)
    stages = list(STAGE_RE.finditer(body))
    if not stages:
        print(f"错误：## {sid} 里没有行首的「0-3秒」时间锚点", file=sys.stderr)
        return 2
    bounds = sorted({float(m.group(2)) for m in stages} | {float(m.group(4)) for m in stages})
    mapped = _scaled_bounds(bounds, new_total)
    if mapped is None:
        print(f"错误：{len(stages)} 拍压进 {new_total:g}s 后有的拍不足 0.5 秒，先合并几拍再重排", file=sys.stderr)
        return 2
    m_of = dict(zip(bounds, mapped))
    short_stages = [f"{_fmt(m_of[float(m.group(2))])}-{_fmt(m_of[float(m.group(4))])}秒" for m in stages
                    if m_of[float(m.group(4))] - m_of[float(m.group(2))] < 1]
    new_body = STAGE_RE.sub(lambda m: f"{m.group(1)}{_fmt(m_of[float(m.group(2))])}{m.group(3)}{_fmt(m_of[float(m.group(4))])}秒", body)
    new_text = text[:start] + new_body + text[end:]
    row = re.compile(r"^(\|\s*" + re.escape(sid) + r"\s*\|\s*)(\d+(?:\.\d+)?)(\s*(?:s|秒)?\s*\|)", re.M)
    new_text, n_row = row.subn(lambda m: m.group(1) + _fmt(new_total) + m.group(3), new_text, count=1)

    diff = difflib.unified_diff(text.splitlines(keepends=True), new_text.splitlines(keepends=True),
                                fromfile=path, tofile=path + "（重排后）")
    sys.stdout.writelines(diff)
    print(f"\n{sid}：{bounds[-1]:g}s → {new_total:g}s，{len(stages)} 拍按原比例重排" + ("" if n_row else "；分段表里没找到这一段的时长，没改表"))
    others = []
    for line in new_body.splitlines():
        rest = STAGE_RE.sub("", line, count=1)
        if OTHER_SEC_RE.search(rest):
            others.append(short(line.strip(), 30))
    if short_stages:
        print(f"  WARN  有的拍不足 1 秒（{'、'.join(short_stages)}），动作多半来不及做完，考虑合并几拍")
    for o in others:
        print(f"  WARN  正文里还有别的秒数没动（运镜时长、停留时间），按新节奏自己核对：{o}")
    if write:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        print(f"已写回 {path}")
    else:
        print("只打印 diff，没写文件；确认后加 --write 写回。")
    return 0


def _retime_shots(path, text, start, end, sid, shots, new_total, write):
    """「分镜N：X秒」按原比例缩放到 new_total：整数秒、每个至少 1 秒，余数给小数部分最大的。"""
    old = [int(m.group(3)) for m in shots]
    if new_total != int(new_total) or new_total < len(old):
        print(f"错误：{len(old)} 个分镜要整数秒且每个至少 1 秒，新时长 {new_total:g}s 不够或不是整数；先合并分镜", file=sys.stderr)
        return 2
    total = int(new_total)
    raw = [o * total / sum(old) for o in old]
    new = [max(1, int(r)) for r in raw]
    while sum(new) < total:
        i = max(range(len(new)), key=lambda k: raw[k] - new[k]); new[i] += 1
    while sum(new) > total:
        i = max((k for k in range(len(new)) if new[k] > 1), key=lambda k: new[k] - raw[k]); new[i] -= 1
    it = iter(new)
    body = SHOT_RE.sub(lambda m: f"{m.group(1)}{next(it)}{m.group(4)}", text[start:end])
    new_text = text[:start] + body + text[end:]
    row = re.compile(r"^(\|\s*" + re.escape(sid) + r"\s*\|\s*)(\d+(?:\.\d+)?)(\s*(?:s|秒)?\s*\|)", re.M)
    new_text, n_row = row.subn(lambda m: m.group(1) + str(total) + m.group(3), new_text, count=1)
    sys.stdout.writelines(difflib.unified_diff(text.splitlines(keepends=True), new_text.splitlines(keepends=True),
                                               fromfile=path, tofile=path + "（重排后）"))
    print(f"\n{sid}：{sum(old)}s → {total}s，{len(old)} 个分镜 {old} → {new}" + ("" if n_row else "；分段表里没找到这一段的时长，没改表"))
    for line in body.splitlines():
        rest = SHOT_RE.sub("", line, count=1)
        if OTHER_SEC_RE.search(rest):
            print(f"  WARN  正文里还有别的秒数没动（运镜时长、停留时间），按新节奏自己核对：{short(line.strip(), 30)}")
    if write:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        print(f"已写回 {path}")
    else:
        print("只打印 diff，没写文件；确认后加 --write 写回。")
    return 0


# ---------------- 剧本模式 ----------------

DIALOGUE_RE = re.compile(r"^(?P<who>[^\s△【#：:（(][^：:（(]{0,15}?)\s*(?:[（(](?P<note>[^）)]*)[）)])?\s*[：:]\s*(?P<line>.*\S)\s*$")
SCENE_RE = re.compile(r"^##\s*场")
PATH_EXT_RE = re.compile(r"\.[A-Za-z][A-Za-z0-9]{0,7}$")


def parse_seconds(v):
    """episodeSeconds：数字、[下限, 上限] 或 "60-90" → (下限, 上限)；无法识别返回 None。"""
    if _num(v) and v > 0:
        return (v, v)
    if isinstance(v, list) and len(v) == 2 and all(_num(x) and x > 0 for x in v):
        return (min(v), max(v))
    if isinstance(v, str):
        m = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:[-~～]\s*(\d+(?:\.\d+)?))?\s*", v)
        if m:
            lo = float(m.group(1))
            hi = float(m.group(2) or m.group(1))
            return (min(lo, hi), max(lo, hi))
    return None


README_SECONDS_RE = re.compile(r"单集时长[^\d\n]{0,12}(\d+(?:\.\d+)?)\s*(?:(?:[-~～]|到|至)\s*(\d+(?:\.\d+)?))?")


def find_episode_seconds(path):
    """从剧本所在目录向上找 README.md（项目卡），取「单集时长」那一行的秒数，返回 (原值, README 路径)。"""
    d = os.path.dirname(os.path.abspath(path))
    for _ in range(4):
        f = os.path.join(d, "README.md")
        if os.path.isfile(f):
            try:
                with open(f, encoding="utf-8") as fh:
                    m = README_SECONDS_RE.search(fh.read())
            except (OSError, UnicodeDecodeError):
                return (None, f)
            if m:
                return (m.group(1) + (f"-{m.group(2)}" if m.group(2) else ""), f)
            return (None, f)
        d = os.path.dirname(d)
    return (None, None)


def analyze_script(path, seconds_arg):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    title = ""
    scenes = 0
    lines, unknown = [], []
    for no, raw in enumerate(text.splitlines(), 1):
        s = raw.strip()
        if not s:
            continue
        if SCENE_RE.match(s):
            scenes += 1
            continue
        if s.startswith("#"):
            title = title or s.lstrip("#").strip()
            continue
        if s.startswith(("△", "【", "出场：", "出场:")):
            continue
        m = DIALOGUE_RE.match(s)
        if not m:
            unknown.append({"no": no, "text": s})
            continue
        units = count_speech_units(m.group("line"))
        _, lo, hi = estimate_speech(m.group("line"))
        lines.append({"no": no, "who": m.group("who"), "line": m.group("line"),
                      "count": units.chars + units.digits + units.english_words, "lo": lo, "hi": hi})
    if not scenes:
        raise ValueError("不是统一剧本格式：没有「## 场…」场头（格式见 references/script/episode-writing.md）")

    line_count = sum(x["count"] for x in lines)
    full_count = sum(1 for ch in text if not ch.isspace() and ch != "#")
    if seconds_arg is not None:
        raw_sec, src = seconds_arg, "--seconds"
    else:
        raw_sec, src = find_episode_seconds(path)
    sec = parse_seconds(raw_sec)
    verdicts = []
    if sec:
        for name, n, rate in (("台词", line_count, SCRIPT_LINE_RATE), ("全文", full_count, SCRIPT_FULL_RATE)):
            lo, hi = round(sec[0] * rate[0]), round(sec[1] * rate[1])
            state = "在档" if lo <= n <= hi else ("偏少" if n < lo else "超出")
            verdicts.append({"what": name, "count": n, "range": [lo, hi], "state": state})
    return {
        "file": path, "title": title, "scenes": scenes,
        "lineCount": len(lines), "lineChars": line_count, "fullChars": full_count,
        "speech": {"lo": round(sum(x["lo"] for x in lines), 1), "hi": round(sum(x["hi"] for x in lines), 1)},
        "episodeSeconds": raw_sec, "secondsSource": src, "verdicts": verdicts,
        "longLines": [x for x in lines if x["count"] > SCRIPT_MAX_LINE],
        "unknownLines": unknown,
    }


def run_scripts(paths, seconds_arg, as_json):
    results = []
    for path in paths:
        try:
            results.append(analyze_script(path, seconds_arg))
        except (OSError, UnicodeDecodeError, ValueError) as e:
            print(f"错误：{path}：{e}", file=sys.stderr)
            return 2
    bad = sum(1 for r in results if any(v["state"] != "在档" for v in r["verdicts"]))
    if as_json:
        print(json.dumps({"episodes": results, "outOfRange": bad,
                          "note": "档位与语速常量为经验值，未实测"}, ensure_ascii=False, indent=2))
        return 0
    for r in results:
        print(f"# {r['title'] or '?'}（{r['file']}）")
        print(f"  {r['scenes']} 场；台词 {r['lineChars']} 字（{r['lineCount']} 句，含 os/vo），"
              f"按语速估算 {r['speech']['lo']}~{r['speech']['hi']}s；全文 {r['fullChars']} 字")
        if r["verdicts"]:
            sec = parse_seconds(r["episodeSeconds"])
            sec_s = f"{sec[0]:g}" if sec[0] == sec[1] else f"{sec[0]:g}-{sec[1]:g}"
            print(f"  单集时长 {sec_s}s（来自 {r['secondsSource']}）：" + "；".join(
                f"{v['what']}应为 {v['range'][0]}-{v['range'][1]} 字 → {v['state']}" for v in r["verdicts"]))
        else:
            print("  未判断档位：没有单集时长（项目 README.md 里没有「单集时长：60-90 秒」这样的一行），"
                  "可用 --seconds 60 或 --seconds 60-90 指定")
        for x in r["longLines"]:
            print(f"  WARN  第 {x['no']} 行 {x['who']}「{short(x['line'], 24)}」{x['count']} 字，超过单句 {SCRIPT_MAX_LINE} 字")
        for x in r["unknownLines"][:5]:
            print(f"  WARN  第 {x['no']} 行既不是 △/场头/台词，没有计入台词：{short(x['text'], 24)}")
    if len(results) > 1:
        print(f"\n合计 {len(results)} 集，不在档 {bad} 集")
    print("注：档位与语速常量为经验值，未实测。")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(
        description="台词/旁白耗时计量：传台词逐条计时（加 --duration 判断能否放进一个片段），传 shots/E01.md 逐段核算，或传剧本 .md 统计字数与档位。")
    p.add_argument("items", nargs="*", help="台词文本若干条（可写成「角色：台词」以计换人停顿），或若干剧本 .md 路径")
    p.add_argument("--duration", type=float, help="片段时长（秒）：判断这几句台词放进该片段是否超载")
    p.add_argument("--mode", choices=("normal", "slow"), default="normal",
                   help="slow = 吟诵慢速口径（仅诗词原文）")
    p.add_argument("--max-duration", type=float, help="视频模型单次时长上限（秒，以 model describe 为准）")
    p.add_argument("--min-duration", type=float, help="视频模型单次时长下限（秒）")
    p.add_argument("--seconds", help="剧本模式的单集时长，如 60 或 60-90；默认读项目 README.md 的「单集时长」")
    p.add_argument("--json", action="store_true", help="片段模式、剧本模式输出 JSON")
    p.add_argument("--retime", metavar="shots/E01.md#S02",
                   help="把这一段行首的「X-Y秒」时间锚点按原比例改写到 --duration 给的新时长，并改分段表；默认只打印 diff")
    p.add_argument("--write", action="store_true", help="配合 --retime：把重排结果写回文件")
    a = p.parse_args(argv)

    if a.retime:
        if a.items:
            print("错误：--retime 不和其他文件或台词一起传", file=sys.stderr)
            return 2
        return run_retime(a.retime, a.duration, a.write)
    if a.write:
        print("错误：--write 只配合 --retime 用", file=sys.stderr)
        return 2

    paths = [x for x in a.items if os.path.exists(x) or (not any(c.isspace() for c in x) and PATH_EXT_RE.search(x))]
    if paths:
        if len(paths) != len(a.items):
            print("错误：文件路径和台词文本不能混在一起传", file=sys.stderr)
            return 2
        dirs = [x for x in paths if os.path.isdir(x)]
        if dirs:
            print(f"错误：{', '.join(dirs)} 是目录，要传具体文件，如 story/E01.md", file=sys.stderr)
            return 2
        missing = [x for x in paths if not os.path.isfile(x)]
        if missing:
            print(f"错误：文件不存在：{', '.join(missing)}", file=sys.stderr)
            return 2
        exts = {os.path.splitext(x)[1].lower() for x in paths}
        if exts == {".md"}:
            seconds = a.seconds
            if seconds is not None and not parse_seconds(seconds):
                print(f"错误：--seconds 写成 60 或 60-90，收到 {seconds}", file=sys.stderr)
                return 2
            texts = {x: open(x, encoding="utf-8").read() for x in paths}
            shots = [x for x in paths if is_shots_md(texts[x])]
            if shots:
                if len(paths) != 1:
                    print("错误：分镜文件一次传一个（如 shots/E01.md）", file=sys.stderr)
                    return 2
                return run_shots(paths[0], a.mode, a.max_duration, a.min_duration, a.json)
            return run_scripts(paths, seconds, a.json)
        print(f"错误：不认识的文件 {', '.join(paths)}：只支持剧本 .md；片段台词请直接传文本并加 --duration", file=sys.stderr)
        return 2
    if not a.items:
        p.print_usage()
        return 1
    if a.duration is not None:
        return run_segment(a.items, a.duration, a.mode, a.max_duration, a.min_duration, a.json)
    return run_texts(a.items, a.mode)


if __name__ == "__main__":
    sys.exit(main())
