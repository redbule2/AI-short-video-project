/* previs_eval.cjs — 预演 JSON 的纯数学求值（无依赖）。
 * 浏览器里以普通 <script> 内联（挂到 globalThis.PrevisEval），Node 里用 require 引入。
 * 与 previs_eval.py 语义保持一致（blender_previs.py 用 Python 版）。
 *
 * 坐标：米，Y 轴向上，地面 y=0。yaw（度）：0 = 面向 +Z，90 = 面向 +X。
 */
(function (root) {
  'use strict';

  var DIAG_35MM = Math.sqrt(36 * 36 + 24 * 24); // 43.27mm，等效焦距按画幅对角线换算
  var DEG = Math.PI / 180;
  var POSE_FACTOR = { stand: 1.0, sit: 0.72, crouch: 0.6, kneel: 0.7, lie: 0.25 };
  var PART_RATIO = { head: 0.94, eyes: 0.94, face: 0.94, neck: 0.86, shoulder: 0.82, chest: 0.72,
    waist: 0.56, hip: 0.5, knee: 0.28, knees: 0.28, feet: 0.03, foot: 0.03, root: 0 };

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : d; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function lerp3(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function len3(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]); }
  function clamp(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function wrap180(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a; }
  function lerpAngle(a, b, k) { return a + wrap180(b - a) * k; }
  function vec3(v) {
    if (!Array.isArray(v)) return null;
    if (v.length === 2) return [num(v[0], 0), 0, num(v[1], 0)]; // [x, z] 简写
    if (v.length === 3) return [num(v[0], 0), num(v[1], 0), num(v[2], 0)];
    return null;
  }
  function ease(kind, k) {
    k = clamp(k, 0, 1);
    switch (kind) {
      case 'linear': return k;
      case 'in': return k * k * k;
      case 'out': return 1 - Math.pow(1 - k, 3);
      case 'hold': return 0;
      default: return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; // inOut
    }
  }

  function parseRatio(r) {
    var m = /^\s*(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)\s*$/.exec(String(r || '9:16'));
    return m ? (parseFloat(m[1]) / parseFloat(m[2])) : 9 / 16;
  }
  function even(x) { return Math.max(2, Math.round(x / 2) * 2); }

  /** 等效焦距(mm，按对角线) → 垂直 FOV(度) */
  function focalToVfov(focal, aspect) {
    var halfDiag = Math.atan(DIAG_35MM / (2 * focal));
    var vfrac = 1 / Math.sqrt(1 + aspect * aspect); // 高 / 对角线
    return 2 * Math.atan(Math.tan(halfDiag) * vfrac) / DEG;
  }

  // ---------------------------------------------------------------- normalize
  function normalize(raw) {
    var errors = [], warnings = [];
    var spec = JSON.parse(JSON.stringify(raw || {}));
    spec.duration = num(spec.duration, 0);
    if (!(spec.duration > 0)) errors.push('duration 必须 > 0（秒）');
    spec.fps = Math.round(num(spec.fps, 24));
    spec.ratio = spec.ratio || '9:16';
    var aspect = parseRatio(spec.ratio);
    var res = spec.resolution;
    if (Array.isArray(res) && res.length === 2) { spec.width = even(res[0]); spec.height = even(res[1]); }
    else {
      var shortSide = num(spec.shortSide, 480);
      if (aspect < 1) { spec.width = even(shortSide); spec.height = even(shortSide / aspect); }
      else { spec.height = even(shortSide); spec.width = even(shortSide * aspect); }
    }
    spec.aspect = spec.width / spec.height;
    spec.overlay = Object.assign({ enabled: true, shotInfo: true, names: true, timeline: true }, spec.overlay || {});
    spec.scene = spec.scene || {};
    spec.scene.ground = Object.assign({ size: [24, 24], color: '#6b6f78', grid: true }, spec.scene.ground || {});
    spec.scene.objects = Array.isArray(spec.scene.objects) ? spec.scene.objects : [];
    // 上限防止外部 JSON 让渲染跑不完或耗尽内存
    if (spec.duration > 600) errors.push('duration 不能超过 600 秒');
    if (!(spec.fps >= 1 && spec.fps <= 60)) errors.push('fps 需在 1–60 之间');
    if (!(spec.width > 0 && spec.height > 0 && spec.width <= 4096 && spec.height <= 4096)) errors.push('分辨率宽高需在 1–4096 之间');
    var gsz = spec.scene.ground && spec.scene.ground.size;
    if (Array.isArray(gsz) && gsz.some(function (v) { return !(num(v, 0) > 0 && num(v, 0) <= 200); })) errors.push('scene.ground.size 每边需在 0–200 米之间');

    var palette = ['#e2574c', '#3b82f6', '#22c55e', '#eab308', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
    spec.characters = Array.isArray(spec.characters) ? spec.characters : [];
    var ids = Object.create(null);
    spec.characters.forEach(function (c, i) {
      if (!c.id) errors.push('characters[' + i + '] 缺少 id');
      ids[c.id] = c;
      c.name = c.name || c.id;
      c.color = c.color || palette[i % palette.length];
      c.height = num(c.height, 1.7);
      var keys = Array.isArray(c.keys) && c.keys.length ? c.keys : [{ t: 0, pos: c.pos || [0, 0, 0], yaw: c.yaw, face: c.face, pose: c.pose }];
      keys = keys.map(function (k, j) {
        var o = { t: num(k.t, j === 0 ? 0 : NaN), ease: k.ease || 'inOut' };
        if (!isFinite(o.t)) errors.push('characters.' + c.id + '.keys[' + j + '] 缺少 t');
        if (k.pos !== undefined) { o.pos = vec3(k.pos); if (!o.pos) errors.push('characters.' + c.id + '.keys[' + j + '].pos 需为 [x,y,z] 或 [x,z]'); }
        if (k.yaw !== undefined) o.yaw = num(k.yaw, 0);
        if (k.face !== undefined) o.face = k.face;
        if (k.pose !== undefined) { o.pose = k.pose; if (!(k.pose in POSE_FACTOR)) warnings.push('未知 pose ' + k.pose + '，按 stand 处理'); }
        return o;
      }).sort(function (a, b) { return a.t - b.t; });
      // carry forward
      var prev = { pos: [0, 0, 0], yaw: 0, pose: 'stand' };
      keys.forEach(function (k) {
        if (!k.pos) k.pos = prev.pos;
        if (k.yaw === undefined && k.face === undefined) { if (prev.face !== undefined) k.face = prev.face; else k.yaw = prev.yaw; }
        if (!k.pose) k.pose = prev.pose;
        prev = k;
      });
      c.keys = keys;
    });
    spec._chars = ids;

    spec.shots = Array.isArray(spec.shots) ? spec.shots : [];
    if (!spec.shots.length) errors.push('shots 不能为空');
    spec.shots.forEach(function (s, i) {
      s.index = i;
      s.id = s.id !== undefined ? String(s.id) : String(i + 1);
      s.label = s.label || '';
      if (!Array.isArray(s.t) || s.t.length !== 2 || !(s.t[1] > s.t[0])) { errors.push('shots[' + i + '].t 需为 [开始, 结束] 且结束>开始'); s.t = [0, spec.duration]; }
      var cam = s.camera || {};
      s.shake = num(cam.shake, num(s.shake, 0));
      var keys = Array.isArray(cam.keys) && cam.keys.length ? cam.keys : [cam];
      var n = keys.length, a = s.t[0], b = s.t[1];
      var prev = null;
      s.keys = keys.map(function (k, j) {
        var t;
        if (typeof k.t === 'number') t = k.t;
        else if (typeof k.u === 'number') t = a + k.u * (b - a);
        else t = n === 1 ? a : a + (j / (n - 1)) * (b - a);
        var o = { t: t, ease: k.ease || cam.ease || 'inOut' };
        // 镜头位置：pos（世界坐标/角色锚点）与 sph（围绕注视目标的球坐标）二选一
        if (k.pos !== undefined) { o.pos = k.pos; o.follow = k.follow || null; }
        else if (k.sph !== undefined) { o.sph = Object.assign({}, prev && prev.sph ? prev.sph : {}, k.sph); }
        else if (prev) { if (prev.pos !== undefined) { o.pos = prev.pos; o.follow = prev.follow; } else o.sph = Object.assign({}, prev.sph); }
        o.lookAt = k.lookAt !== undefined ? k.lookAt : (prev ? prev.lookAt : undefined);
        o.lookOffset = vec3(k.lookOffset) || (k.lookOffset === undefined && prev ? prev.lookOffset : [0, 0, 0]);
        o.posOffset = vec3(k.posOffset) || (k.posOffset === undefined && prev ? prev.posOffset : [0, 0, 0]);
        if (k.fov !== undefined) o.vfov = num(k.fov, 50);
        else if (k.focal !== undefined) o.vfov = focalToVfov(num(k.focal, 35), spec.aspect);
        else o.vfov = prev ? prev.vfov : focalToVfov(35, spec.aspect);
        o.focal = k.focal !== undefined ? k.focal : (k.fov === undefined && prev ? prev.focal : undefined);
        o.roll = num(k.roll, prev ? prev.roll : 0);
        if (o.lookAt === undefined) errors.push('shots[' + i + '].camera.keys[' + j + '] 缺少 lookAt');
        if (o.pos === undefined && o.sph === undefined) errors.push('shots[' + i + '].camera.keys[' + j + '] 需要 pos 或 sph');
        if (o.sph) { o.sph.dist = num(o.sph.dist, 3); o.sph.azim = num(o.sph.azim, 0); o.sph.elev = num(o.sph.elev, 0); }
        prev = o;
        return o;
      }).sort(function (x, y) { return x.t - y.t; });
    });
    spec.shots.sort(function (x, y) { return x.t[0] - y.t[0]; });
    for (var i = 1; i < spec.shots.length; i++) {
      if (spec.shots[i].t[0] < spec.shots[i - 1].t[1] - 1e-6) warnings.push('镜头 ' + spec.shots[i - 1].id + ' 与 ' + spec.shots[i].id + ' 时间重叠');
      else if (spec.shots[i].t[0] > spec.shots[i - 1].t[1] + 1e-6) warnings.push('镜头 ' + spec.shots[i - 1].id + ' 与 ' + spec.shots[i].id + ' 之间有空档（沿用前一镜头）');
    }
    if (spec.shots.length && Math.abs(spec.shots[spec.shots.length - 1].t[1] - spec.duration) > 0.05)
      warnings.push('最后一个镜头结束于 ' + spec.shots[spec.shots.length - 1].t[1] + 's，与 duration=' + spec.duration + 's 不一致');
    // 引用检查
    function checkRef(r, where) {
      var list = Array.isArray(r) && typeof r[0] === 'string' ? r : (typeof r === 'string' ? [r] : []);
      list.forEach(function (x) { var id = String(x).split(':')[0]; if (!ids[id]) errors.push(where + ' 引用了不存在的角色 ' + id); });
    }
    spec.shots.forEach(function (s) {
      s.keys.forEach(function (k, j) {
        checkRef(k.lookAt, '镜头' + s.id + '.keys[' + j + '].lookAt');
        if (typeof k.pos === 'string') checkRef(k.pos, '镜头' + s.id + '.keys[' + j + '].pos');
        if (k.follow) checkRef(k.follow, '镜头' + s.id + '.keys[' + j + '].follow');
      });
    });
    spec.characters.forEach(function (c) { c.keys.forEach(function (k) { if (typeof k.face === 'string') checkRef(k.face, '角色' + c.id + '.face'); }); });
    return { spec: spec, errors: errors, warnings: warnings };
  }

  // ---------------------------------------------------------------- 角色
  function segment(keys, t) {
    if (t <= keys[0].t) return { k0: keys[0], k1: keys[0], a: 0 };
    for (var i = 1; i < keys.length; i++) {
      if (t < keys[i].t) {
        var k0 = keys[i - 1], k1 = keys[i];
        return { k0: k0, k1: k1, a: ease(k1.ease, (t - k0.t) / Math.max(1e-6, k1.t - k0.t)) };
      }
    }
    return { k0: keys[keys.length - 1], k1: keys[keys.length - 1], a: 0 };
  }

  function charPos(spec, id, t) {
    var c = spec._chars[id];
    var s = segment(c.keys, t);
    return lerp3(s.k0.pos, s.k1.pos, s.a);
  }

  function keyYaw(spec, c, k, pos, t) {
    if (k.face !== undefined) {
      var target = typeof k.face === 'string' ? (spec._chars[k.face] ? charPos(spec, k.face, t) : null) : vec3(k.face);
      if (target) {
        var d = sub3(target, pos);
        if (Math.abs(d[0]) + Math.abs(d[2]) > 1e-6) return Math.atan2(d[0], d[2]) / DEG;
      }
    }
    return num(k.yaw, 0);
  }

  function charState(spec, id, t) {
    var c = spec._chars[id];
    var s = segment(c.keys, t);
    var pos = lerp3(s.k0.pos, s.k1.pos, s.a);
    var y0 = keyYaw(spec, c, s.k0, pos, t), y1 = keyYaw(spec, c, s.k1, pos, t);
    var pf = lerp(POSE_FACTOR[s.k0.pose] || 1, POSE_FACTOR[s.k1.pose] || 1, s.a);
    return { id: id, pos: pos, yaw: wrap180(lerpAngle(y0, y1, s.a)), poseFactor: pf, height: c.height,
      pose: s.a < 0.5 ? s.k0.pose : s.k1.pose };
  }

  /** 解析注视/锚点：[x,y,z] | "id" | "id:part" | ["id:part", "id2:part"]（取平均） */
  function anchor(spec, ref, t) {
    if (Array.isArray(ref) && ref.length && typeof ref[0] === 'string') {
      var acc = [0, 0, 0];
      ref.forEach(function (r) { acc = add3(acc, anchor(spec, r, t)); });
      return [acc[0] / ref.length, acc[1] / ref.length, acc[2] / ref.length];
    }
    if (Array.isArray(ref)) return vec3(ref) || [0, 0, 0];
    if (typeof ref === 'string') {
      var parts = ref.split(':'), id = parts[0], part = parts[1] || 'chest';
      if (!spec._chars[id]) return [0, 0, 0];
      var st = charState(spec, id, t);
      var r = PART_RATIO[part] !== undefined ? PART_RATIO[part] : PART_RATIO.chest;
      return [st.pos[0], st.pos[1] + st.height * st.poseFactor * r, st.pos[2]];
    }
    return [0, 0, 0];
  }

  function refYaw(spec, ref, sph, t) {
    if (sph.ref === 'world') return 0;
    if (typeof ref === 'string' && spec._chars[ref.split(':')[0]]) return charState(spec, ref.split(':')[0], t).yaw;
    if (typeof sph.ref === 'string' && spec._chars[sph.ref]) return charState(spec, sph.ref, t).yaw;
    return 0;
  }

  function sphPos(T, yaw, sph) {
    var A = (yaw + sph.azim) * DEG, E = sph.elev * DEG;
    return [T[0] + Math.cos(E) * Math.sin(A) * sph.dist, T[1] + Math.sin(E) * sph.dist, T[2] + Math.cos(E) * Math.cos(A) * sph.dist];
  }

  function keyCamPos(spec, k, T, t) {
    if (k.pos !== undefined) {
      var p = typeof k.pos === 'string' || (Array.isArray(k.pos) && typeof k.pos[0] === 'string') ? anchor(spec, k.pos, t) : (vec3(k.pos) || [0, 0, 0]);
      if (k.follow && spec._chars[k.follow]) p = add3(p, charPos(spec, k.follow, t));
      return p;
    }
    return sphPos(T, refYaw(spec, k.lookAt, k.sph, t), k.sph);
  }

  // 手持抖动：确定性的多频正弦噪声
  function noise(t, seed) {
    return 0.5 * Math.sin(2 * Math.PI * 0.71 * t + seed) + 0.3 * Math.sin(2 * Math.PI * 1.93 * t + seed * 1.7) + 0.2 * Math.sin(2 * Math.PI * 4.37 * t + seed * 2.3);
  }

  function shotAt(spec, t) {
    var shots = spec.shots, cur = shots[0];
    for (var i = 0; i < shots.length; i++) { if (t >= shots[i].t[0] - 1e-9) cur = shots[i]; }
    return cur;
  }

  /** 相机状态：{shot, pos, look, vfov, roll} */
  function cameraState(spec, t) {
    var shot = shotAt(spec, t);
    var s = segment(shot.keys, t), k0 = s.k0, k1 = s.k1, a = s.a;
    var T0 = anchor(spec, k0.lookAt, t), T1 = anchor(spec, k1.lookAt, t);
    var T = lerp3(T0, T1, a), pos;
    if (k0.sph && k1.sph) {
      var y0 = refYaw(spec, k0.lookAt, k0.sph, t), y1 = refYaw(spec, k1.lookAt, k1.sph, t);
      pos = sphPos(T, lerpAngle(y0, y1, a), {
        dist: lerp(k0.sph.dist, k1.sph.dist, a), elev: lerp(k0.sph.elev, k1.sph.elev, a),
        azim: lerp(k0.sph.azim, k1.sph.azim, a) // 不取最短弧：允许 azim 0→270 的大环绕
      });
    } else {
      pos = lerp3(keyCamPos(spec, k0, T0, t), keyCamPos(spec, k1, T1, t), a);
    }
    pos = add3(pos, lerp3(k0.posOffset, k1.posOffset, a));
    var look = add3(T, lerp3(k0.lookOffset, k1.lookOffset, a));
    var roll = lerp(k0.roll, k1.roll, a);
    if (shot.shake > 0) {
      var amp = shot.shake, d = len3(sub3(look, pos));
      pos = add3(pos, [0.04 * amp * noise(t, 1.1), 0.03 * amp * noise(t, 2.9), 0.04 * amp * noise(t, 4.3)]);
      look = add3(look, [0.02 * amp * d * noise(t, 5.7), 0.015 * amp * d * noise(t, 7.1), 0]);
      roll += 1.2 * amp * noise(t, 9.3);
    }
    if (len3(sub3(look, pos)) < 1e-4) look = add3(pos, [0, 0, -1]);
    return { shot: shot, pos: pos, look: look, vfov: lerp(k0.vfov, k1.vfov, a), roll: roll };
  }

  /** 把世界点投到画面：返回 {x,y} ∈ [-1,1]（x 右、y 上）与 depth；depth<=0 表示在相机后方 */
  function project(cam, aspect, p) {
    var f = sub3(cam.look, cam.pos), fl = len3(f); f = [f[0] / fl, f[1] / fl, f[2] / fl];
    var up = [0, 1, 0];
    var r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    var rl = len3(r); if (rl < 1e-6) { r = [1, 0, 0]; rl = 1; } r = [r[0] / rl, r[1] / rl, r[2] / rl];
    var u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    var cr = Math.cos(cam.roll * DEG), sr = Math.sin(cam.roll * DEG);
    var r2 = [r[0] * cr + u[0] * sr, r[1] * cr + u[1] * sr, r[2] * cr + u[2] * sr];
    var u2 = [u[0] * cr - r[0] * sr, u[1] * cr - r[1] * sr, u[2] * cr - r[2] * sr];
    var d = sub3(p, cam.pos);
    var z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    var x = d[0] * r2[0] + d[1] * r2[1] + d[2] * r2[2];
    var y = d[0] * u2[0] + d[1] * u2[1] + d[2] * u2[2];
    var th = Math.tan(cam.vfov * DEG / 2);
    if (z <= 1e-6) return { x: NaN, y: NaN, depth: z };
    return { x: x / z / (th * aspect), y: y / z / th, depth: z };
  }

  var api = { normalize: normalize, charState: charState, anchor: anchor, cameraState: cameraState, shotAt: shotAt,
    project: project, focalToVfov: focalToVfov, ease: ease, PART_RATIO: PART_RATIO, POSE_FACTOR: POSE_FACTOR };
  root.PrevisEval = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
