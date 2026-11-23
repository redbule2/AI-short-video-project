# -*- coding: utf-8 -*-
"""机器听一听：配出来的声音和「声音参考.wav」像不像（声纹打分，0～1，越大越像）。
用法（VoxCPM2 的 Python）：
    D:/Apps/VoxCPM2/venv/Scripts/python.exe 像不像.py <课的文件夹> [对照录音.wav]
        对照录音：同一个人另一段原声，默认用旁边的 声音对照.wav。
        先拿对照录音切成 1.5 秒、3 秒、6 秒的小段，算「本人说这么长一句」能打几分当标准
        （句子越短分越低，短句不能拿长句的分比）；再逐句算配音的分，和同样长短的本人分比。
声纹模型用 ModelScope 的 CAM++（iic/speech_campplus_sv_zh-cn_16k-common，约 30MB，第一次用会下载）。
"""
import glob
import os
import sys
import tempfile

import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from 配音 import series_file   # 这套教程自己有 声音参考.wav、声音对照.wav 就用自己的


def load16(p):
    x, sr = sf.read(p, dtype='float32')
    if x.ndim > 1:
        x = x.mean(1)
    if sr != 16000:
        import librosa
        x = librosa.resample(x, orig_sr=sr, target_sr=16000)
    return x


def main():
    folder = sys.argv[1]
    other = sys.argv[2] if len(sys.argv) > 2 else series_file(folder, '声音对照.wav')
    from modelscope.pipelines import pipeline
    sv = pipeline(task='speaker-verification', model='iic/speech_campplus_sv_zh-cn_16k-common', model_revision='v1.0.0')
    with tempfile.TemporaryDirectory() as d:
        def score(x, name):
            p = os.path.join(d, name + '.wav')
            sf.write(p, x, 16000, subtype='PCM_16')
            return float(sv([ref, p])['score'])
        ref = os.path.join(d, 'ref.wav')
        sf.write(ref, load16(series_file(folder, '声音参考.wav')), 16000, subtype='PCM_16')
        o = load16(other)
        base = {'整段': score(o, 'o')}
        for w in (1.5, 3.0, 6.0):
            n, hop = int(w * 16000), int(w * 8000)
            ss = [score(o[a:a + n], 'o%d' % a) for a in range(0, len(o) - n + 1, hop)]
            base[w] = float(np.mean(ss))
        print('本人对本人：整段 %.3f；说 1.5 秒一句 %.3f，3 秒 %.3f，6 秒 %.3f' % (base['整段'], base[1.5], base[3.0], base[6.0]))
        gap = []
        for p in sorted(glob.glob(os.path.join(folder, '配音_[0-9]*.wav'))):
            x = load16(p)
            t = len(x) / 16000
            b = float(np.interp(t, [1.5, 3.0, 6.0], [base[1.5], base[3.0], base[6.0]]))
            s = score(x, 'c')
            gap.append(s - b)
            print('%s  %.1f 秒  %.3f（本人说这么长 %.3f，差 %+.3f）' % (os.path.basename(p), t, s, b, s - b))
        if gap:
            print('平均比本人低 %.3f' % -float(np.mean(gap)))


if __name__ == '__main__':
    main()
