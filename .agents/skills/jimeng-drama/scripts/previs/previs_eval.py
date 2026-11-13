"""previs_eval.py — 预演 JSON 求值的 Python 版（与 previs_eval.cjs 逐函数对应，只用标准库）。

给 blender_previs.py 用，也可单独做校验：
  python3 previs_eval.py previs.json            打印校验结果和每镜头首/中/尾的相机位置
坐标：米，Y 轴向上，地面 y=0；yaw（度）0 = 面向 +Z，90 = 面向 +X。
"""
import copy
import json
import math
import re
import sys

DIAG_35MM = math.hypot(36, 24)
POSE_FACTOR = {"stand": 1.0, "sit": 0.72, "crouch": 0.6, "kneel": 0.7, "lie": 0.25}
PART_RATIO = {"head": 0.94, "eyes": 0.94, "face": 0.94, "neck": 0.86, "shoulder": 0.82, "chest": 0.72,
              "waist": 0.56, "hip": 0.5, "knee": 0.28, "knees": 0.28, "feet": 0.03, "foot": 0.03, "root": 0}
PALETTE = ["#e2574c", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899"]


def _num(v, d):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else d


def lerp(a, b, k):
    return a + (b - a) * k


def lerp3(a, b, k):
    return [lerp(a[i], b[i], k) for i in range(3)]


def add3(a, b):
    return [a[i] + b[i] for i in range(3)]


def sub3(a, b):
    return [a[i] - b[i] for i in range(3)]


def len3(a):
    return math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)


def wrap180(a):
    return ((a + 180) % 360 + 360) % 360 - 180


def lerp_angle(a, b, k):
    return a + wrap180(b - a) * k


def vec3(v):
    if not isinstance(v, list):
        return None
    if len(v) == 2:
        return [_num(v[0], 0), 0, _num(v[1], 0)]
    if len(v) == 3 and all(isinstance(x, (int, float)) for x in v):
        return [_num(v[0], 0), _num(v[1], 0), _num(v[2], 0)]
    return None


def ease(kind, k):
    k = max(0.0, min(1.0, k))
    if kind == "linear":
        return k
    if kind == "in":
        return k ** 3
    if kind == "out":
        return 1 - (1 - k) ** 3
    if kind == "hold":
        return 0.0
    return 4 * k ** 3 if k < 0.5 else 1 - (-2 * k + 2) ** 3 / 2


def parse_ratio(r):
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$", str(r or "9:16"))
    return float(m.group(1)) / float(m.group(2)) if m else 9 / 16


def _even(x):
    return max(2, int(round(x / 2.0)) * 2)


def focal_to_vfov(focal, aspect):
    half_diag = math.atan(DIAG_35MM / (2 * focal))
    return 2 * math.degrees(math.atan(math.tan(half_diag) / math.sqrt(1 + aspect * aspect)))


def normalize(raw):
    errors, warnings = [], []
    spec = copy.deepcopy(raw or {})
    spec["duration"] = _num(spec.get("duration"), 0)
    if not spec["duration"] > 0:
        errors.append("duration 必须 > 0（秒）")
    spec["fps"] = int(round(_num(spec.get("fps"), 24)))
    spec["ratio"] = spec.get("ratio") or "9:16"
    aspect = parse_ratio(spec["ratio"])
    res = spec.get("resolution")
    if isinstance(res, list) and len(res) == 2:
        spec["width"], spec["height"] = _even(res[0]), _even(res[1])
    else:
        short = _num(spec.get("shortSide"), 480)
        if aspect < 1:
            spec["width"], spec["height"] = _even(short), _even(short / aspect)
        else:
            spec["height"], spec["width"] = _even(short), _even(short * aspect)
    spec["aspect"] = spec["width"] / float(spec["height"])
    ov = {"enabled": True, "shotInfo": True, "names": True, "timeline": True}
    ov.update(spec.get("overlay") or {})
    spec["overlay"] = ov
    scene = spec.setdefault("scene", {})
    g = {"size": [24, 24], "color": "#6b6f78", "grid": True}
    if isinstance(scene.get("ground"), dict):
        g.update(scene["ground"])
    scene["ground"] = g if scene.get("ground") is not False else False
    scene["objects"] = scene.get("objects") if isinstance(scene.get("objects"), list) else []
    # 上限防止外部 JSON 让渲染跑不完或耗尽内存
    if spec["duration"] > 600:
        errors.append("duration 不能超过 600 秒")
    if not 1 <= spec["fps"] <= 60:
        errors.append("fps 需在 1–60 之间")
    if not (0 < spec["width"] <= 4096 and 0 < spec["height"] <= 4096):
        errors.append("分辨率宽高需在 1–4096 之间")
    gsz = scene["ground"].get("size") if scene["ground"] else None
    if isinstance(gsz, list) and not all(0 < _num(v, 0) <= 200 for v in gsz):
        errors.append("scene.ground.size 每边需在 0–200 米之间")

    chars = spec.get("characters") if isinstance(spec.get("characters"), list) else []
    spec["characters"] = chars
    ids = {}
    for i, c in enumerate(chars):
        if not c.get("id"):
            errors.append("characters[%d] 缺少 id" % i)
        ids[c.get("id")] = c
        c["name"] = c.get("name") or c.get("id")
        c["color"] = c.get("color") or PALETTE[i % len(PALETTE)]
        c["height"] = _num(c.get("height"), 1.7)
        keys = c.get("keys") if isinstance(c.get("keys"), list) and c.get("keys") else [
            {"t": 0, "pos": c.get("pos") or [0, 0, 0], "yaw": c.get("yaw"), "face": c.get("face"), "pose": c.get("pose")}]
        out = []
        for j, k in enumerate(keys):
            o = {"t": _num(k.get("t"), 0 if j == 0 else float("nan")), "ease": k.get("ease") or "inOut"}
            if not math.isfinite(o["t"]):
                errors.append("characters.%s.keys[%d] 缺少 t" % (c.get("id"), j))
            if k.get("pos") is not None:
                o["pos"] = vec3(k["pos"])
                if not o["pos"]:
                    errors.append("characters.%s.keys[%d].pos 需为 [x,y,z] 或 [x,z]" % (c.get("id"), j))
            if k.get("yaw") is not None:
                o["yaw"] = _num(k["yaw"], 0)
            if k.get("face") is not None:
                o["face"] = k["face"]
            if k.get("pose") is not None:
                o["pose"] = k["pose"]
                if k["pose"] not in POSE_FACTOR:
                    warnings.append("未知 pose %s，按 stand 处理" % k["pose"])
            out.append(o)
        out.sort(key=lambda x: x["t"] if math.isfinite(x["t"]) else 0)
        prev = {"pos": [0, 0, 0], "yaw": 0, "pose": "stand"}
        for k in out:
            if not k.get("pos"):
                k["pos"] = prev["pos"]
            if "yaw" not in k and "face" not in k:
                if "face" in prev:
                    k["face"] = prev["face"]
                else:
                    k["yaw"] = prev.get("yaw", 0)
            if not k.get("pose"):
                k["pose"] = prev["pose"]
            prev = k
        c["keys"] = out
    spec["_chars"] = ids

    shots = spec.get("shots") if isinstance(spec.get("shots"), list) else []
    spec["shots"] = shots
    if not shots:
        errors.append("shots 不能为空")
    for i, s in enumerate(shots):
        s["index"] = i
        s["id"] = str(s["id"]) if s.get("id") is not None else str(i + 1)
        s["label"] = s.get("label") or ""
        t = s.get("t")
        if not (isinstance(t, list) and len(t) == 2 and t[1] > t[0]):
            errors.append("shots[%d].t 需为 [开始, 结束] 且结束>开始" % i)
            s["t"] = [0, spec["duration"]]
        cam = s.get("camera") or {}
        s["shake"] = _num(cam.get("shake"), _num(s.get("shake"), 0))
        keys = cam.get("keys") if isinstance(cam.get("keys"), list) and cam.get("keys") else [cam]
        n, a, b = len(keys), s["t"][0], s["t"][1]
        prev = None
        out = []
        for j, k in enumerate(keys):
            if isinstance(k.get("t"), (int, float)):
                tt = k["t"]
            elif isinstance(k.get("u"), (int, float)):
                tt = a + k["u"] * (b - a)
            else:
                tt = a if n == 1 else a + (j / float(n - 1)) * (b - a)
            o = {"t": tt, "ease": k.get("ease") or cam.get("ease") or "inOut"}
            if k.get("pos") is not None:
                o["pos"] = k["pos"]
                o["follow"] = k.get("follow")
            elif k.get("sph") is not None:
                sph = dict(prev["sph"]) if prev and prev.get("sph") else {}
                sph.update(k["sph"])
                o["sph"] = sph
            elif prev:
                if prev.get("pos") is not None:
                    o["pos"], o["follow"] = prev["pos"], prev.get("follow")
                else:
                    o["sph"] = dict(prev["sph"])
            o["lookAt"] = k["lookAt"] if k.get("lookAt") is not None else (prev["lookAt"] if prev else None)
            lo, po = vec3(k.get("lookOffset")), vec3(k.get("posOffset"))
            o["lookOffset"] = lo or (prev["lookOffset"] if k.get("lookOffset") is None and prev else [0, 0, 0])
            o["posOffset"] = po or (prev["posOffset"] if k.get("posOffset") is None and prev else [0, 0, 0])
            if k.get("fov") is not None:
                o["vfov"] = _num(k["fov"], 50)
            elif k.get("focal") is not None:
                o["vfov"] = focal_to_vfov(_num(k["focal"], 35), spec["aspect"])
            else:
                o["vfov"] = prev["vfov"] if prev else focal_to_vfov(35, spec["aspect"])
            o["roll"] = _num(k.get("roll"), prev["roll"] if prev else 0)
            if o["lookAt"] is None:
                errors.append("shots[%d].camera.keys[%d] 缺少 lookAt" % (i, j))
            if o.get("pos") is None and o.get("sph") is None:
                errors.append("shots[%d].camera.keys[%d] 需要 pos 或 sph" % (i, j))
            if o.get("sph") is not None:
                o["sph"]["dist"] = _num(o["sph"].get("dist"), 3)
                o["sph"]["azim"] = _num(o["sph"].get("azim"), 0)
                o["sph"]["elev"] = _num(o["sph"].get("elev"), 0)
            prev = o
            out.append(o)
        out.sort(key=lambda x: x["t"])
        s["keys"] = out
    shots.sort(key=lambda x: x["t"][0])
    for i in range(1, len(shots)):
        if shots[i]["t"][0] < shots[i - 1]["t"][1] - 1e-6:
            warnings.append("镜头 %s 与 %s 时间重叠" % (shots[i - 1]["id"], shots[i]["id"]))
        elif shots[i]["t"][0] > shots[i - 1]["t"][1] + 1e-6:
            warnings.append("镜头 %s 与 %s 之间有空档（沿用前一镜头）" % (shots[i - 1]["id"], shots[i]["id"]))
    if shots and abs(shots[-1]["t"][1] - spec["duration"]) > 0.05:
        warnings.append("最后一个镜头结束于 %ss，与 duration=%ss 不一致" % (shots[-1]["t"][1], spec["duration"]))

    def check_ref(r, where):
        lst = r if isinstance(r, list) and r and isinstance(r[0], str) else ([r] if isinstance(r, str) else [])
        for x in lst:
            if str(x).split(":")[0] not in ids:
                errors.append("%s 引用了不存在的角色 %s" % (where, str(x).split(":")[0]))

    for s in shots:
        for j, k in enumerate(s["keys"]):
            check_ref(k.get("lookAt"), "镜头%s.keys[%d].lookAt" % (s["id"], j))
            if isinstance(k.get("pos"), str):
                check_ref(k["pos"], "镜头%s.keys[%d].pos" % (s["id"], j))
            if k.get("follow"):
                check_ref(k["follow"], "镜头%s.keys[%d].follow" % (s["id"], j))
    for c in chars:
        for k in c["keys"]:
            if isinstance(k.get("face"), str):
                check_ref(k["face"], "角色%s.face" % c.get("id"))
    return spec, errors, warnings


def _segment(keys, t):
    if t <= keys[0]["t"]:
        return keys[0], keys[0], 0.0
    for i in range(1, len(keys)):
        if t < keys[i]["t"]:
            k0, k1 = keys[i - 1], keys[i]
            return k0, k1, ease(k1["ease"], (t - k0["t"]) / max(1e-6, k1["t"] - k0["t"]))
    return keys[-1], keys[-1], 0.0


def char_pos(spec, cid, t):
    k0, k1, a = _segment(spec["_chars"][cid]["keys"], t)
    return lerp3(k0["pos"], k1["pos"], a)


def _key_yaw(spec, k, pos, t):
    face = k.get("face")
    if face is not None:
        target = (char_pos(spec, face, t) if face in spec["_chars"] else None) if isinstance(face, str) else vec3(face)
        if target:
            d = sub3(target, pos)
            if abs(d[0]) + abs(d[2]) > 1e-6:
                return math.degrees(math.atan2(d[0], d[2]))
    return _num(k.get("yaw"), 0)


def char_state(spec, cid, t):
    c = spec["_chars"][cid]
    k0, k1, a = _segment(c["keys"], t)
    pos = lerp3(k0["pos"], k1["pos"], a)
    y0, y1 = _key_yaw(spec, k0, pos, t), _key_yaw(spec, k1, pos, t)
    pf = lerp(POSE_FACTOR.get(k0["pose"], 1), POSE_FACTOR.get(k1["pose"], 1), a)
    return {"id": cid, "pos": pos, "yaw": wrap180(lerp_angle(y0, y1, a)), "poseFactor": pf, "height": c["height"],
            "pose": k0["pose"] if a < 0.5 else k1["pose"]}


def anchor(spec, ref, t):
    if isinstance(ref, list) and ref and isinstance(ref[0], str):
        acc = [0.0, 0.0, 0.0]
        for r in ref:
            acc = add3(acc, anchor(spec, r, t))
        return [x / len(ref) for x in acc]
    if isinstance(ref, list):
        return vec3(ref) or [0, 0, 0]
    if isinstance(ref, str):
        parts = ref.split(":")
        cid, part = parts[0], (parts[1] if len(parts) > 1 and parts[1] else "chest")
        if cid not in spec["_chars"]:
            return [0, 0, 0]
        st = char_state(spec, cid, t)
        r = PART_RATIO.get(part, PART_RATIO["chest"])
        return [st["pos"][0], st["pos"][1] + st["height"] * st["poseFactor"] * r, st["pos"][2]]
    return [0, 0, 0]


def _ref_yaw(spec, ref, sph, t):
    if sph.get("ref") == "world":
        return 0.0
    if isinstance(ref, str) and ref.split(":")[0] in spec["_chars"]:
        return char_state(spec, ref.split(":")[0], t)["yaw"]
    if isinstance(sph.get("ref"), str) and sph["ref"] in spec["_chars"]:
        return char_state(spec, sph["ref"], t)["yaw"]
    return 0.0


def _sph_pos(T, yaw, sph):
    A, E = math.radians(yaw + sph["azim"]), math.radians(sph["elev"])
    return [T[0] + math.cos(E) * math.sin(A) * sph["dist"], T[1] + math.sin(E) * sph["dist"],
            T[2] + math.cos(E) * math.cos(A) * sph["dist"]]


def _key_cam_pos(spec, k, T, t):
    if k.get("pos") is not None:
        p = k["pos"]
        if isinstance(p, str) or (isinstance(p, list) and p and isinstance(p[0], str)):
            p = anchor(spec, p, t)
        else:
            p = vec3(p) or [0, 0, 0]
        if k.get("follow") and k["follow"] in spec["_chars"]:
            p = add3(p, char_pos(spec, k["follow"], t))
        return p
    return _sph_pos(T, _ref_yaw(spec, k["lookAt"], k["sph"], t), k["sph"])


def _noise(t, seed):
    return (0.5 * math.sin(2 * math.pi * 0.71 * t + seed) + 0.3 * math.sin(2 * math.pi * 1.93 * t + seed * 1.7)
            + 0.2 * math.sin(2 * math.pi * 4.37 * t + seed * 2.3))


def shot_at(spec, t):
    cur = spec["shots"][0]
    for s in spec["shots"]:
        if t >= s["t"][0] - 1e-9:
            cur = s
    return cur


def camera_state(spec, t):
    shot = shot_at(spec, t)
    k0, k1, a = _segment(shot["keys"], t)
    T0, T1 = anchor(spec, k0["lookAt"], t), anchor(spec, k1["lookAt"], t)
    T = lerp3(T0, T1, a)
    if k0.get("sph") is not None and k1.get("sph") is not None:
        y0, y1 = _ref_yaw(spec, k0["lookAt"], k0["sph"], t), _ref_yaw(spec, k1["lookAt"], k1["sph"], t)
        pos = _sph_pos(T, lerp_angle(y0, y1, a), {
            "dist": lerp(k0["sph"]["dist"], k1["sph"]["dist"], a), "elev": lerp(k0["sph"]["elev"], k1["sph"]["elev"], a),
            "azim": lerp(k0["sph"]["azim"], k1["sph"]["azim"], a)})
    else:
        pos = lerp3(_key_cam_pos(spec, k0, T0, t), _key_cam_pos(spec, k1, T1, t), a)
    pos = add3(pos, lerp3(k0["posOffset"], k1["posOffset"], a))
    look = add3(T, lerp3(k0["lookOffset"], k1["lookOffset"], a))
    roll = lerp(k0["roll"], k1["roll"], a)
    if shot["shake"] > 0:
        amp, d = shot["shake"], len3(sub3(look, pos))
        pos = add3(pos, [0.04 * amp * _noise(t, 1.1), 0.03 * amp * _noise(t, 2.9), 0.04 * amp * _noise(t, 4.3)])
        look = add3(look, [0.02 * amp * d * _noise(t, 5.7), 0.015 * amp * d * _noise(t, 7.1), 0])
        roll += 1.2 * amp * _noise(t, 9.3)
    if len3(sub3(look, pos)) < 1e-4:
        look = add3(pos, [0, 0, -1])
    return {"shot": shot, "pos": pos, "look": look, "vfov": lerp(k0["vfov"], k1["vfov"], a), "roll": roll}


def load(path):
    with open(path, encoding="utf-8") as f:
        return normalize(json.load(f))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    spec, errs, warns = load(sys.argv[1])
    for w in warns:
        print("[warn]", w)
    for e in errs:
        print("[error]", e)
    if errs:
        sys.exit(2)
    for s in spec["shots"]:
        for t in (s["t"][0], (s["t"][0] + s["t"][1]) / 2, min(s["t"][1], spec["duration"]) - 1.0 / spec["fps"]):
            c = camera_state(spec, t)
            print("镜头%s t=%.2f pos=%s look=%s vfov=%.1f roll=%.1f" % (
                s["id"], t, [round(x, 3) for x in c["pos"]], [round(x, 3) for x in c["look"]], c["vfov"], c["roll"]))
