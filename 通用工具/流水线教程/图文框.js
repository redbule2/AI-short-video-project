/* 流水线教程的图文：照 框.json（出PDF.py 印之前塞进 window.BOXES）摆截图、画框、标号。
   <div class="shot" data-img="首页" data-crop="x,y,w,h" style="width:…">  只露出截图的这一块（页面像素），不写就是整张
     <i data-box="甲+乙" data-n="1" data-pad="5"></i>                    框住这几样（取并起来那一块），左上角标 1
   </div>
   宽度照 style 或外面的格子，高度照截出来那一块的比例自己算。 */
(function () {
  const B = window.BOXES || {};
  for (const shot of document.querySelectorAll('.shot[data-img]')) {
    const b = B[shot.dataset.img];
    if (!b) { shot.textContent = '框.json 里没有「' + shot.dataset.img + '」'; continue; }
    const [cx, cy, cw, ch] = shot.dataset.crop ? shot.dataset.crop.split(',').map(Number) : [0, 0, b.宽, b.高];
    shot.style.aspectRatio = cw + ' / ' + ch;
    const img = document.createElement('img');
    img.src = b.图;
    img.style.width = (b.宽 / cw * 100) + '%';
    img.style.left = (-cx / cw * 100) + '%';
    img.style.top = (-cy / ch * 100) + '%';
    shot.prepend(img);
    for (const m of shot.querySelectorAll('i[data-box]')) {
      const pad = Number(m.dataset.pad || 5);
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const n of m.dataset.box.split('+')) {
        const r = b.框[n];
        if (!r) { m.remove(); console.error('没有框', n); continue; }
        x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]); x1 = Math.max(x1, r[0] + r[2]); y1 = Math.max(y1, r[1] + r[3]);
      }
      x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
      Object.assign(m.style, { left: ((x0 - cx) / cw * 100) + '%', top: ((y0 - cy) / ch * 100) + '%', width: ((x1 - x0) / cw * 100) + '%', height: ((y1 - y0) / ch * 100) + '%' });
      if (m.dataset.n) { const k = document.createElement('span'); k.className = 'mk'; k.textContent = m.dataset.n; m.appendChild(k); }
    }
  }
})();
