# -*- coding: utf-8 -*-
"""用 VoxCPM2 照「声音参考.wav」的音色念一课的解说词，一句一个文件。
用法（要用 VoxCPM2 自己的 Python）：
    D:/Apps/VoxCPM2/venv/Scripts/python.exe 配音.py <课的文件夹> [第几句 ...]
        不写第几句就全念；写了只重念这几句（如 3 7），重念的不如原来像就留原来的。
        加 --几遍=6 每句多念几遍（默认看设置里的「每句试几次」）。
出：<课的文件夹>/配音_NN.wav（48k 单声道）和 配音_记录.json（每句念了几遍、挑了哪遍、多快、多像）。

怎么念（设置在旁边的 配音设置.json）：
    参考录音加原话接着念（最像本人，但语速也照抄，原声一秒约 9 个字）。
    每句念几遍：语速不在「原速字每秒」范围里的扔掉（念漏、念多），剩下的用声纹打分（CAM++），挑最像本人的一遍；
    再用 ffmpeg 放慢一点（最多放慢到「最多放慢到」，放多了不像），标点处的停顿拉长到「停顿」写的秒数。
    别在句子前加「(语速放慢…)」这类括号：接着念的模式会把括号里的字当台词念出来（11-15 第 8 句开头多念了约 2 秒）。
加载模型在 Windows 上偶尔闪退，外面这一层会自动重来（最多 3 回），已经念好的句子不重念。
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
MODEL = 'D:/Apps/VoxCPM2/models/VoxCPM2'
FF = sorted(glob.glob('D:/Apps/JianyingPro/*/ffmpeg.exe'))[-1]


def zh_count(t):
    return sum(1 for c in t if '\u4e00' <= c <= '\u9fff') + 0.5 * sum(1 for c in t if c.isascii() and c.isalpha())


def trim(x, sr):
    import numpy as np
    hop = sr // 100
    n = len(x) // hop
    db = 20 * np.log10(np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
    on = np.where(db > -42)[0]
    if not len(on):
        return x
    a = max(0, on[0] * hop - int(sr * 0.05))
    b = min(len(x), (on[-1] + 1) * hop + int(sr * 0.10))
    return x[a:b]


def level(x, sr):
    import numpy as np
    hop = sr // 100
    n = len(x) // hop
    r = np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1))
    sp = r[r > 10 ** (-40 / 20)]
    if len(sp):
        x = x * (10 ** (-19 / 20) / np.sqrt((sp ** 2).mean()))
    pk = abs(x).max()
    if pk > 0.89:
        x = x * (0.89 / pk)
    return x


def tempo(x, sr, k, d):
    import soundfile as sf
    if abs(k - 1) < 1e-3:
        return x
    a, b = os.path.join(d, 't_a.wav'), os.path.join(d, 't_b.wav')
    sf.write(a, x, sr, subtype='PCM_16')
    subprocess.run([FF, '-hide_banner', '-loglevel', 'error', '-y', '-i', a, '-filter:a', 'atempo=%.3f' % k, b], check=True)
    y, _ = sf.read(b, dtype='float32')
    return y


PUNCT = '、，,。：:！!？?；;'
HOW = '放慢的参考录音接着念，拉长停顿'


def stretch_pauses(x, sr, text, want):
    """标点处的停顿拉长一点（原声念得快，句中几乎不停）。
    按字数估每个标点大概在第几秒，在附近找一段静音，不够长就在中间补静音。"""
    import numpy as np
    want = dict({'、': 0.10, '，': 0.22, '。': 0.38}, **want)
    hop = sr // 100
    n = len(x) // hop
    db = 20 * np.log10(np.sqrt((x[:n * hop].reshape(n, hop) ** 2).mean(1)) + 1e-9)
    sil = db < np.percentile(db, 90) - 32
    on = np.where(~sil)[0]
    if len(on) < 2:
        return x, []
    a0, a1 = int(on[0]), int(on[-1])
    runs, i = [], a0
    while i <= a1:
        if sil[i]:
            j = i
            while j <= a1 and sil[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    marks, tot = [], 0.0
    for ch in text.rstrip(PUNCT + '… '):
        if ch in PUNCT:
            marks.append((tot, ch))
        elif '一' <= ch <= '鿿':
            tot += 1
        elif ch.isalnum():
            tot += 0.5
    if not marks or not tot:
        return x, []
    span, used, plan = a1 - a0, set(), []
    for pos, ch in marks:
        e = a0 + span * pos / tot
        pick = None
        for r, (s, t) in enumerate(runs):
            dist = abs((s + t) / 2 - e) / span
            if r in used or t - s < 4 or dist > 0.15:
                continue
            score = (t - s) - 60 * dist
            if pick is None or score > pick[0]:
                pick = (score, r)
        kind = '、' if ch == '、' else ('，' if ch in '，,' else '。')
        if pick is None:
            plan.append({'标点': ch, '在': None, '原有': 0, '加': 0})
            continue
        used.add(pick[1])
        s, t = runs[pick[1]]
        have = (t - s) / 100
        plan.append({'标点': ch, '在': round((s + t) / 200, 2), '原有': round(have, 2),
                     '加': round(max(0.0, want[kind] - have), 2), '_m': (s + t) // 2 * hop})
    y = x
    for p in sorted([p for p in plan if p['加'] > 0], key=lambda p: -p['_m']):
        y = np.concatenate([y[:p['_m']], np.zeros(int(p['加'] * sr), np.float32), y[p['_m']:]])
    for p in plan:
        p.pop('_m', None)
    return y, plan


def load_tts():
    """装模型。自带的装法把 4.6GB 权重整个映射进内存，电脑上程序一多就报「页面文件太小」；
    这里先在显卡上搭个没有权重的架子，再把权重一块一块读进显卡。"""
    import struct
    import torch
    import voxcpm.model.voxcpm2 as vm
    from voxcpm import VoxCPM
    orig = vm.load_file
    vm.load_file = lambda p, device='cpu': {} if os.path.basename(p) == 'model.safetensors' else orig(p, device=device)
    # 架子直接按 bf16 搭在显卡上：自带的是先在内存里按 fp32 搭（约 9GB）再转，内存紧时会闪退。
    # 搭的时候算出来的固定数（旋转位置编码）代码里写死了 fp32，最后照样转成 bf16，结果和自带的一样。
    torch.set_default_dtype(torch.bfloat16)
    try:
        with torch.device('cuda'):
            model = VoxCPM.from_pretrained(MODEL, load_denoiser=False, optimize=False)   # optimize 要 torch.compile，Windows 上没有
    finally:
        vm.load_file = orig
        torch.set_default_dtype(torch.float32)
    dt = {'BF16': torch.bfloat16, 'F16': torch.float16, 'F32': torch.float32, 'F64': torch.float64,
          'I64': torch.int64, 'I32': torch.int32, 'I16': torch.int16, 'I8': torch.int8, 'U8': torch.uint8, 'BOOL': torch.bool}
    sd = model.tts_model.state_dict()
    got = 0
    with open(os.path.join(MODEL, 'model.safetensors'), 'rb') as f, torch.no_grad():
        n = struct.unpack('<Q', f.read(8))[0]
        hdr = json.loads(f.read(n))
        for k, v in hdr.items():
            a, b = v['data_offsets'] if k != '__metadata__' else (0, 0)
            if k not in sd or b <= a:
                continue
            f.seek(8 + n + a)
            buf = bytearray(b - a)
            f.readinto(buf)
            sd[k].copy_(torch.frombuffer(buf, dtype=dt[v['dtype']]).reshape(v['shape']))
            got += 1
    left = [k for k in sd if k not in hdr and not k.startswith('audio_vae.')]
    print('权重读进 %d 块，模型里没对上的 %d 块 %s' % (got, len(left), left[:5]), file=sys.stderr, flush=True)
    if got == 0:
        raise RuntimeError('权重一块也没读进去')
    torch.cuda.empty_cache()
    return model


def worker(folder, only, tries_arg=None):
    import numpy as np
    import soundfile as sf
    import librosa
    cfg = json.load(open(os.path.join(ROOT, '配音设置.json'), encoding='utf-8'))
    lines = [l.strip() for l in open(os.path.join(folder, '解说词.txt'), encoding='utf-8') if l.strip()]
    ref = os.path.join(ROOT, '声音参考.wav')
    ref_text = [l for l in open(os.path.join(ROOT, '声音参考.txt'), encoding='utf-8').read().strip().split('\n') if l.strip()][-1].strip()
    lo, hi = cfg.get('原速字每秒', [5.0, 11.0])
    goal = cfg.get('目标字每秒', 6.2)
    slow_min = cfg.get('最多放慢到', 0.85)
    tries = tries_arg or cfg.get('每句试几次', 3)
    rec_path = os.path.join(folder, '配音_记录.json')
    rec = json.load(open(rec_path, encoding='utf-8')) if os.path.exists(rec_path) else {}

    model = load_tts()
    from modelscope.pipelines import pipeline
    sv = pipeline(task='speaker-verification', model='iic/speech_campplus_sv_zh-cn_16k-common', model_revision='v1.0.0')
    sr = model.tts_model.sample_rate
    d = tempfile.mkdtemp(prefix='tut-tts-')
    import atexit, shutil
    atexit.register(shutil.rmtree, d, True)   # 念完把临时文件删掉

    def as16(x, name):
        p = os.path.join(d, name + '.wav')
        sf.write(p, librosa.resample(x, orig_sr=sr, target_sr=16000) if sr != 16000 else x, 16000, subtype='PCM_16')
        return p

    r0, rsr = sf.read(ref, dtype='float32')
    ref16 = os.path.join(d, 'ref.wav')
    sf.write(ref16, librosa.resample(r0, orig_sr=rsr, target_sr=16000), 16000, subtype='PCM_16')

    prompt = ref   # 接着念的那段：放慢过的参考录音，模型就照慢的节奏念；音色还认原声（reference_wav）
    if cfg.get('参考放慢', 1.0) < 1.0:
        prompt = os.path.join(d, 'prompt_slow.wav')
        sf.write(prompt, tempo(r0, rsr, cfg['参考放慢'], d), rsr, subtype='PCM_16')

    def say(text):
        x = model.generate(text=text, prompt_wav_path=prompt, prompt_text=ref_text, reference_wav_path=ref,
                           cfg_value=cfg.get('cfg', 2.0), inference_timesteps=cfg.get('步数', 10))
        return trim(np.asarray(x, np.float32).reshape(-1), sr)

    for i, text in enumerate(lines, 1):
        out = os.path.join(folder, '配音_%02d.wav' % i)
        if only and i not in only:
            continue
        if not only and os.path.exists(out) and rec.get(str(i), {}).get('字') == text and rec[str(i)].get('做法') == HOW:
            continue   # 上一回念好了（闪退重来时跳过）
        n = zh_count(text)
        best, log = None, []
        for k in range(tries):
            x = say(text)
            rate = n / (len(x) / sr)
            ok = lo <= rate <= hi
            s = float(sv([ref16, as16(x, 'c')])['score']) if ok else 0.0
            log.append({'遍': k + 1, '字每秒': round(rate, 1), '像': round(s, 3), '用得上': ok})
            if ok and (best is None or s > best[1]):
                best = (x, s, rate)
            if best and best[1] >= 0.82 and sum(1 for g in log if g['用得上']) >= 2:
                break
        if best is None:
            print('第%02d句 念不好，跳过：%s' % (i, text), flush=True)
            continue
        x, s0, rate = best
        k = max(slow_min, min(1.0, goal / rate))
        x = tempo(x, sr, k, d)
        x, pauses = stretch_pauses(x, sr, text, cfg.get('停顿', {}))
        x = level(x, sr)
        s1 = float(sv([ref16, as16(x, 'c')])['score'])
        was = rec.get(str(i), {})
        if os.path.exists(out) and was.get('字') == text and was.get('做法') == HOW and was.get('像', 0) >= s1:
            print('第%02d句  这回最好的 %.2f 不如原来的 %.2f，留原来的' % (i, s1, was['像']), flush=True)
            continue
        sf.write(out, x, sr, subtype='PCM_16')
        rec[str(i)] = {'字': text, '做法': HOW, '秒': round(len(x) / sr, 2), '字每秒': round(n / (len(x) / sr), 1), '像': round(s1, 3),
                       '原速像': round(s0, 3), '原速字每秒': round(rate, 1), '放慢到': round(k, 2), '停顿': pauses, '几遍': log}
        json.dump(rec, open(rec_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('第%02d句  %.1f 秒  一秒 %.1f 字  像 %.2f（原速 %.2f）  念了 %d 遍  拉长停顿 %d 处  %s' % (
            i, len(x) / sr, n / (len(x) / sr), s1, s0, len(log), sum(1 for p in pauses if p['加'] > 0), text), flush=True)


def main():
    if '--worker' in sys.argv:
        args = [a for a in sys.argv[1:] if a != '--worker']
        worker(args[0], [int(x) for x in args[1:] if x.isdigit()], next((int(a.split('=', 1)[1]) for a in args if a.startswith('--几遍=')), None))
        return
    for k in range(3):
        rc = subprocess.call([sys.executable, os.path.abspath(__file__), '--worker'] + sys.argv[1:], env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        if rc == 0:
            return
        print('（模型闪退了，第 %d 回重来）' % (k + 1), flush=True)
    sys.exit(1)


if __name__ == '__main__':
    main()
