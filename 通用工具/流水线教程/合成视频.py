# -*- coding: utf-8 -*-
"""把一课的截图、框、配音合成教学视频（1920×1080，30 帧）。
用法（Codex 自带的 Python，有 numpy、Pillow）：
    python -I -X utf8 合成视频.py <课的文件夹> [--试]      --试：配音还没有时按字数估时长、出无声的试看版
课的文件夹里要有：
    解说词.txt   一行一句，配音照它念
    配音_NN.wav  每句一个（配音.py 出的），第 NN 句
    画面.json    每句配什么画面、什么时候框哪里、点哪里（见下面 Scene 那几种）
    框.json、截图_*.png   截图.js 出的
出：<课名>.mp4（课名是文件夹名），和合好的整条配音 配音.wav。
"""
import glob
import json
import math
import os
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
WX, WY, WW, WH = 160, 34, 1600, 900          # 「屏幕」窗口在画面里的位置
SR = 48000                                  # 配音采样率
INK, SUB, PAPER, BG = (42, 36, 29), (107, 99, 88), (251, 248, 241), (233, 227, 214)
HL = (232, 89, 12)                          # 框和标签的颜色（亮橙，和页面自己的红区分开）
SEAL = (155, 44, 44)
FF = sorted(glob.glob('D:/Apps/JianyingPro/*/ffmpeg.exe'))[-1]
_fonts = {}


def font(size, bold=False):
    k = (size, bold)
    if k not in _fonts:
        _fonts[k] = ImageFont.truetype('C:/Windows/Fonts/msyhbd.ttc' if bold else 'C:/Windows/Fonts/msyh.ttc', size)
    return _fonts[k]


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def lerp(a, b, k):
    return [p + (q - p) * k for p, q in zip(a, b)]


# ---------------- 配音 ----------------
def read_wav(p):
    with wave.open(p) as w:
        assert w.getsampwidth() == 2, p
        x = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        if w.getnchannels() == 2:
            x = x.reshape(-1, 2).mean(1)
        if w.getframerate() != SR:
            n = int(len(x) * SR / w.getframerate())
            x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)
    return x


def speech_span(x):
    hop = SR // 100
    n = len(x) // hop
    if n == 0:
        return 0.0, len(x) / SR
    db = 20 * np.log10(np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
    on = np.where(db > -40)[0]
    if not len(on):
        return 0.0, len(x) / SR
    return on[0] * 0.01, (on[-1] + 1) * 0.01


def click_sound():
    t = np.arange(int(SR * 0.05)) / SR
    s = (np.sin(2 * np.pi * 1900 * t) * 0.6 + np.random.RandomState(1).randn(len(t)) * 0.4) * np.exp(-t * 140)
    return (s * 0.22).astype(np.float32)


# ---------------- 估字的时间 ----------------
def wt(ch):
    if ch in '，、：；': return 1.3
    if ch in '。！？': return 2.0
    if ch.isspace(): return 0.2
    if ch.isascii() and ch.isalnum(): return 0.45
    return 1.0


def word_time(ln, text, idx):
    w = [wt(c) for c in text]
    tot = sum(w) - (w[-1] if text[-1] in '。！？' else 0)
    return ln['_s'] + (ln['_e'] - ln['_s']) * sum(w[:idx]) / max(tot, 1e-6)


def anchor(ln, text, act):
    if '时' in act:
        return ln['_t0'] + act['时']
    if '比' in act:
        return ln['_s'] + (ln['_e'] - ln['_s']) * act['比']
    if '字' in act:
        i = text.find(act['字'])
        if i < 0:
            raise SystemExit('第%d句里没有「%s」：%s' % (ln['_i'] + 1, act['字'], text))
        return word_time(ln, text, i) - act.get('提前', 0.12)
    return ln['_t0']


# ---------------- 字幕 ----------------
def sub_chunks(text):
    out, cur = [], ''
    for ch in text:
        cur += ch
        if ch in '。！？' or (ch in '，：；' and len(cur) >= 12):
            out.append(cur)
            cur = ''
    if cur.strip():
        out.append(cur)
    res = []
    for c in out:   # 太短的并到前一块
        if res and len(c.strip('，。：；！？ ')) <= 4 and len(res[-1]) + len(c) <= 22:
            res[-1] += c
        else:
            res.append(c)
    return res


def clean_sub(c):
    c = c.strip().rstrip('，。：；、')
    return c.replace('，', '  ').replace('。', '  ').replace('：', '：')


# ---------------- 画面零件 ----------------
def rounded_mask(w, h, r):
    m = Image.new('L', (w, h), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, h - 1], r, fill=255)
    return m


def make_background(shadow=True):
    bg = Image.new('RGB', (W, H), BG)
    yy, xx = np.mgrid[0:H, 0:W]
    d = np.sqrt(((xx - W / 2) / W) ** 2 + ((yy - H / 2) / H) ** 2)
    a = np.asarray(bg, np.float32) * (1.035 - 0.08 * d[..., None])
    bg = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if not shadow:
        return bg
    sh = Image.new('L', (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle([WX, WY + 12, WX + WW, WY + WH + 12], 22, fill=95)
    sh = sh.filter(ImageFilter.GaussianBlur(22))
    bg.paste((60, 45, 30), (0, 0), sh)
    return bg


def cursor_img(scale=1.35):
    pts = [(0, 0), (0, 29), (7, 23), (12.5, 34.5), (17.5, 32.5), (12.5, 21), (21.5, 21)]
    pts = [(x * scale + 4, y * scale + 4) for x, y in pts]
    im = Image.new('RGBA', (int(34 * scale), int(52 * scale)), (0, 0, 0, 0))
    sh = Image.new('L', im.size, 0)
    ImageDraw.Draw(sh).polygon([(x + 2, y + 3) for x, y in pts], fill=110)
    im.paste((0, 0, 0, 255), (0, 0), sh.filter(ImageFilter.GaussianBlur(2.5)))
    d = ImageDraw.Draw(im)
    d.polygon(pts, fill=(255, 255, 255, 255), outline=(20, 20, 20, 255))
    d.line(pts + [pts[0]], fill=(20, 20, 20, 255), width=2, joint='curve')
    return im


def label_img(text, size=30):
    f = font(size, True)
    tw = int(f.getlength(text))
    pad = 16
    im = Image.new('RGBA', (tw + pad * 2, size + 22 + 12), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, tw + pad * 2 - 1, size + 21], 10, fill=HL + (255,))
    cx = (tw + pad * 2) // 2
    d.polygon([(cx - 10, size + 20), (cx + 10, size + 20), (cx, size + 32)], fill=HL + (255,))
    d.text((pad, 7), text, font=f, fill=(255, 255, 255, 255))
    return im


# ---------------- 场景 ----------------
class Lesson:
    def __init__(self, folder, trial=False):
        self.dir = folder
        self.name = os.path.basename(os.path.normpath(folder))
        self.plan = json.load(open(os.path.join(folder, '画面.json'), encoding='utf-8'))
        self.text = [l.strip() for l in open(os.path.join(folder, '解说词.txt'), encoding='utf-8') if l.strip()]
        self.boxes = json.load(open(os.path.join(folder, '框.json'), encoding='utf-8'))
        assert len(self.plan['行']) == len(self.text), '画面.json 的行数和解说词不一样：%d / %d' % (len(self.plan['行']), len(self.text))
        self.imgs = {}
        self.bg = make_background()
        self.plain = make_background(False)   # 片头、片尾用：没有窗口的影子
        self.wmask = rounded_mask(WW, WH, 16)
        self.cur = cursor_img()
        self.cache = {}
        self.build_audio(trial)
        self.build_scenes()

    def img(self, name):
        if name not in self.imgs:
            self.imgs[name] = Image.open(os.path.join(self.dir, self.boxes[name]['图'])).convert('RGB')
        return self.imgs[name]

    def box(self, img, name):
        b = self.boxes[img]['框'].get(name)
        mix = self.plan.get('拼框', {}).get(img, {}).get(name)   # {"横": 甲, "竖": 乙}：左右照甲、上下照乙（如一整列）
        if not b and mix:
            a, c = self.box(img, mix['横']), self.box(img, mix['竖'])
            b = [a[0], c[1], a[2], c[3]]
        if not b:
            raise SystemExit('框.json 里「%s」没有「%s」' % (img, name))
        return b

    # 配音排上时间线
    def build_audio(self, trial):
        t = self.plan.get('开头', 0.7)
        self.lines = []
        for i, ln in enumerate(self.plan['行']):
            ln = dict(ln)
            ln['_i'] = i
            p = os.path.join(self.dir, '配音_%02d.wav' % (i + 1))
            if trial and not os.path.exists(p):
                n = sum(wt(c) for c in self.text[i])
                x = np.zeros(int(SR * (0.2 + n * 0.21)), np.float32)
                s, e = 0.1, 0.1 + n * 0.21
            else:
                x = read_wav(p)
                s, e = speech_span(x)
            t += ln.get('前停', 0)
            ln['_t0'], ln['_x'] = t, x
            ln['_s'], ln['_e'] = t + s, t + e
            t += len(x) / SR + ln.get('后停', 0.35)
            self.lines.append(ln)
        self.total = t + self.plan.get('结尾', 1.6)
        self.nframes = int(math.ceil(self.total * FPS))
        mix = np.zeros(int(self.total * SR) + SR, np.float32)
        for ln in self.lines:
            a = int(ln['_t0'] * SR)
            mix[a:a + len(ln['_x'])] += ln['_x']
        self.mix = mix

    def add_click(self, t):
        c = click_sound()
        a = int(t * SR)
        self.mix[a:a + len(c)] += c

    # 每句的「场」和「动作」排成一段一段的场景
    def build_scenes(self):
        self.scenes = []
        self.subs = []
        cur = None
        for ln in self.lines:
            text = self.text[ln['_i']]
            sc = ln.get('场')
            if sc and (cur is None or sc != cur['spec']):
                start = 0.0 if cur is None else ln['_t0'] - 0.3
                cur = self.new_scene(sc, start)
            for act in ln.get('动作', []):
                t = anchor(ln, text, act)
                if '换' in act:
                    cur = self.new_scene('图:' + act['换'], t)
                if '看' in act:
                    cur['cam'].append((t, act['看'], act.get('边', 30), act.get('慢', 0.8)))
                if '框' in act:
                    names = act['框'] if isinstance(act['框'], list) else [act['框']]
                    cur['hl'].append((t, names, act.get('标'), act.get('标位', '上')))
                if act.get('清'):
                    cur['hl'].append((t, [], None, None))
                if '点' in act:
                    cur['click'].append((t, act['点']))
                    self.add_click(t)
                if '出' in act:
                    cur['ev'][str(act['出'])] = t
            if ln.get('字幕', True) is not False:
                st = ln.get('字幕') if isinstance(ln.get('字幕'), str) else text
                ch = sub_chunks(st)
                tot = sum(sum(wt(c) for c in x) for x in ch)
                a = ln['_s']
                for x in ch:
                    b = a + (ln['_e'] - ln['_s']) * sum(wt(c) for c in x) / tot
                    self.subs.append((a - 0.08, b + 0.12, clean_sub(x)))
                    a = b
        for i, s in enumerate(self.scenes):
            s['end'] = self.scenes[i + 1]['start'] + 0.36 if i + 1 < len(self.scenes) else self.total + 1
            if s['kind'] == 'img':
                self.prep_camera(s)

    def new_scene(self, spec, start):
        kind, _, arg = spec.partition(':')
        s = {'spec': spec, 'kind': {'图': 'img', '插画': 'art', '片头': 'title', '片尾': 'end'}[kind], 'arg': arg,
             'start': start, 'cam': [], 'hl': [], 'click': [], 'ev': {}}
        if s['kind'] == 'img':
            s['img'] = arg
        self.scenes.append(s)
        return s

    # ---- 相机 ----
    def view_of(self, s, target, margin):
        b = self.boxes[s['img']]
        pw, ph = b['宽'], b['高']
        if target in ('全', '顶'):
            return [0, 0, 1280, 720]
        if target == '底':
            return [0, ph - 720, 1280, 720]
        x, y, w, h = target if isinstance(target, list) else self.box(s['img'], target)
        x, y, w, h = x - margin, y - margin, w + 2 * margin, h + 2 * margin
        vw = max(w, h * 16 / 9, 560)
        vh = vw * 9 / 16
        cx, cy = x + w / 2, y + h / 2
        vx = min(max(cx - vw / 2, 0), max(pw - vw, 0))
        vy = min(max(cy - vh / 2, 0), max(ph - vh, 0))
        if vw > pw:
            vx, vw, vh = 0, pw, pw * 9 / 16
        return [vx, vy, vw, vh]

    def prep_camera(self, s):
        keys = sorted(s['cam'], key=lambda k: k[0])
        first = [0, 0, 1280, 720]
        if keys and keys[0][0] <= s['start'] + 0.35:
            first = self.view_of(s, keys[0][1], keys[0][2])
            keys = keys[1:]
        s['keys'] = []
        prev = first
        for t, tg, m, dur in keys:
            to = self.view_of(s, tg, m)
            s['keys'].append((t, prev, to, dur))
            prev = to
        s['first'] = first

    def camera(self, s, t):
        v = s['first']
        for t0, a, b, dur in s['keys']:
            if t >= t0:
                v = lerp(a, b, ease((t - t0) / dur))
        return v

    # ---- 屏幕里的一张截图（按相机裁好、缩好） ----
    def window_img(self, s, v):
        key = (s['img'], tuple(round(c * 2) / 2 for c in v))
        if key in self.cache:
            return self.cache[key].copy()
        im = self.img(s['img'])
        dpr = self.boxes[s['img']]['倍数']
        x, y, w, h = v
        out = im.resize((WW, WH), Image.BICUBIC, box=(x * dpr, y * dpr, (x + w) * dpr, (y + h) * dpr), reducing_gap=2.0)
        if len(self.cache) > 60:
            self.cache.clear()
        self.cache[key] = out
        return out.copy()

    def to_win(self, v, x, y):
        k = WW / v[2]
        return (x - v[0]) * k, (y - v[1]) * k

    def render_img_scene(self, s, t):
        v = self.camera(s, t)
        win = self.window_img(s, v)
        k = WW / v[2]
        # 框：最近的一条
        hl = [h for h in s['hl'] if h[0] <= t]
        if hl and hl[-1][1]:
            t0, names, lab, pos = hl[-1]
            age = t - t0

            def win_rects(ns, grow=1.0):
                out = []
                for n in ns:
                    x, y, w, h = self.box(s['img'], n)
                    x0, y0 = self.to_win(v, x - 5, y - 5)
                    x1, y1 = self.to_win(v, x + w + 5, y + h + 5)
                    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
                    hw, hh = (x1 - x0) / 2 * grow, (y1 - y0) / 2 * grow
                    out.append((cx - hw, cy - hh, cx + hw, cy + hh))
                return out

            if len(hl) >= 2 and hl[-2][1]:
                # 前面还框着别的：不暗下去再亮，框直接滑过去
                a, m = 1.0, ease(age / 0.28)
                rects, old = win_rects(names), win_rects(hl[-2][1])
                if len(old) != len(rects):
                    old = [(min(r[0] for r in old), min(r[1] for r in old), max(r[2] for r in old), max(r[3] for r in old))] * len(rects)
                rects = [tuple(p + (q - p) * m for p, q in zip(o, r)) for o, r in zip(old, rects)]
            else:
                a = ease(age / 0.3)
                rects = win_rects(names, 1 + 0.10 * (1 - ease(age / 0.35)))
            dim = Image.new('L', (WW, WH), int(105 * a))
            dd = ImageDraw.Draw(dim)
            for r in rects:
                dd.rounded_rectangle(r, 10, fill=0)
            win.paste((20, 14, 8), (0, 0), dim)
            ov = Image.new('RGBA', (WW, WH), (0, 0, 0, 0))
            od = ImageDraw.Draw(ov)
            for r in rects:
                od.rounded_rectangle(r, 10, outline=HL + (int(255 * a),), width=5)
            win.paste(ov, (0, 0), ov)
            if lab:
                li = label_img(lab)
                r = rects[0]
                la = ease((age - 0.15) / 0.3)
                if la > 0:
                    if pos == '下':
                        li = li.transpose(Image.FLIP_TOP_BOTTOM)
                        li2 = label_img(lab)  # 文字要正的：重画一个尖朝上的
                        li = Image.new('RGBA', li2.size, (0, 0, 0, 0))
                        li.paste(li2.crop((0, 0, li2.width, li2.height - 12)), (0, 12))
                        ImageDraw.Draw(li).polygon([(li.width // 2 - 10, 13), (li.width // 2 + 10, 13), (li.width // 2, 1)], fill=HL + (255,))
                        lx, ly = (r[0] + r[2]) / 2 - li.width / 2, r[3] + 4
                    else:
                        lx, ly = (r[0] + r[2]) / 2 - li.width / 2, r[1] - li.height - 2
                    lx = min(max(lx, 8), WW - li.width - 8)
                    ly += (1 - la) * (8 if pos != '下' else -8)
                    if la < 1:
                        al = li.getchannel('A').point(lambda p: int(p * la))
                        li.putalpha(al)
                    win.paste(li, (int(lx), int(ly)), li)
        # 鼠标
        cl = s['click']
        if cl:
            first_t = cl[0][0] - 0.95
            if t >= first_t:
                pos = None
                prev_pt = None
                for i, (tc, bn) in enumerate(cl):
                    x, y, w, h = self.box(s['img'], bn)
                    pt = (x + w * 0.5, y + h * 0.55)
                    if prev_pt is None:
                        prev_pt = (pt[0] + 150, pt[1] + 110)
                    if t <= tc:
                        m = ease((t - (tc - 0.75)) / 0.75)
                        pos = lerp(prev_pt, pt, m)
                        break
                    prev_pt = pt
                    pos = pt
                px, py = self.to_win(v, *pos)
                fa = ease((t - first_t) / 0.25)
                # 点下去的圈
                for tc, bn in cl:
                    if 0 <= t - tc < 0.5:
                        x, y, w, h = self.box(s['img'], bn)
                        cx, cy = self.to_win(v, x + w * 0.5, y + h * 0.55)
                        g = (t - tc) / 0.5
                        rad = 12 + 36 * g
                        ov = Image.new('RGBA', (WW, WH), (0, 0, 0, 0))
                        ImageDraw.Draw(ov).ellipse([cx - rad, cy - rad, cx + rad, cy + rad], outline=HL + (int(230 * (1 - g)),), width=5)
                        win.paste(ov, (0, 0), ov)
                c = self.cur
                if fa < 1:
                    c = c.copy()
                    c.putalpha(c.getchannel('A').point(lambda p: int(p * fa)))
                press = any(0 <= t - tc < 0.12 for tc, _ in cl)
                if press:
                    c = c.resize((int(c.width * 0.9), int(c.height * 0.9)))
                win.paste(c, (int(px - 4), int(py - 4)), c)
        return win

    # ---- 插画：在 Claude 里说一句 ----
    def render_claude(self, s, t):
        win = Image.new('RGB', (WW, WH), (250, 249, 245))
        d = ImageDraw.Draw(win)
        cw = 600
        d.rectangle([0, 0, cw, WH], fill=(244, 241, 234))
        d.line([cw, 0, cw, WH], fill=(222, 214, 200), width=2)
        d.rounded_rectangle([28, 26, 72, 70], 10, fill=(204, 120, 92))
        d.text((88, 30), 'Claude', font=font(30, True), fill=INK)
        d.text((28, 100), '你在这里跟 AI 说话', font=font(24), fill=SUB)
        # 输入框
        d.rounded_rectangle([24, WH - 120, cw - 24, WH - 30], 16, fill=(255, 255, 255), outline=(214, 205, 190), width=2)
        tb = s['ev'].get('气泡', s['start'] + 1.5)
        msg = '打开项目管理'
        typed = int(min(len(msg), max(0, (t - (tb - 1.1)) / 0.13)))
        if t < tb:
            d.text((48, WH - 92), msg[:typed] + ('|' if int(t * 3) % 2 == 0 else ''), font=font(32), fill=INK)
        else:
            a = ease((t - tb) / 0.3)
            f = font(36, True)
            bw = int(f.getlength(msg)) + 48
            bx, by = cw - 30 - bw, 180 + (1 - a) * 30
            d.rounded_rectangle([bx, by, bx + bw, by + 74], 22, fill=(234, 227, 213))
            d.text((bx + 24, by + 13), msg, font=f, fill=INK)
            d.text((48, WH - 92), '说一句就行', font=font(28), fill=(170, 160, 145))
        # 右栏滑进来
        tr = s['ev'].get('右栏', tb + 1.2)
        a = ease((t - tr) / 0.6)
        if a > 0:
            pane = Image.new('RGB', (WW - cw - 2, WH), (236, 231, 221))
            home = self.img('首页')
            dpr = self.boxes['首页']['倍数']
            pw = WW - cw - 2 - 60
            ph = int(pw * 720 / 1280)
            shot = home.resize((pw, ph), Image.BICUBIC, box=(0, 0, 1280 * dpr, 720 * dpr), reducing_gap=2.0)
            pane.paste(shot, (30, (WH - ph) // 2 + 20))
            pd = ImageDraw.Draw(pane)
            pd.rectangle([30, (WH - ph) // 2 + 20, 30 + pw - 1, (WH - ph) // 2 + 20 + ph - 1], outline=(200, 190, 172), width=2)
            pd.text((30, (WH - ph) // 2 - 40), '右边：流水线', font=font(34, True), fill=HL)
            x = int(cw + 2 + (1 - a) * (WW - cw))
            win.paste(pane, (x, 0))
        return win

    # ---- 插画：在浏览器里开网址 ----
    def render_browser(self, s, t):
        win = Image.new('RGB', (WW, WH), (255, 255, 255))
        d = ImageDraw.Draw(win)
        d.rectangle([0, 0, WW, 54], fill=(222, 225, 230))
        d.rounded_rectangle([18, 10, 380, 60], 12, fill=(255, 255, 255))
        d.text((44, 18), '流水线 · 总览', font=font(24), fill=INK)
        d.rectangle([0, 54, WW, 124], fill=(255, 255, 255))
        d.line([0, 124, WW, 124], fill=(218, 218, 218), width=2)
        for i, ch in enumerate('←→⟳'):
            d.text((24 + i * 52, 66), ch, font=font(34), fill=(120, 120, 120))
        fx0, fx1 = 190, WW - 40
        d.rounded_rectangle([fx0, 66, fx1, 114], 24, fill=(241, 243, 244))
        url = 'localhost:8766'
        tu = s['ev'].get('网址', s['start'] + 0.8)
        typed = int(min(len(url), max(0, (t - tu) / 0.07)))
        tx = url[:typed]
        f = font(30)
        d.text((fx0 + 30, 72), tx, font=f, fill=INK)
        if typed < len(url) and int(t * 3) % 2 == 0:
            cx = fx0 + 30 + f.getlength(tx)
            d.line([cx + 2, 76, cx + 2, 106], fill=INK, width=2)
        # 星：存书签
        sx, sy = fx1 - 44, 90
        ts = s['ev'].get('星', 1e9)
        st = ease((t - ts) / 0.3)
        r1, r2 = 16, 7
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            r = r1 if i % 2 == 0 else r2
            pts.append((sx + r * math.cos(ang), sy + r * math.sin(ang)))
        d.polygon(pts, fill=HL if st > 0.5 else None, outline=HL if st > 0 else (120, 120, 120), width=2)
        # 内容：网址打完才出来
        if typed >= len(url):
            a = ease((t - (tu + len(url) * 0.07 + 0.25)) / 0.4)
            home = self.img('首页')
            dpr = self.boxes['首页']['倍数']
            ch = WH - 126
            shot = home.resize((WW, ch), Image.BICUBIC, box=(0, 0, 1280 * dpr, ch * 1280 / WW * dpr), reducing_gap=2.0)
            if a < 1:
                shot = Image.blend(Image.new('RGB', shot.size, (255, 255, 255)), shot, a)
            win.paste(shot, (0, 126))
        if st > 0:
            ov = Image.new('RGBA', (WW, WH), (0, 0, 0, 0))
            od = ImageDraw.Draw(ov)
            od.rounded_rectangle([fx0 - 8, 58, fx1 + 8, 122], 30, outline=HL + (int(255 * st),), width=5)
            win.paste(ov, (0, 0), ov)
            li = label_img('存成书签')
            li2 = Image.new('RGBA', li.size, (0, 0, 0, 0))
            li2.paste(li.crop((0, 0, li.width, li.height - 12)), (0, 12))
            ImageDraw.Draw(li2).polygon([(li2.width - 40, 13), (li2.width - 20, 13), (li2.width - 30, 1)], fill=HL + (255,))
            win.paste(li2, (int(fx1 - li2.width + 6), int(132 + (1 - st) * 10)), li2)
        return win

    # ---- 片头 ----
    def render_title(self, s, t):
        fr = self.plain.copy()
        d = ImageDraw.Draw(fr)
        a = ease((t - s['start'] - 0.1) / 0.6)
        plan = self.plan
        dy = (1 - a) * 24
        # 印章
        d.rounded_rectangle([W / 2 - 46, 250 + dy, W / 2 + 46, 342 + dy], 14, fill=SEAL)
        d.text((W / 2, 296 + dy), '案', font=font(58, True), fill=(255, 255, 255), anchor='mm')
        d.text((W / 2, 420 + dy), plan.get('系列', '流水线教程') + '  ·  ' + plan['课'], font=font(40), fill=SUB, anchor='mm')
        d.text((W / 2, 530 + dy), plan['标题'], font=font(96, True), fill=INK, anchor='mm')
        d.line([W / 2 - 60, 620 + dy, W / 2 + 60, 620 + dy], fill=SEAL, width=4)
        if plan.get('副标题'):
            d.text((W / 2, 680 + dy), plan['副标题'], font=font(36), fill=SUB, anchor='mm')
        if a < 1:
            fr = Image.blend(self.plain, fr, a)
        return fr

    # ---- 片尾：记住三句 ----
    def render_end(self, s, t):
        fr = self.plain.copy()
        d = ImageDraw.Draw(fr)
        a = ease((t - s['start']) / 0.5)
        home = self.img('首页')
        dpr = self.boxes['首页']['倍数']
        tw, th = 900, int(900 * 949 / 1280)
        thumb = home.resize((tw, th), Image.BICUBIC, box=(0, 0, 1280 * dpr, 949 * dpr), reducing_gap=2.0)
        tx, ty = 110, (H - th) // 2 - 10
        sh = Image.new('L', (W, H), 0)
        ImageDraw.Draw(sh).rounded_rectangle([tx, ty + 10, tx + tw, ty + th + 10], 16, fill=90)
        fr.paste((60, 45, 30), (0, 0), sh.filter(ImageFilter.GaussianBlur(16)))
        fr.paste(thumb, (tx, ty), rounded_mask(tw, th, 14))
        d = ImageDraw.Draw(fr)
        k = tw / 1280
        items = self.plan.get('三句', [])
        d.text((1090, 210), self.plan.get('三句标题', '记住三句话'), font=font(56, True), fill=INK)
        for i, it in enumerate(items):
            te = s['ev'].get(str(i + 1), s['start'] + 1 + i)
            ia = ease((t - te) / 0.35)
            if ia <= 0:
                continue
            col = tuple(int(BG[j] + (HL[j] - BG[j]) * ia) for j in range(3))
            x, y, w, h = self.box('首页', it['框'])
            r = [tx + (x - 6) * k, ty + (y - 6) * k, tx + (x + w + 6) * k, ty + (y + h + 6) * k]
            d.rounded_rectangle(r, 8, outline=col, width=4)
            cx, cy = r[0] - 4, r[1] - 4
            d.ellipse([cx - 20, cy - 20, cx + 20, cy + 20], fill=col)
            d.text((cx, cy), str(i + 1), font=font(26, True), fill=(255, 255, 255), anchor='mm')
            yy = 330 + i * 120 + (1 - ia) * 14
            d.ellipse([1090, yy, 1146, yy + 56], fill=col)
            d.text((1118, yy + 28), str(i + 1), font=font(32, True), fill=(255, 255, 255), anchor='mm')
            txt_col = tuple(int(BG[j] + (INK[j] - BG[j]) * ia) for j in range(3))
            d.text((1170, yy + 2), it['字'], font=font(46, True), fill=txt_col)
        tn = s['ev'].get('下一课', 1e9)
        na = ease((t - tn) / 0.4)
        if na > 0 and self.plan.get('下一课'):
            col = tuple(int(BG[j] + (SUB[j] - BG[j]) * na) for j in range(3))
            d.text((1092, 720), '下一课：' + self.plan['下一课'], font=font(38), fill=col)
        if a < 1:
            fr = Image.blend(self.plain, fr, a)
        return fr

    def render_scene(self, s, t):
        if s['kind'] == 'title':
            return self.render_title(s, t)
        if s['kind'] == 'end':
            return self.render_end(s, t)
        win = self.render_img_scene(s, t) if s['kind'] == 'img' else self.render_claude(s, t) if s['arg'] == 'Claude' else self.render_browser(s, t)
        fr = self.bg.copy()
        fr.paste(win, (WX, WY), self.wmask)
        return fr

    def frame(self, t):
        act = [s for s in self.scenes if s['start'] <= t < s['end']]
        if not act:
            act = [self.scenes[-1]]
        cur = act[-1]
        fr = self.render_scene(cur, t)
        if len(act) > 1 and t - cur['start'] < 0.36:
            prev = self.render_scene(act[-2], t)
            fr = Image.blend(prev, fr, ease((t - cur['start']) / 0.36))
        # 字幕
        for a, b, txt in self.subs:
            if a <= t < b and txt:
                al = min(ease((t - a) / 0.12), ease((b - t) / 0.12))
                d = ImageDraw.Draw(fr)
                col = tuple(int(BG[j] + (INK[j] - BG[j]) * al) for j in range(3))
                d.text((W / 2, WY + WH + (H - WY - WH) / 2 + 2), txt, font=font(46, True), fill=col, anchor='mm')
                break
        # 收尾淡出
        if t > self.total - 0.5:
            fr = Image.blend(fr, self.plain, ease((t - (self.total - 0.5)) / 0.5))
        return fr

    def write(self, out, only=None):
        wav = os.path.join(self.dir, '配音.wav')
        m = np.clip(self.mix, -1, 1)
        with wave.open(wav, 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes((m * 32767).astype(np.int16).tobytes())
        cmd = [FF, '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '%dx%d' % (W, H), '-r', str(FPS), '-i', '-',
               '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'h264_nvenc', '-preset', 'p6', '-rc', 'vbr', '-cq', '24', '-b:v', '0', '-maxrate', '8M', '-bufsize', '16M', '-pix_fmt', 'yuv420p',
               '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out]
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        frames = range(self.nframes) if only is None else only
        for i in frames:
            p.stdin.write(self.frame(i / FPS).tobytes())
            if i % 300 == 0:
                print('  第 %d / %d 帧' % (i, self.nframes), flush=True)
        p.stdin.close()
        p.wait()
        return p.returncode


def main():
    folder = sys.argv[1]
    trial = '--试' in sys.argv
    L = Lesson(folder, trial)
    peek = [a for a in sys.argv[2:] if a.startswith('--看=')]
    if peek:   # --看=3.5,10,20：只出这几秒的单帧图，核画面用
        for x in peek[0].split('=', 1)[1].split(','):
            L.frame(float(x)).save(os.path.join(folder, '核对_%ss.png' % x))
        print('出了核对图')
        return
    out = os.path.join(folder, L.name + ('_试看' if trial else '') + '.mp4')
    print('总长 %.1f 秒，%d 帧 → %s' % (L.total, L.nframes, out))
    rc = L.write(out)
    print('好了' if rc == 0 else 'ffmpeg 出错 %s' % rc)


if __name__ == '__main__':
    main()
