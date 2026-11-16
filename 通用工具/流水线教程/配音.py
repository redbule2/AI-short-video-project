# -*- coding: utf-8 -*-
"""照「声音参考.wav」的音色念一课的解说词，一句一个文件。
用法（用哪个 Python 起都行，外面这层会换成引擎自己的 Python）：
    python 配音.py <课的文件夹> [第几句 ...] [--几遍=6] [--引擎=IndexTTS2.5]
        不写第几句就全念；写了只重念这几句（如 3 7），重念的不如原来像就留原来的。
        --几遍=N 每句念 N 遍挑最像的（默认看设置里的「每句试几次」）；--引擎 不写就照设置里的「引擎」。
出：<课的文件夹>/配音_NN.wav（48k 单声道）和 配音_记录.json（每句用的引擎、念了几遍、挑了哪遍、多快、多像）。

两个引擎，设置在旁边的 配音设置.json（公共的写在外面，各引擎自己的写在同名那一栏里）：
  IndexTTS2.5（D:/Apps/IndexTTS，11-15 起默认）：原声直接当参考；语速靠模型自己放慢（「时长倍数」，
      每念一遍按离「目标字每秒」差多少自动调下一遍），不用事后拉。
  VoxCPM2（D:/Apps/VoxCPM2，第 1 课用的，用户嫌不像）：参考录音加原话接着念，语速也照抄（原声一秒约 9 个字），
      所以把参考录音放慢了当开头（「参考放慢」），念完再放慢一点、拉长标点处的停顿。
      别在句子前加「(语速放慢…)」这类括号：接着念的模式会把括号里的字当台词念出来。
每句念几遍：快慢不在「原速字每秒」范围里的扔掉（念漏、念多），剩下的用声纹打分（CAM++），挑最像本人的一遍。
加载模型在 Windows 上偶尔闪退，外面这一层会自动重来（最多 3 回），已经念好的句子不重念。
"""
import glob
import json
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.abspath(__file__))
FF = sorted(glob.glob('D:/Apps/JianyingPro/*/ffmpeg.exe'))[-1]
PY = {'IndexTTS2.5': 'D:/Apps/IndexTTS/venv/Scripts/python.exe', 'VoxCPM2': 'D:/Apps/VoxCPM2/venv/Scripts/python.exe'}
VOX = 'D:/Apps/VoxCPM2/models/VoxCPM2'
IDX = 'D:/Apps/IndexTTS/index-tts'
HOW = {'VoxCPM2': '放慢的参考录音接着念，拉长停顿', 'IndexTTS2.5': 'IndexTTS2.5 原声参考，模型里放慢'}
OUT_SR = 48000


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


def load_vox():
    """装 VoxCPM2。自带的装法把 4.6GB 权重整个映射进内存，电脑上程序一多就报「页面文件太小」；
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
            model = VoxCPM.from_pretrained(VOX, load_denoiser=False, optimize=False)   # optimize 要 torch.compile，Windows 上没有
    finally:
        vm.load_file = orig
        torch.set_default_dtype(torch.float32)
    dt = {'BF16': torch.bfloat16, 'F16': torch.float16, 'F32': torch.float32, 'F64': torch.float64,
          'I64': torch.int64, 'I32': torch.int32, 'I16': torch.int16, 'I8': torch.int8, 'U8': torch.uint8, 'BOOL': torch.bool}
    sd = model.tts_model.state_dict()
    got = 0
    with open(os.path.join(VOX, 'model.safetensors'), 'rb') as f, torch.no_grad():
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


def load_index():
    """装 IndexTTS2.5。它按「当前文件夹/checkpoints/hf_cache」找辅助模型，所以先进它的文件夹。"""
    os.chdir(IDX)
    from indextts.infer_v2_5 import IndexTTS2
    ck = os.path.join(IDX, 'checkpoints')
    return IndexTTS2(cfg_path=os.path.join(ck, 'config.yaml'), model_dir=ck, use_bf16=True, use_cuda_kernel=False)


def index_scorer(tts):
    """用 IndexTTS 里自带的 CAM++（和 modelscope 那个同一份权重、同样的特征）给两段 16k 录音的音色打分。"""
    import torch
    import torchaudio

    def emb(x16):
        t = torch.from_numpy(x16).float().unsqueeze(0)
        feat = torchaudio.compliance.kaldi.fbank(t * 32768, num_mel_bins=80, dither=0, sample_frequency=16000)
        feat = feat - feat.mean(dim=0, keepdim=True)
        with torch.no_grad():
            e = tts.campplus_model(feat.unsqueeze(0).to(tts.device)).float()
        return torch.nn.functional.normalize(e, dim=-1)

    return lambda a, b: float((emb(a) * emb(b)).sum())


def worker(folder, only, tries_arg, engine):
    import atexit
    import shutil
    import numpy as np
    import soundfile as sf
    import librosa
    folder = os.path.abspath(folder)
    allcfg = json.load(open(os.path.join(ROOT, '配音设置.json'), encoding='utf-8'))
    cfg = {k: v for k, v in allcfg.items() if not isinstance(v, dict) or k == '停顿'}
    cfg.update(allcfg.get(engine, {}))
    lines = [l.strip() for l in open(os.path.join(folder, '解说词.txt'), encoding='utf-8') if l.strip()]
    ref = os.path.join(ROOT, '声音参考.wav')
    ref_text = [l for l in open(os.path.join(ROOT, '声音参考.txt'), encoding='utf-8').read().strip().split('\n') if l.strip()][-1].strip()
    lo, hi = cfg.get('原速字每秒', [3.5, 11.0])
    goal = cfg.get('目标字每秒', 6.0)
    slow_min = cfg.get('最多放慢到', 0.85)
    tries = tries_arg or cfg.get('每句试几次', 3)
    how = HOW[engine]
    rec_path = os.path.join(folder, '配音_记录.json')
    rec = json.load(open(rec_path, encoding='utf-8')) if os.path.exists(rec_path) else {}
    d = tempfile.mkdtemp(prefix='tut-tts-')
    atexit.register(shutil.rmtree, d, True)   # 念完把临时文件删掉

    r0, rsr = sf.read(ref, dtype='float32')
    if r0.ndim > 1:
        r0 = r0.mean(1)
    ref16 = librosa.resample(r0, orig_sr=rsr, target_sr=16000)

    if engine == 'IndexTTS2.5':
        tts = load_index()
        sim = index_scorer(tts)
        marks = cfg.get('读音', {})   # 多音字标读音，如 "一行一": "一<行|HANG2>一"（IndexTTS2.5 认 <字|拼音声调>）

        def spoken(text):
            for a, b in marks.items():
                text = text.replace(a, b)
            return text

        fac = [cfg.get('时长倍数', 1.0)]
        fmin, fmax = cfg.get('时长倍数范围', [0.8, 1.8])

        def say(text):
            f = fac[0]
            got = tts.infer(spk_audio_prompt=ref, text=spoken(text), output_path=None, lang='ZH', duration_factor=f, verbose=False)
            osr, w = got
            x = trim(np.asarray(w, np.float32).reshape(-1) / 32768, osr)
            x = librosa.resample(x, orig_sr=osr, target_sr=OUT_SR)   # 22.05k 正经重采样到 48k，合成时就不用线性插值
            rate = zh_count(text) / (len(x) / OUT_SR)
            fac[0] = round(min(fmax, max(fmin, f * (rate / goal) ** 0.7)), 3)   # 下一遍照这遍的快慢调（每遍快慢本来就有出入，只调七成）
            return x, f
    else:
        model = load_vox()

        def spoken(text):
            return text
        from modelscope.pipelines import pipeline
        sv = pipeline(task='speaker-verification', model='iic/speech_campplus_sv_zh-cn_16k-common', model_revision='v1.0.0')
        vsr = model.tts_model.sample_rate
        p_ref16 = os.path.join(d, 'ref16.wav')
        sf.write(p_ref16, ref16, 16000, subtype='PCM_16')

        def sim(a, b):
            pb = os.path.join(d, 'c16.wav')
            sf.write(pb, b, 16000, subtype='PCM_16')
            return float(sv([p_ref16, pb])['score'])

        prompt = ref   # 接着念的那段：放慢过的参考录音，模型就照慢的节奏念；音色还认原声（reference_wav）
        if cfg.get('参考放慢', 1.0) < 1.0:
            prompt = os.path.join(d, 'prompt_slow.wav')
            sf.write(prompt, tempo(r0, rsr, cfg['参考放慢'], d), rsr, subtype='PCM_16')

        def say(text):
            x = model.generate(text=text, prompt_wav_path=prompt, prompt_text=ref_text, reference_wav_path=ref,
                               cfg_value=cfg.get('cfg', 2.0), inference_timesteps=cfg.get('步数', 10))
            x = trim(np.asarray(x, np.float32).reshape(-1), vsr)
            return (librosa.resample(x, orig_sr=vsr, target_sr=OUT_SR) if vsr != OUT_SR else x), None

    def score(x):
        return sim(ref16, librosa.resample(x, orig_sr=OUT_SR, target_sr=16000))

    sr = OUT_SR
    for i, text in enumerate(lines, 1):
        out = os.path.join(folder, '配音_%02d.wav' % i)
        if only and i not in only:
            continue
        said = spoken(text)
        if (not only and os.path.exists(out) and rec.get(str(i), {}).get('字') == text and rec[str(i)].get('做法') == how
                and rec[str(i)].get('念的字', text) == said):
            continue   # 上一回念好了（闪退重来时跳过）
        n = zh_count(text)
        takes, log = [], []
        for k in range(tries + cfg.get('不够再试', 0)):   # 念够「每句试几次」；一遍都不在范围里的，再多试「不够再试」遍
            x, f = say(text)
            rate = n / (len(x) / sr)
            ok = lo <= rate <= hi
            s = score(x) if ok else 0.0
            g = {'遍': k + 1, '字每秒': round(rate, 1), '像': round(s, 3), '用得上': ok}
            if f is not None:
                g['时长倍数'] = f
            log.append(g)
            takes.append((x, s, rate, ok))
            good = [t for t in takes if t[3]]
            if good and (k + 1 >= tries or (max(t[1] for t in good) >= cfg.get('够像就停', 0.82) and len(good) >= 2)):
                break
        good = [t for t in takes if t[3]]
        if good:
            x, s0, rate, _ = max(good, key=lambda t: t[1])
        else:   # 一遍都不在范围里：挑快慢离目标最近的，下面再变速往回拉一点
            x, s0, rate, _ = min(takes, key=lambda t: abs(t[2] - goal))
            if abs(rate - goal) / goal > 0.35:
                print('第%02d句 念不好（一秒 %.1f 字），跳过：%s' % (i, rate, text), flush=True)
                continue
            s0 = score(x)
        k = max(slow_min, min(cfg.get('最多加快到', 1.0), goal / rate))
        x = tempo(x, sr, k, d)
        pauses = []
        if cfg.get('拉长停顿', True):
            x, pauses = stretch_pauses(x, sr, text, cfg.get('停顿', {}))
        x = level(x, sr)
        s1 = score(x)
        was = rec.get(str(i), {})
        if (os.path.exists(out) and was.get('字') == text and was.get('做法') == how and was.get('念的字', text) == said and was.get('像', 0) >= s1
                and lo <= was.get('原速字每秒', 0) <= hi):   # 原来那遍快慢合适又更像，才留原来的
            print('第%02d句  这回最好的 %.2f 不如原来的 %.2f，留原来的' % (i, s1, was['像']), flush=True)
            continue
        sf.write(out, x, sr, subtype='PCM_16')
        rec[str(i)] = {'字': text, '念的字': said, '引擎': engine, '做法': how, '秒': round(len(x) / sr, 2), '字每秒': round(n / (len(x) / sr), 1),
                       '像': round(s1, 3), '原速像': round(s0, 3), '原速字每秒': round(rate, 1), '放慢到': round(k, 2),
                       '停顿': pauses, '几遍': log}
        json.dump(rec, open(rec_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('第%02d句  %.1f 秒  一秒 %.1f 字  像 %.2f（挑中那遍 %.2f）  念了 %d 遍  %s' % (
            i, len(x) / sr, n / (len(x) / sr), s1, s0, len(log), text), flush=True)


def main():
    args = sys.argv[1:]
    cfg = json.load(open(os.path.join(ROOT, '配音设置.json'), encoding='utf-8'))
    engine = next((a.split('=', 1)[1] for a in args if a.startswith('--引擎=')), cfg.get('引擎', 'IndexTTS2.5'))
    if engine not in PY:
        raise SystemExit('不认识的引擎：%s（只有 %s）' % (engine, '、'.join(PY)))
    if '--worker' in args:
        pos = [a for a in args if not a.startswith('--')]
        worker(pos[0], [int(x) for x in pos[1:] if x.isdigit()],
               next((int(a.split('=', 1)[1]) for a in args if a.startswith('--几遍=')), None), engine)
        return
    args = [a for a in args if not a.startswith('--引擎=')]
    for k in range(3):
        rc = subprocess.call([PY[engine], '-X', 'utf8', os.path.abspath(__file__), '--worker', '--引擎=' + engine] + args,
                             env=dict(os.environ, PYTHONIOENCODING='utf-8'))
        if rc == 0:
            return
        print('（模型闪退了，第 %d 回重来）' % (k + 1), flush=True)
    sys.exit(1)


if __name__ == '__main__':
    main()
