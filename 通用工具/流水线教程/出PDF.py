# -*- coding: utf-8 -*-
"""把一课的「图文.html」印成 PDF（A4），再把每页存成小图核对。
用法（Codex 自带的 Python）：
    python -I -X utf8 出PDF.py <课的文件夹>
图文.html 里写 <div class="shot" data-img="首页" data-crop="x,y,w,h">…<i data-box="项目名+换项目" data-n="1"></i></div>，
框的位置从 框.json 自动算（印的时候把 框.json 塞进页面里），图用同一个文件夹里的截图。
出：<课名>.pdf；核对图放在系统临时文件夹（不进项目）。
"""
import glob
import os
import shutil
import subprocess
import sys
import tempfile
import time

CHROME = next(p for p in ['C:/Program Files/Google/Chrome/Application/chrome.exe',
                          'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] if os.path.exists(p))


def main():
    folder = os.path.abspath(sys.argv[1])
    name = os.path.basename(folder)
    html = open(os.path.join(folder, '图文.html'), encoding='utf-8').read()
    boxes = open(os.path.join(folder, '框.json'), encoding='utf-8').read()
    html = html.replace('/*框数据*/', 'window.BOXES = ' + boxes + ';')
    tmp = os.path.join(folder, '_印.html')
    open(tmp, 'w', encoding='utf-8').write(html)
    out = os.path.join(folder, name + '.pdf')
    prof = tempfile.mkdtemp(prefix='tut-pdf-')
    try:
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--user-data-dir=' + prof,
                        '--virtual-time-budget=8000', '--run-all-compositor-stages-before-draw',
                        '--print-to-pdf=' + out, 'file:///' + tmp.replace('\\', '/')], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    finally:
        time.sleep(0.5)
        os.remove(tmp)
        shutil.rmtree(prof, ignore_errors=True)   # 打印用的临时浏览器资料
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(out)
    look = os.path.join(tempfile.gettempdir(), 'tut-pdf-look')
    os.makedirs(look, exist_ok=True)
    for f in glob.glob(os.path.join(look, name + '_*.png')):
        os.remove(f)
    for i in range(len(pdf)):
        pdf[i].render(scale=1.3).to_pil().save(os.path.join(look, '%s_%d.png' % (name, i + 1)))
    print('PDF %d 页 → %s（%.1f MB）；核对图在 %s' % (len(pdf), out, os.path.getsize(out) / 1e6, look))


if __name__ == '__main__':
    main()
