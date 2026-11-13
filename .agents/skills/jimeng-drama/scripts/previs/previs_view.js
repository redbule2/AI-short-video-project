/* previs_view.js — 浏览器端：用 three.js 搭白模场景，按时间渲染，并在 2D 画布上叠加镜头编号/时间/角色名。
 * 依赖全局：THREE（vendor/three.min.js）、PrevisEval（previs_eval.cjs）、PREVIS_SPEC（预演 JSON）。
 * 无头模式（window.__PREVIS_HEADLESS=true）只暴露 window.previs.frame(i)；否则显示播放器（播放/拖动/录制 webm）。
 */
(function () {
  'use strict';
  var E = window.PrevisEval;
  var norm = E.normalize(window.PREVIS_SPEC);
  var spec = norm.spec;
  var DEG = Math.PI / 180;
  var W = spec.width, H = spec.height;

  var glCanvas = document.createElement('canvas');
  var renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  var scene = new THREE.Scene();
  scene.background = new THREE.Color(spec.scene.background || '#2a2e36');
  var hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.6);
  scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(4, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  var sc = sun.shadow.camera; sc.left = -12; sc.right = 12; sc.top = 12; sc.bottom = -12; sc.near = 0.5; sc.far = 40;
  scene.add(sun);

  function mat(color, opacity) {
    var m = new THREE.MeshLambertMaterial({ color: new THREE.Color(color || '#9aa0aa') });
    if (typeof opacity === 'number' && opacity < 1) { m.transparent = true; m.opacity = opacity; }
    return m;
  }

  // 地面 + 网格（网格提供运动视差，便于模型读出运镜）
  var g = spec.scene.ground;
  if (g !== false && g.enabled !== false) {
    var gs = Array.isArray(g.size) ? g.size : [24, 24];
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(gs[0], gs[1]), mat(g.color));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
    if (g.grid !== false) {
      var grid = new THREE.GridHelper(Math.max(gs[0], gs[1]), Math.round(Math.max(gs[0], gs[1])), 0x2b2f36, 0x50555e);
      grid.position.y = 0.003;
      scene.add(grid);
    }
  }

  // 静态几何体：position 为底面中心
  var labels = [];
  spec.scene.objects.forEach(function (o) {
    var size = Array.isArray(o.size) ? o.size : [1, 1, 1];
    var geo, h = size[1];
    switch (o.type) {
      case 'cylinder': geo = new THREE.CylinderGeometry(size[0] / 2, size[0] / 2, size[1], 24); break;
      case 'sphere': geo = new THREE.SphereGeometry(size[0] / 2, 24, 16); h = size[0]; break;
      case 'plane': geo = new THREE.PlaneGeometry(size[0], size[1]); break;
      default: geo = new THREE.BoxGeometry(size[0], size[1], size[2] !== undefined ? size[2] : size[0]);
    }
    var mesh = new THREE.Mesh(geo, mat(o.color, o.opacity));
    var p = Array.isArray(o.position) ? o.position : [0, 0, 0];
    if (p.length === 2) p = [p[0], 0, p[1]];
    mesh.position.set(p[0], p[1] + (o.type === 'plane' ? 0 : h / 2), p[2]);
    mesh.rotation.y = (o.rotY || 0) * DEG;
    if (o.type === 'plane' && o.rotX !== undefined) mesh.rotation.x = o.rotX * DEG;
    mesh.castShadow = o.castShadow !== false && o.type !== 'plane';
    mesh.receiveShadow = true;
    scene.add(mesh);
    if (o.label) labels.push({ text: o.label, pos: new THREE.Vector3(p[0], p[1] + h + 0.1, p[2]), color: '#cfd3da' });
  });

  // 角色：胶囊身体 + 头 + 鼻子 + 胸前标记 + 地面朝向箭头
  var actors = spec.characters.map(function (c) {
    var grp = new THREE.Group();
    var inner = new THREE.Group();
    grp.add(inner);
    var h = c.height, r = 0.2, bodyH = h * 0.84;
    var color = new THREE.Color(c.color);
    var body = new THREE.Mesh(new THREE.CapsuleGeometry(r, Math.max(0.1, bodyH - 2 * r), 6, 16), mat(color));
    body.position.y = bodyH / 2;
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 14), mat(color.clone().lerp(new THREE.Color('#ffffff'), 0.35)));
    head.position.y = h - 0.12;
    var nose = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 12), mat('#f5f5f5'));
    nose.rotation.x = Math.PI / 2; nose.position.set(0, h - 0.13, 0.15);
    var chest = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.04), mat('#f5f5f5'));
    chest.position.set(0, h * 0.68, r - 0.01);
    [body, head, nose, chest].forEach(function (m) { m.castShadow = true; inner.add(m); });
    var shape = new THREE.Shape();
    shape.moveTo(-0.16, 0.25); shape.lineTo(0.16, 0.25); shape.lineTo(0, 0.55); shape.lineTo(-0.16, 0.25);
    var arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide }));
    arrow.rotation.x = Math.PI / 2; arrow.position.y = 0.01; // shape 的 +y 映射到 +z（面向方向）
    grp.add(arrow);
    scene.add(grp);
    return { c: c, grp: grp, inner: inner, body: body, head: head, nose: nose, chest: chest, bodyH: bodyH };
  });

  var camera = new THREE.PerspectiveCamera(50, W / H, 0.05, 300);

  // 2D 合成画布（显示 + 叠字 + 导出）
  var view = document.createElement('canvas');
  view.width = W; view.height = H; view.id = 'view';
  var ctx = view.getContext('2d');
  var FONT = '"Noto Sans CJK SC","Source Han Sans SC","PingFang SC","Microsoft YaHei","WenQuanYi Micro Hei",sans-serif';

  function roundRect(x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function tag(text, x, y, bg, fs) {
    ctx.font = '600 ' + fs + 'px ' + FONT;
    var tw = ctx.measureText(text).width, pad = fs * 0.35;
    ctx.fillStyle = bg; roundRect(x - tw / 2 - pad, y - fs - pad, tw + 2 * pad, fs + 2 * pad * 0.9, fs * 0.3); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(text, x, y - pad * 0.3);
  }
  function toScreen(v) {
    var p = v.clone().project(camera);
    if (p.z > 1 || p.z < -1) return null;
    return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H };
  }

  function drawOverlay(t, cam) {
    var ov = spec.overlay;
    if (!ov.enabled) return;
    var fs = Math.round(Math.max(14, Math.min(W, H) * 0.044));
    if (ov.names) {
      actors.forEach(function (a) {
        var st = E.charState(spec, a.c.id, t);
        var s = toScreen(new THREE.Vector3(st.pos[0], st.pos[1] + a.c.height * st.poseFactor + 0.18, st.pos[2]));
        if (s && s.x > -50 && s.x < W + 50 && s.y > -20 && s.y < H + 50) tag(a.c.name, s.x, s.y, a.c.color, Math.round(fs * 0.85));
      });
      labels.forEach(function (l) {
        var s = toScreen(l.pos);
        if (s) tag(l.text, s.x, s.y, 'rgba(60,64,72,0.8)', Math.round(fs * 0.7));
      });
    }
    var shot = cam.shot, n = spec.shots.length;
    if (ov.shotInfo) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      var line1 = '镜头 ' + shot.id + '/' + n + (shot.label ? '  ' + shot.label : '');
      var line2 = t.toFixed(1) + 's / ' + spec.duration.toFixed(1) + 's   [' + shot.t[0] + '–' + shot.t[1] + 's]';
      ctx.font = '700 ' + fs + 'px ' + FONT;
      var w1 = ctx.measureText(line1).width;
      ctx.font = '500 ' + Math.round(fs * 0.8) + 'px ' + FONT;
      var w2 = ctx.measureText(line2).width;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(fs * 0.5, fs * 0.5, Math.max(w1, w2) + fs, fs * 2.4, fs * 0.3); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = '700 ' + fs + 'px ' + FONT;
      ctx.fillText(line1, fs, fs * 0.7);
      ctx.fillStyle = '#ffd34d'; ctx.font = '500 ' + Math.round(fs * 0.8) + 'px ' + FONT;
      ctx.fillText(line2, fs, fs * 1.8);
    }
    if (ov.timeline) {
      var y = H - fs * 0.9, x0 = fs * 0.5, x1 = W - fs * 0.5, bh = fs * 0.35;
      spec.shots.forEach(function (s, i) {
        var a = x0 + (x1 - x0) * s.t[0] / spec.duration, b = x0 + (x1 - x0) * Math.min(s.t[1], spec.duration) / spec.duration;
        ctx.fillStyle = s === shot ? 'rgba(255,211,77,0.9)' : (i % 2 ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.3)');
        ctx.fillRect(a + 1, y, b - a - 2, bh);
      });
      var px = x0 + (x1 - x0) * t / spec.duration;
      ctx.fillStyle = '#ff4d4d'; ctx.fillRect(px - 1.5, y - bh * 0.8, 3, bh * 2.6);
    }
  }

  function renderAt(t) {
    actors.forEach(function (a) {
      var st = E.charState(spec, a.c.id, t);
      a.grp.position.set(st.pos[0], st.pos[1], st.pos[2]);
      a.grp.rotation.y = st.yaw * DEG;
      // 姿态：只压缩身体，头保持球形并随之下移
      var pf = st.poseFactor, h = a.c.height;
      a.body.scale.y = pf; a.body.position.y = a.bodyH / 2 * pf;
      a.head.position.y = h * pf - 0.12; a.nose.position.y = h * pf - 0.13; a.chest.position.y = h * 0.68 * pf;
    });
    var cam = E.cameraState(spec, t);
    camera.fov = cam.vfov; camera.updateProjectionMatrix();
    camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
    if (cam.roll) camera.rotateZ(cam.roll * DEG);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(glCanvas, 0, 0, W, H);
    drawOverlay(t, cam);
    return cam;
  }

  var frameCount = Math.round(spec.duration * spec.fps);
  window.previs = {
    spec: spec, errors: norm.errors, warnings: norm.warnings, width: W, height: H, fps: spec.fps, frameCount: frameCount,
    renderAt: renderAt,
    capture: function (t, type, quality) { renderAt(t); return view.toDataURL(type || 'image/png', quality); },
    frame: function (i, type, quality) { return this.capture(i / spec.fps, type, quality); },
    ready: true
  };

  if (window.__PREVIS_HEADLESS) return;

  // ---------------- 交互播放器（无 Playwright 时：浏览器打开 → 播放 / 录制 webm） ----------------
  document.body.style.cssText = 'margin:0;background:#111;color:#ddd;font:14px ' + FONT + ';display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px';
  var maxH = Math.min(window.innerHeight - 110, H * 2);
  view.style.cssText = 'height:' + Math.max(240, maxH) + 'px;max-width:96vw;object-fit:contain;background:#000';
  document.body.appendChild(view);
  var bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:8px;align-items:center;width:min(96vw,' + Math.max(360, W) + 'px)';
  bar.innerHTML = '<button id="pp">暂停</button><input id="sl" type="range" min="0" max="' + frameCount + '" value="0" style="flex:1"><span id="tm"></span><button id="rec">录制 webm</button>';
  document.body.appendChild(bar);
  if (norm.errors.length || norm.warnings.length) {
    var pre = document.createElement('pre');
    pre.style.cssText = 'color:#f88;white-space:pre-wrap;max-width:96vw';
    pre.textContent = norm.errors.concat(norm.warnings).join('\n');
    document.body.appendChild(pre);
  }
  var pp = document.getElementById('pp'), sl = document.getElementById('sl'), tm = document.getElementById('tm'), rec = document.getElementById('rec');
  var playing = true, t0 = performance.now(), cur = 0, recorder = null;
  pp.onclick = function () { playing = !playing; pp.textContent = playing ? '暂停' : '播放'; t0 = performance.now() - cur * 1000; };
  sl.oninput = function () { cur = sl.value / spec.fps; t0 = performance.now() - cur * 1000; renderAt(cur); };
  rec.onclick = function () {
    if (recorder || !view.captureStream || !window.MediaRecorder) { if (!recorder) alert('此浏览器不支持 MediaRecorder，请用系统录屏'); return; }
    var chunks = [], stream = view.captureStream(spec.fps);
    recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
    recorder.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = function () {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
      a.download = (spec.id || 'previs') + '.webm'; a.click();
      recorder = null; rec.textContent = '录制 webm';
    };
    cur = 0; t0 = performance.now(); playing = true; pp.textContent = '暂停';
    recorder.start(); rec.textContent = '录制中…';
  };
  function loop(now) {
    if (playing) {
      cur = (now - t0) / 1000;
      if (cur >= spec.duration) {
        if (recorder) { renderAt(spec.duration - 1e-3); recorder.stop(); playing = false; pp.textContent = '播放'; cur = 0; }
        else { cur = 0; t0 = now; }
      }
      sl.value = Math.round(cur * spec.fps);
    }
    renderAt(cur);
    tm.textContent = cur.toFixed(2) + 's';
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
})();
