# -*- coding: utf-8 -*-
"""deepseek.py — Claude Code 调用 DeepSeek 的通道。模型固定 deepseek-flash（DeepSeek-V4.1-Flash-1017）。

  bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort high "问题"
  bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort max -f 任务书.md --out 答卷.md
  bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort high --image 图.png "看看这张图"
  bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort high --resume last "接着问"

已处理的坑（2026-10-29 实测）：中文一律按 UTF-8 发（curl 命令行里的中文会变成 GBK，API 直接 400）；
max_tokens 按档位开足（思考也算在里面）；思考和正文分开存；max 档偶尔想完了没有正文，会自动重试，再空就降到 high；
数据流没收到结束标记算中断并重试；服务端指纹变了会提醒（API 只有 deepseek-flash 这个别名，锁不住版本）。
不管成功失败，屏幕最后一行都是 RESULT_JSON。用法与踩坑见同目录 README.md。只用标准库。
"""
import argparse
import base64
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNS_DIR = os.environ.get("DEEPSEEK_RUNS_DIR") or os.path.join(BRIDGE_DIR, "runs")  # 测试时指到临时目录
LAST_RUN = os.path.join(RUNS_DIR, "last_ds_run.txt")
KEY_FILE = os.environ.get("DEEPSEEK_KEY_FILE") or "E:/ai-bridge/deepseek.key"  # 密钥不放进项目仓库，仍读原位置
URL = "https://api.deepseek.com/chat/completions"
PRICING_PAGE = "https://api-docs.deepseek.com/quick_start/pricing/"  # 末尾斜杠不能丢，否则跳到首页

# 用户指定固定这个模型。2026-10-29 实测 80 次响应的 system_fingerprint 全是下面这个值，背后换版本时它会变。
MODEL = "deepseek-flash"
PINNED_VERSION = "DeepSeek-V4.1-Flash-1017"
KNOWN_FINGERPRINTS = {"bc19ba97cbe016479903222bb1578db6": PINNED_VERSION}

EFFORTS = ("none", "low", "high", "max")
EFFORT_ALIASES = {"minimal": "low", "medium": "high", "xhigh": "high", "ultra": "max"}  # API 实际就是这么映射的
MAX_TOKENS = {"none": 65536, "low": 131072, "high": 131072, "max": 393216}  # 按实际用量计费，开大不多花钱
MAX_TOKENS_LIMIT = 393216
CONTEXT_TOKENS = 1048576
BODY_LIMIT_MB = 46  # API 请求体上限 48 MiB，留点余量
# 每百万 token 美元价（2026-10-19 价格页）：(输入缓存命中, 输入未命中, 输出)；高峰 = 北京时间工作日 9–12、14–18 点
PRICE = {"peak": (0.006, 0.3, 1.2), "offpeak": (0.003, 0.15, 0.6)}


# ---------- 输入 ----------

def api_url():
    """DEEPSEEK_API_URL 只给本机测试（假服务器）用，只认 127.0.0.1 / localhost，免得 key 被发到别处。"""
    u = os.environ.get("DEEPSEEK_API_URL", "").strip()
    if not u:
        return URL
    if urllib.parse.urlparse(u).hostname not in ("127.0.0.1", "localhost"):
        sys.exit("DEEPSEEK_API_URL 只允许指向本机（测试用）：%s" % u)
    return u


def api_key():
    """环境变量 DEEPSEEK_API_KEY 优先，其次 deepseek.key。返回 (key, 来源)。"""
    k, src = os.environ.get("DEEPSEEK_API_KEY", ""), "环境变量 DEEPSEEK_API_KEY"
    if not k.strip() and os.path.isfile(KEY_FILE):
        with open(KEY_FILE, encoding="utf-8-sig") as f:  # 记事本存的 UTF-8 可能带 BOM
            k, src = f.read(), KEY_FILE
    k = k.strip().strip("\"'").strip()
    if not k:
        sys.exit("没有 API Key：写进 %s，或设置环境变量 DEEPSEEK_API_KEY" % KEY_FILE)
    if not k.isascii() or any(c.isspace() for c in k):
        sys.exit("API Key 格式不对（含空格、换行或非 ASCII 字符），来源：%s" % src)
    return k, src


def decode_text(raw, label):
    """UTF-8（可带 BOM）优先；UTF-16 按 BOM 认（PowerShell 重定向默认存这个）；都不是就按 GB18030。"""
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        pass
    try:
        s = raw.decode("gb18030")
    except UnicodeDecodeError:
        sys.exit("%s 的编码认不出来，请存成 UTF-8" % label)
    print("（%s 不是 UTF-8，按 GB18030 读取）" % label, file=sys.stderr)
    return s


def read_file(path):
    if not os.path.isfile(path):
        sys.exit("找不到文件：%s" % path)
    with open(path, "rb") as f:
        return decode_text(f.read(), path)


def win_path(p):
    """/c/xxx 换成 C:/xxx。ds.sh 关掉了 Git Bash 的自动路径改写（它会改坏以 / 开头的提示词），路径就在这里换算。"""
    m = re.match(r"^/([a-zA-Z])(/.*)?$", p or "")
    return "%s:%s" % (m.group(1).upper(), m.group(2) or "/") if m else p


def read_prompt(a):
    parts = []
    if a.file == "-":
        parts.append(decode_text(sys.stdin.buffer.read(), "标准输入"))
    elif a.file:
        parts.append(read_file(a.file))
    if a.text:
        parts.append(" ".join(a.text))
    p = "\n\n".join(x.strip() for x in parts if x and x.strip())
    if not p:
        sys.exit("没有提示词：直接写在命令后面，或用 -f 指定 UTF-8 文件（-f - 读标准输入）")
    return p


def image_block(path):
    """读本地图片，返回发给 API 的 image_url 块。格式按文件头判断（API 也是按内容认格式）。"""
    with open(path, "rb") as f:
        data = f.read()
    head = data[:12]
    if head.startswith(b"\x89PNG"):
        mime = "image/png"
    elif head.startswith(b"\xff\xd8"):
        mime = "image/jpeg"
    elif head[:4] == b"GIF8":
        mime = "image/gif"
    elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        mime = "image/webp"
    else:
        sys.exit("不支持的图片格式（只认 JPEG/PNG/GIF/WebP）：%s" % path)
    if len(data) > 32 * 1024 * 1024:
        sys.exit("图片超过 32 MiB：%s" % path)
    return {"type": "image_url",
            "image_url": {"url": "data:%s;base64,%s" % (mime, base64.b64encode(data).decode("ascii"))}}


def image_paths(messages):
    return [b["path"] for m in messages if isinstance(m["content"], list)
            for b in m["content"] if b.get("type") == "image_path"]


def to_wire(messages):
    """存档里的图片只记路径；发请求前再编码成 base64。"""
    out = []
    for m in messages:
        c = m["content"]
        if isinstance(c, list):
            c = [image_block(b["path"]) if b.get("type") == "image_path" else b for b in c]
        out.append({"role": m["role"], "content": c})
    return out


def load_history(ref):
    if ref == "last":
        if not os.path.isfile(LAST_RUN):
            sys.exit("没有上一次成功的 DeepSeek 记录可续")
        for i in range(20):  # 别的调用正在替换这个文件时会暂时打不开
            try:
                with open(LAST_RUN, encoding="utf-8") as f:
                    ref = f.read().strip()
                break
            except PermissionError:
                time.sleep(0.02 * (i + 1))
        else:
            sys.exit("读不了 %s（被别的调用占着），改用 --resume <run_dir>" % LAST_RUN)
    path = os.path.join(ref, "messages.json")
    if not os.path.isfile(path):
        sys.exit("续问失败：%s 里没有 messages.json（那次可能没成功）" % ref)
    with open(path, encoding="utf-8") as f:
        return json.load(f), ref


def unique_path(path, force):
    if force or not os.path.exists(path):
        return path
    stem, ext = os.path.splitext(path)
    n = 2
    while os.path.exists("%s-v%d%s" % (stem, n, ext)):
        n += 1
    return "%s-v%d%s" % (stem, n, ext)


def update_last_run(run_dir):
    """更新 --resume last 的指针：先写临时文件再整体替换，别人不会读到半截。
    Windows 上几个进程同时替换同一个文件会被拒绝访问（实测 8 进程并发约 1/8 失败），所以重试；
    还不行就放弃——它只是个方便用的指针，绝不能让本次调用失败。"""
    tmp = "%s.%d.tmp" % (LAST_RUN, os.getpid())
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(run_dir)
        for i in range(20):
            try:
                os.replace(tmp, LAST_RUN)
                return True
            except PermissionError:
                time.sleep(0.02 * (i + 1))
    except OSError:
        pass
    try:
        os.remove(tmp)
    except OSError:
        pass
    return False


def fwd(p):
    return p.replace("\\", "/")


# ---------- 调用 ----------

class Run:
    """一次调用的上下文：记录目录、进度日志、截止时间、累计尝试次数和每次的用量。"""

    def __init__(self, run_dir, deadline):
        self.dir = run_dir
        self.deadline = deadline
        self.attempts = 0
        self.usages = []
        self.t0 = time.time()
        self.log = open(os.path.join(run_dir, "progress.log"), "a", encoding="utf-8")

    def path(self, name):
        return os.path.join(self.dir, name)

    def say(self, msg, echo=True):
        line = "[%s +%ds] %s" % (datetime.now().strftime("%H:%M:%S"), time.time() - self.t0, msg)
        self.log.write(line + "\n")
        self.log.flush()
        if echo:
            print(line, file=sys.stderr, flush=True)


def new_state(error=None):
    return dict(answer="", reasoning="", finish=None, done=False, usage=None, model=None, fingerprint=None,
                error=error, http=None)


def stream_once(key, payload, run):
    """发一次流式请求，边收边写 answer.md / reasoning.md。上一次尝试的文件先改名成 *.tryN.md 留底。"""
    run.attempts += 1
    if run.attempts > 1:
        for name in ("answer", "reasoning"):
            p = run.path(name + ".md")
            if os.path.isfile(p):
                if os.path.getsize(p):
                    os.replace(p, run.path("%s.try%d.md" % (name, run.attempts - 1)))
                else:
                    os.remove(p)
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(api_url(), data=body, method="POST", headers={
        "Content-Type": "application/json", "Accept": "text/event-stream", "Authorization": "Bearer " + key})
    st = new_state()
    ans, rea = [], []
    fa = open(run.path("answer.md"), "w", encoding="utf-8")
    fr = open(run.path("reasoning.md"), "w", encoding="utf-8")
    tick = time.time()
    try:
        # timeout 是单次读取的静默上限；排队时服务端会发 ": keep-alive" 心跳，不会误触发
        with urllib.request.urlopen(req, timeout=max(5, min(300, run.deadline - time.time()))) as r:
            for raw in r:
                if time.time() > run.deadline:
                    st["error"] = "timeout"
                    break
                line = raw.decode("utf-8", "replace").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    st["done"] = True
                    break
                ch = json.loads(data)
                st["model"] = ch.get("model") or st["model"]
                st["fingerprint"] = ch.get("system_fingerprint") or st["fingerprint"]
                st["usage"] = ch.get("usage") or st["usage"]
                for c in ch.get("choices") or []:
                    d = c.get("delta") or {}
                    if d.get("reasoning_content"):
                        rea.append(d["reasoning_content"])
                        fr.write(d["reasoning_content"])
                    if d.get("content"):
                        ans.append(d["content"])
                        fa.write(d["content"])
                    st["finish"] = c.get("finish_reason") or st["finish"]
                if time.time() - tick >= 30:
                    tick = time.time()
                    fa.flush()
                    fr.flush()
                    run.say("思考 %d 字 · 正文 %d 字" % (sum(map(len, rea)), sum(map(len, ans))))
    except urllib.error.HTTPError as e:
        st["http"] = e.code
        txt = e.read().decode("utf-8", "replace")
        try:
            msg = (json.loads(txt).get("error") or {}).get("message") or txt
        except Exception:
            msg = txt
        st["error"] = "HTTP %d: %s" % (e.code, msg.strip()[:500])
    except Exception as e:  # 断线、静默超时、坏数据
        st["error"] = "timeout" if time.time() >= run.deadline else "%s: %s" % (type(e).__name__, e)
    finally:
        fa.close()
        fr.close()
    st["answer"], st["reasoning"] = "".join(ans).strip(), "".join(rea).strip()
    if st["usage"]:
        run.usages.append(st["usage"])
    if st["error"] and st["http"] is None and st["finish"]:
        # 已收到 finish_reason，正文是完整的；之后才出的错（比如没等到 [DONE] 就断线）不算失败
        run.say("正文已收完，之后连接出错，忽略：%s" % st["error"], echo=False)
        st["error"] = None
    elif not st["error"] and not st["done"] and not st["finish"]:
        st["error"] = "数据流中断：没收到结束标记"
    return st


def call(key, wire, effort, max_tokens, run):
    """一次完整调用：429、5xx、断线、数据流中断最多重试 2 次。返回 (st, 这次调用里的重试次数)。
    全都失败时，交回拿到正文最多的那次，免得半截内容被后面的空结果顶掉。"""
    payload = {"model": MODEL, "messages": wire, "max_tokens": max_tokens, "reasoning_effort": effort,
               "stream": True, "stream_options": {"include_usage": True}}
    partial = None
    for attempt in range(3):
        st = new_state("timeout") if time.time() >= run.deadline else stream_once(key, payload, run)
        if st["error"] and st["answer"] and (partial is None or len(st["answer"]) > len(partial["answer"])):
            partial = st
        retry = st["error"] not in (None, "timeout") and (st["http"] is None or st["http"] == 429 or st["http"] >= 500)
        if not retry or attempt == 2 or time.time() + 30 > run.deadline:
            return (partial if st["error"] and not st["answer"] and partial else st), attempt
        wait = 5 if attempt == 0 else 20
        run.say("出错，%d 秒后重试：%s" % (wait, st["error"]))
        time.sleep(wait)


def totals(usages, start):
    """各次尝试的用量和费用加总。失败的请求如果没回传用量，这部分算不进来。"""
    if not usages:
        return dict(tokens_in=None, tokens_out=None, reasoning_tokens=None, cost_usd=None)
    peak = start.weekday() < 5 and (1 <= start.hour < 4 or 6 <= start.hour < 10)
    hit_p, miss_p, out_p = PRICE["peak" if peak else "offpeak"]
    t = dict(tokens_in=0, tokens_out=0, reasoning_tokens=0, cost_usd=0.0)
    for u in usages:
        h = u.get("prompt_cache_hit_tokens") or 0
        m = u.get("prompt_cache_miss_tokens", (u.get("prompt_tokens") or 0) - h)
        out = u.get("completion_tokens") or 0
        t["tokens_in"] += u.get("prompt_tokens") or 0
        t["tokens_out"] += out
        t["reasoning_tokens"] += (u.get("completion_tokens_details") or {}).get("reasoning_tokens") or 0
        t["cost_usd"] += (h * hit_p + m * miss_p + out * out_p) / 1e6
    t["cost_usd"] = round(t["cost_usd"], 5)
    return t


# ---------- 主流程 ----------

def main():
    ap = argparse.ArgumentParser(prog="ds", description="Claude Code → DeepSeek（固定 deepseek-flash = V4.1-Flash-1017）")
    ap.add_argument("text", nargs="*", help="提示词（也可用 -f）")
    ap.add_argument("-f", "--file", help="从文件读提示词（UTF-8；- 表示标准输入）")
    ap.add_argument("--effort", default="high", help="none|low|high|max（默认 high）")
    ap.add_argument("--system", help="系统提示（文本）")
    ap.add_argument("--system-file", help="系统提示（UTF-8 文件）")
    ap.add_argument("--image", action="append", help="附图（JPEG/PNG/GIF/WebP），可多次")
    ap.add_argument("--resume", help="续问：上次 RESULT_JSON 里的 run_dir，或 last（同时开着几段对话时别用 last）")
    ap.add_argument("--out", help="把正文另存到这个文件；已存在就加 -v2（除非 --force），实际路径看 RESULT_JSON 的 out")
    ap.add_argument("--force", action="store_true", help="--out 允许覆盖")
    ap.add_argument("--max-tokens", type=int,
                    help="默认按档位：none 65536 / low、high 131072 / max 393216；范围 1–393216")
    ap.add_argument("--timeout", type=int, default=1800, help="总时长上限，秒（默认 1800）")
    ap.add_argument("--show-reasoning", action="store_true", help="同时打印思考过程")
    a = ap.parse_args()

    requested = a.effort.strip().lower()
    effort = EFFORT_ALIASES.get(requested, requested)
    if effort not in EFFORTS:
        sys.exit("--effort 只能是 none|low|high|max（收到 %s）" % a.effort)
    if effort != requested:
        print("（%s 在 DeepSeek 上等于 %s，按 %s 发）" % (requested, effort, effort), file=sys.stderr)
    if a.timeout <= 0:
        sys.exit("--timeout 必须大于 0")
    if a.max_tokens is not None and not 1 <= a.max_tokens <= MAX_TOKENS_LIMIT:
        sys.exit("--max-tokens 必须在 1–%d 之间" % MAX_TOKENS_LIMIT)

    if a.file != "-":
        a.file = win_path(a.file)
    a.system_file = win_path(a.system_file)
    if a.resume and a.resume != "last":
        a.resume = win_path(a.resume)
    out_path = os.path.abspath(win_path(a.out)) if a.out else None
    if out_path and os.path.isdir(out_path):
        sys.exit("--out 要写文件路径，不是文件夹：%s" % a.out)

    key, key_src = api_key()
    text = read_prompt(a)
    images = [os.path.abspath(win_path(p)) for p in a.image or []]
    system = a.system
    if a.system_file:
        system = read_file(a.system_file).strip()

    history, resumed = ([], None)
    if a.resume:
        history, resumed = load_history(a.resume)
    if system:
        history = [m for m in history if m["role"] != "system"]
        history.insert(0, {"role": "system", "content": system})
    user = {"role": "user", "content": text}
    if images:
        user["content"] = [{"type": "text", "text": text}] + [{"type": "image_path", "path": p} for p in images]
    messages = history + [user]

    # 先按文件大小估算，超限就别去编码图片
    imgs = image_paths(messages)
    for p in imgs:
        if not os.path.isfile(p):
            sys.exit("图片不存在：%s" % p + ("（续问要重新发送历史里的图）" if p not in images else ""))
    texts = [m["content"] if isinstance(m["content"], str) else "".join(b.get("text", "") for b in m["content"])
             for m in messages]
    body_mb = (sum(len(t.encode("utf-8")) for t in texts) + sum(os.path.getsize(p) * 4 / 3 + 200 for p in imgs)) / 1048576
    if body_mb > BODY_LIMIT_MB:
        sys.exit("请求体约 %.0f MiB，超过 48 MiB 上限；少传几张图或先压缩" % body_mb)
    # 上下文 1M：保守按 1 字 = 1 token、每张图 1500 token 估输入，max_tokens 不超过剩下的空间
    room = CONTEXT_TOKENS - sum(map(len, texts)) - 1500 * len(imgs) - 1024
    if room < 1024:
        sys.exit("提示词太长（约 %d 字），超过 1M 上下文" % sum(map(len, texts)))
    max_tokens = min(a.max_tokens or MAX_TOKENS[effort], room)
    wire = to_wire(messages)

    os.makedirs(RUNS_DIR, exist_ok=True)
    run_dir = os.path.join(RUNS_DIR, "%s-ds-%d" % (datetime.now().strftime("%Y%m%d-%H%M%S"), os.getpid()))
    os.makedirs(run_dir, exist_ok=True)
    with open(os.path.join(run_dir, "prompt.md"), "w", encoding="utf-8") as f:
        if system:
            f.write("<<<SYSTEM>>>\n%s\n<<<END SYSTEM>>>\n\n" % system)
        if resumed:
            f.write("（续问 %s）\n\n" % resumed)
        f.write(text + "\n")
        for p in images:
            f.write("\n[图] %s" % p)
    with open(os.path.join(run_dir, "request.json"), "w", encoding="utf-8") as f:
        json.dump({"model": MODEL, "effort": effort, "max_tokens": max_tokens, "messages": messages},
                  f, ensure_ascii=False, indent=1)
    run = Run(run_dir, time.time() + a.timeout)
    start = datetime.now(timezone.utc)
    print("[DeepSeek] %s（%s）/%s · 记录 %s" % (MODEL, PINNED_VERSION, effort, fwd(run_dir)), flush=True)

    st, _ = call(key, wire, effort, max_tokens, run)
    fallback = None
    # 有思考没正文：同档再来一次；max 还空就降 high（2026-09-05 V4-Pro 的 max 档翻过车）
    if not st["error"] and not st["answer"] and st["finish"] != "length":
        run.say("有思考没正文（finish=%s），同档重试一次" % st["finish"])
        st, _ = call(key, wire, effort, max_tokens, run)
        if effort == "max" and not st["error"] and not st["answer"]:
            run.say("还是没有正文，降到 high 重答")
            st, _ = call(key, wire, "high", min(a.max_tokens or MAX_TOKENS["high"], room), run)
            fallback = "max→high"

    answer = st["answer"]
    # 最终的 answer.md / reasoning.md 以交回的这次为准；失败尝试的原始内容在 *.tryN.md
    with open(run.path("answer.md"), "w", encoding="utf-8") as f:
        f.write(answer)
    with open(run.path("reasoning.md"), "w", encoding="utf-8") as f:
        f.write(st["reasoning"])
    fp = st["fingerprint"]
    res = {"ok": False, "seconds": round(time.time() - run.t0, 1), "model": st["model"],
           "version": KNOWN_FINGERPRINTS.get(fp, "未知（指纹变了）" if fp else None), "fingerprint": fp,
           "effort": effort, "finish_reason": st["finish"]}
    res.update(totals(run.usages, start))
    res.update(answer_chars=len(answer), run_dir=fwd(run_dir))
    if requested != effort:
        res["effort_requested"] = requested
    if run.attempts > 1:
        res["attempts"] = run.attempts
    if fallback:
        res["fallback"] = fallback
    if st["error"]:
        res["error"] = st["error"] + ("（key 来自 %s）" % key_src if st["http"] == 401 else "")
    elif st["finish"] == "length":
        res["truncated"] = True
        res["error"] = ("正文被 max_tokens 截断（已收到 %d 字），调大 --max-tokens 重跑" % len(answer) if answer
                        else "没有正文：思考把 max_tokens 用完了（finish=length），调大 --max-tokens 重跑")
    elif not answer:
        res["error"] = "没有正文（finish=%s）" % st["finish"]
    else:
        res["ok"] = True
    if fp and fp not in KNOWN_FINGERPRINTS:
        print("⚠️ 服务端指纹变了（%s）：deepseek-flash 背后可能已换版本，去 %s 看 MODEL VERSION" % (fp, PRICING_PAGE),
              file=sys.stderr)

    if res["ok"]:
        with open(run.path("messages.json"), "w", encoding="utf-8") as f:
            json.dump(messages + [{"role": "assistant", "content": answer}], f, ensure_ascii=False, indent=1)
        if not update_last_run(run_dir):
            run.say("last 指针没更新上（几个调用同时结束撞车了）；要续问这次，用 --resume %s" % fwd(run_dir))
        if out_path:
            try:
                out = unique_path(out_path, a.force)
                os.makedirs(os.path.dirname(out), exist_ok=True)
                with open(out, "w", encoding="utf-8") as f:
                    f.write(answer + "\n")
                res["out"] = fwd(out)
            except OSError as e:
                res["ok"] = False
                res["error"] = "正文已收到（在 run_dir/answer.md），但 --out 写不进去：%s" % e
    with open(run.path("result.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    run.say("结束：%s" % ("成功" if res["ok"] else res.get("error")), echo=False)

    if a.show_reasoning and st["reasoning"]:
        print("\n=== 思考 ===\n" + st["reasoning"], flush=True)
    print("\n=== 回复 ===\n" + (answer or "(无)"), flush=True)
    print("RESULT_JSON " + json.dumps(res, ensure_ascii=False), flush=True)
    return 0 if res["ok"] else (124 if st["error"] == "timeout" else 1)


def emit_failure(msg):
    print("RESULT_JSON " + json.dumps({"ok": False, "error": msg}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        code = main()
    except SystemExit as e:  # 参数错误、文件不存在等提前退出：照样给一行 RESULT_JSON
        if e.code in (None, 0):  # --help
            raise
        if isinstance(e.code, str):
            print(e.code, file=sys.stderr)
            emit_failure(e.code)
            code = 1
        else:
            emit_failure("命令参数有误，见上面的用法说明")
            code = e.code
    except KeyboardInterrupt:
        emit_failure("被中断")
        code = 130
    except Exception as e:
        traceback.print_exc()
        emit_failure("脚本出错：%s: %s" % (type(e).__name__, e))
        code = 1
    sys.exit(code)
