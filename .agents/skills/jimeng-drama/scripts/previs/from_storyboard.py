#!/usr/bin/env python3
"""从分镜片段半自动生成预演 JSON 草稿（只用标准库）。

用法：
  python3 from_storyboard.py <镜头表.json> <片段id> [-o previs/E01/S03.previs.json]
         [--characters 角色表.json] [--fps 24] [--short-side 480]

输入是按 examples/standoff.storyboard.json 格式手写的临时镜头表：
  {"ratio", "segments": [{"id", "duration", "cast": [角色id], "shots": [{"t", "size", "angle", "move", "action", "dialogue": [{"who"}]}]}]}
角色表可选（格式见 examples/standoff.characters.json），只用来把 id 映射成显示名；
cast 直接写中文名时可以不给。

规则（详见 references/previs/previs.md）：
  - cast → 角色胶囊体：1 人居中面向 +Z；2 人沿 X 轴相距 1.2m 面对面；3 人以上在 -Z 侧弧形站位面向圆心。
    镜头一律放在 +Z 一侧（守 180° 轴线），背景墙在 z=-3.2。
  - 主体：台词 who > 动作里首个出现的角色名 > cast[0]；全景/远景/双人取全体中心；"反打"在两人间切换。
  - size → 画面高度 & 焦距 → 相机距离；angle → 仰俯角/方位/过肩/主观；move → 首尾关键帧差异。
产出只是草稿：Agent 应再用 `node render.mjs x.json --report` / `--stills` 检查后手工微调。
"""
import argparse
import json
import math
import os
import re
import sys

DIAG = math.hypot(36, 24)

# 景别：画面高度(米，在主体处) / 等效焦距(mm) / 注视部位。按关键词长度优先匹配。
SIZES = [
    ("大远景", 14.0, 24, "waist"), ("远景", 6.0, 24, "waist"), ("中全景", 1.8, 35, "chest"),
    ("全景", 2.4, 28, "waist"), ("中近景", 0.95, 50, "chest"), ("中景", 1.25, 35, "chest"),
    ("近景", 0.7, 50, "neck"), ("大特写", 0.18, 100, "head"), ("特写", 0.36, 85, "head"),
]
GROUP_SIZES = ("大远景", "远景", "全景", "中全景")
PALETTE = ["#e2574c", "#3b82f6", "#22c55e", "#eab308", "#a855f7", "#f97316", "#14b8a6", "#ec4899"]


def vfov_from_focal(focal, aspect):
    half_diag = math.atan(DIAG / (2 * focal))
    return 2 * math.degrees(math.atan(math.tan(half_diag) / math.sqrt(1 + aspect * aspect)))


def focal_from_vfov(vfov, aspect):
    half_diag = math.atan(math.tan(math.radians(vfov) / 2) * math.sqrt(1 + aspect * aspect))
    return DIAG / 2 / math.tan(half_diag)


def parse_ratio(r):
    m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$", str(r or "9:16"))
    return float(m.group(1)) / float(m.group(2)) if m else 9 / 16


def match_size(text):
    for name, fh, focal, part in SIZES:
        if name in text:
            return name, fh, focal, part
    return "中景", 1.25, 35, "chest"


def dist_for(frame_h, focal, aspect):
    return (frame_h / 2) / math.tan(math.radians(vfov_from_focal(focal, aspect)) / 2)


def yaw_dir(yaw):
    return (math.sin(math.radians(yaw)), math.cos(math.radians(yaw)))


def r2(x):
    return round(x, 3)


def layout(cast_ids):
    """返回 {id: (x, z, yaw, face)}；镜头侧为 +Z。"""
    n = len(cast_ids)
    out = {}
    if n == 1:
        out[cast_ids[0]] = (0.0, 0.0, 0.0, None)
    elif n == 2:
        a, b = cast_ids
        out[a] = (-0.6, 0.0, 90.0, b)
        out[b] = (0.6, 0.0, -90.0, a)
    else:
        R = 1.4
        for i, cid in enumerate(cast_ids):
            th = math.radians(-70 + 140 * i / (n - 1))
            x, z = R * math.sin(th), -R * math.cos(th)
            yaw = math.degrees(math.atan2(-x, -z))  # 面向圆心
            out[cid] = (x, z, yaw, None)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("storyboard")
    ap.add_argument("segment")
    ap.add_argument("-o", "--out")
    ap.add_argument("--characters", help="可选角色表 JSON（{\"characters\": [{\"id\", \"name\"}]}），把 id 映射成显示名")
    ap.add_argument("--fps", type=int, default=24)
    ap.add_argument("--short-side", type=int, default=480)
    a = ap.parse_args()

    sb = json.load(open(a.storyboard, encoding="utf-8"))
    seg = next((s for s in sb.get("segments", []) if s.get("id") == a.segment), None)
    if not seg:
        sys.exit("找不到片段 %s；可选：%s" % (a.segment, ", ".join(s.get("id", "?") for s in sb.get("segments", []))))
    ratio = sb.get("ratio") or "9:16"
    aspect = parse_ratio(ratio)
    duration = float(seg.get("duration") or (seg["shots"][-1]["t"][1] if seg.get("shots") else 0))

    # 角色名
    names = {}
    chars_path = a.characters
    if chars_path and os.path.exists(chars_path):
        try:
            for c in json.load(open(chars_path, encoding="utf-8")).get("characters", []):
                names[c["id"]] = c.get("name") or c["id"]
                for al in c.get("aliases") or []:
                    names.setdefault("alias:" + al, c["id"])
        except (ValueError, KeyError) as e:
            print("[warn] 读取 %s 失败：%s" % (chars_path, e), file=sys.stderr)
    cast = []
    for look in seg.get("cast") or []:
        cid = str(look).split(".")[0]
        if cid not in cast:
            cast.append(cid)
    if not cast:
        print("[warn] 片段没有 cast，放一个占位角色 actor", file=sys.stderr)
        cast = ["actor"]
    pos = layout(cast)

    characters = []
    for i, cid in enumerate(cast):
        x, z, yaw, face = pos[cid]
        key = {"t": 0, "pos": [r2(x), 0, r2(z)]}
        if face:
            key["face"] = face
        else:
            key["yaw"] = r2(yaw)
        characters.append({"id": cid, "name": names.get(cid, cid), "color": PALETTE[i % len(PALETTE)], "height": 1.7, "keys": [key]})
    char_keys = {c["id"]: c["keys"] for c in characters}

    def mentioned(text):
        hits = []
        for cid in cast:
            for token in (names.get(cid), cid):
                if token and token in text:
                    hits.append((text.index(token), cid))
                    break
        return [cid for _, cid in sorted(hits)]

    def other(cid):
        rest = [c for c in cast if c != cid]
        return rest[0] if rest else None

    def char_xz_yaw(cid):
        """角色当前位置（含此前镜头里加的走位）与朝向。"""
        _, _, yaw, face = pos[cid]
        p = char_keys[cid][-1]["pos"]
        x, z = p[0], p[2]
        if face:
            fp = char_keys[face][-1]["pos"]
            if abs(fp[0] - x) + abs(fp[2] - z) > 1e-6:
                yaw = math.degrees(math.atan2(fp[0] - x, fp[2] - z))
        return x, z, yaw

    shots = []
    prev_subject = None
    for idx, sh in enumerate(seg.get("shots") or []):
        t0, t1 = float(sh["t"][0]), float(sh["t"][1])
        size_t, angle_t, move_t, action_t = (str(sh.get(k) or "") for k in ("size", "angle", "move", "action"))
        alltext = " ".join((size_t, angle_t, move_t, action_t))
        speakers = [d.get("who") for d in sh.get("dialogue") or [] if d.get("who") in cast]
        size_name, frame_h, focal, part = match_size(size_t + angle_t)
        group = any(g == size_name for g in GROUP_SIZES) or "双人" in alltext or "两人" in alltext

        if "反打" in alltext and prev_subject and len(cast) == 2 and not speakers:
            subject = other(prev_subject)
        else:
            subject = (speakers or mentioned(action_t) or [cast[0]])[0]
        if group and len(cast) > 1:
            look = ["%s:%s" % (c, part) for c in cast]
            ref = "world"
        else:
            look = "%s:%s" % (subject, part)
            ref = "target"

        ots = ("过肩" in alltext or "正打" in alltext or "反打" in alltext) and len(cast) >= 2 and not group
        pov = ("主观" in alltext or "POV" in alltext.upper()) and len(cast) >= 2
        elev = 5.0 if group else 0.0
        if re.search(r"大俯|鸟瞰|顶拍|顶视|俯瞰", alltext):
            elev = 70.0
        elif re.search(r"俯", alltext):
            elev = 28.0
        elif re.search(r"大仰|极低", alltext):
            elev = -40.0
        elif re.search(r"仰|低角度|低机位", alltext):
            elev = -18.0
        azim = 25.0
        if re.search(r"背面|背后|背影", alltext):
            azim = 165.0
        elif re.search(r"侧面|侧拍|侧脸|侧身", alltext):
            azim = 90.0
        elif re.search(r"斜侧|四分之三|3/4", alltext):
            azim = 40.0
        elif "正面" in alltext:
            azim = 0.0
        roll = 12.0 if re.search(r"荷兰|倾斜|斜构图", alltext) else 0.0

        # 选择方位角符号：让相机落在 +Z（镜头侧）
        def side_sign(cid, az):
            if ref == "world":
                return 1
            x, z, yaw = char_xz_yaw(cid)
            zp = z + math.cos(math.radians(yaw + az))
            zn = z + math.cos(math.radians(yaw - az))
            return 1 if zp >= zn - 1e-9 else -1

        cam = {}
        if pov:
            src = other(subject)
            # 机位放在观察者眼睛前 0.3m，避免看到自己的头/鼻锥
            ox, oz, _ = char_xz_yaw(src)
            tx, tz, _ = char_xz_yaw(subject)
            dd = math.hypot(tx - ox, tz - oz) or 1
            cam = {"pos": "%s:eyes" % src, "posOffset": [r2((tx - ox) / dd * 0.3), 0, r2((tz - oz) / dd * 0.3)],
                   "lookAt": "%s:head" % subject, "focal": 35, "roll": roll}
            frame_desc = "主观"
        elif ots:
            shoulder = other(subject)
            sx, sz, syaw = char_xz_yaw(shoulder)
            fx, fz = yaw_dir(syaw)
            # 前景角色肩后 0.9m、向镜头侧（+Z）偏 0.3m、略低于眼高；pos 用 follow 跟随前景角色。
            # 竖屏水平视角窄：焦距限制在 35–50mm，并把注视点往前景角色一侧偏，保证前景肩头入画。
            rx, rz = -fz, fx  # 前景角色的右手方向（forward × up）
            lat = 0.3 if rz >= -1e-9 else -0.3
            off = [r2(-fx * 0.9 + rx * lat), r2(1.7 * 0.88), r2(-fz * 0.9 + rz * lat)]
            f = 50 if frame_h <= 0.95 else 35
            # 构图：让前景角色的头落在画面水平 ±0.8 处，主体留在另一侧（主体不出 ±0.6）
            cx, cz = sx + off[0], sz + off[2]
            bx, bz, _ = char_xz_yaw(subject)
            ang_a = math.atan2(sx - cx, sz - cz)
            ang_b = math.atan2(bx - cx, bz - cz)
            hh = math.atan(math.tan(math.radians(vfov_from_focal(f, aspect)) / 2) * aspect)
            sep = math.atan2(math.sin(ang_a - ang_b), math.cos(ang_a - ang_b))
            sgn = 1 if sep >= 0 else -1
            axis = ang_a - sgn * math.atan(0.8 * math.tan(hh))
            lim = math.atan(0.6 * math.tan(hh))
            axis = ang_b + max(-lim, min(lim, axis - ang_b))
            db = math.hypot(bx - cx, bz - cz)
            look_off = [r2(cx + math.sin(axis) * db - bx), -0.05, r2(cz + math.cos(axis) * db - bz)]
            cam = {"pos": off, "follow": shoulder, "lookAt": "%s:head" % subject,
                   "lookOffset": look_off, "focal": f, "roll": roll}
            frame_desc = "过肩"
        else:
            dist = dist_for(frame_h, focal, aspect)
            if group and len(cast) > 1:
                # 多人：保证横向站位宽度（+1m 余量）也能装下
                xs = [char_xz_yaw(c)[0] for c in cast]
                zs = [char_xz_yaw(c)[1] for c in cast]
                spread = max(max(xs) - min(xs), max(zs) - min(zs)) + 1.0
                hfov = math.atan(math.tan(math.radians(vfov_from_focal(focal, aspect)) / 2) * aspect)
                dist = max(dist, spread / 2 / math.tan(hfov))
            az = azim * (side_sign(subject, azim) if ref == "target" else 1)
            if group:
                az = 0.0 if azim == 25.0 else azim
            cam = {"lookAt": look, "sph": {"dist": r2(dist), "azim": r2(az), "elev": r2(elev), "ref": ref}, "focal": focal, "roll": roll}
            frame_desc = size_name

        k0 = json.loads(json.dumps(cam))
        k1 = json.loads(json.dumps(cam))
        extra_keys = []
        shake = 0.0
        ease = "inOut"
        mv = move_t
        speed = 0.75 if re.search(r"缓|慢", mv) else (0.45 if re.search(r"快|急|猛|冲", mv) else 0.6)
        if re.search(r"快|急|猛|冲", mv):
            ease = "in"
        target_size = re.search(r"[至到成](大远景|远景|中全景|全景|中近景|中景|近景|大特写|特写)", mv)

        def scale_dist(k, factor):
            if "sph" in k:
                k["sph"]["dist"] = r2(k["sph"]["dist"] * factor)
            elif "pos" in k and isinstance(k["pos"], str):
                # 主观镜头：沿观察者→主体方向前移
                ox, oz, _ = char_xz_yaw(k["pos"].split(":")[0])
                tx, tz, _ = char_xz_yaw(subject)
                dd = math.hypot(tx - ox, tz - oz) or 1
                step = 0.3 + max(0.0, dd - 0.6) * (1 - factor)
                k["posOffset"] = [r2((tx - ox) / dd * step), 0, r2((tz - oz) / dd * step)]
            elif "pos" in k and isinstance(k["pos"], list):
                # pos 模式：沿视线方向移动（用 posOffset 表示，近似）
                tx, tz = char_xz_yaw(subject)[:2]
                base = k["pos"]
                fol = char_xz_yaw(k["follow"])[:2] if k.get("follow") else (0, 0)
                px, pz = base[0] + fol[0], base[2] + fol[1]
                k["posOffset"] = [r2((tx - px) * (1 - factor)), 0, r2((tz - pz) * (1 - factor))]

        if re.search(r"希区柯克|滑动变焦", mv):
            scale_dist(k1, 0.5)
            k1["focal"] = round(k0["focal"] * 0.5)
        elif re.search(r"变焦|zoom", mv, re.I):
            k1["focal"] = round(min(135, k0["focal"] * (1.0 / speed)))
        elif re.search(r"推|拉近", mv):
            factor = speed
            if target_size and "sph" in k1:
                _, fh2, f2, p2 = match_size(target_size.group(1))
                factor = dist_for(fh2, k0.get("focal", 35), aspect) / k0["sph"]["dist"]
                if not group:
                    k1["lookAt"] = "%s:%s" % (subject, p2)
            scale_dist(k1, factor)
        elif re.search(r"拉(?!近)", mv):
            factor = 1 / speed
            if target_size and "sph" in k1:
                _, fh2, f2, p2 = match_size(target_size.group(1))
                factor = dist_for(fh2, k0.get("focal", 35), aspect) / k0["sph"]["dist"]
            scale_dist(k1, factor)
        if re.search(r"环绕|环拍|绕", mv) and "sph" in k1:
            span = 360.0 if re.search(r"360|一周|一圈", mv) else (180.0 if "半" in mv else 90.0)
            k1["sph"]["azim"] = r2(k0["sph"]["azim"] + span * (-1 if "逆" in mv else 1))
        if re.search(r"升", mv.replace("升格", "")) and "sph" in k1:
            k0["sph"]["elev"], k1["sph"]["elev"] = k0["sph"]["elev"], r2(max(k0["sph"]["elev"], 0) + 35)
            k1["sph"]["dist"] = r2(k1["sph"]["dist"] * 1.2)
        elif re.search(r"降|下降|落幅", mv) and "sph" in k1:
            k0["sph"]["elev"] = r2(k1["sph"]["elev"] + 35)
        lateral = 1.0 * (0.5 if re.search(r"缓|慢|轻", mv) else 1.0)
        right_sign = -1 if "左" in mv else 1
        if re.search(r"摇", mv) and not re.search(r"摇晃|甩|快摇|急摇", mv):
            if re.search(r"上摇|仰摇", mv):
                k0["lookOffset"] = [0, -1.0, 0]
            elif re.search(r"下摇|俯摇", mv):
                k0["lookOffset"] = [0, 1.0, 0]
            else:
                k0["lookOffset"] = ["@right", -right_sign * lateral * 1.5]
        if re.search(r"横移|平移|侧移|左移|右移|移镜|(?<!跟)移(?!动)", mv):
            k0["lookOffset"] = ["@right", -right_sign * lateral * 1.2]
            k0["posOffset"] = ["@right", -right_sign * lateral * 1.2]
        if re.search(r"跟", mv):
            # 主体沿面向方向走 2m，sph 相机自动跟随
            x, z, yaw = char_xz_yaw(subject)
            dx, dz = yaw_dir(yaw)
            keys = char_keys[subject]
            last = keys[-1]
            keys.append({"t": t0, "pos": last["pos"]})
            keys.append({"t": t1, "pos": [r2(last["pos"][0] + dx * 2), 0, r2(last["pos"][2] + dz * 2)], "ease": "linear"})
            ease = "linear"
        if re.search(r"手持|晃|抖|呼吸", mv + angle_t):
            shake = 0.3 if re.search(r"轻|微", mv + angle_t) else 0.6
        if re.search(r"甩|快摇|急摇", mv):
            src = other(subject)
            k_whip = json.loads(json.dumps(k0))
            k_whip["lookAt"] = ("%s:head" % src) if src else k0["lookAt"]
            if not src:
                k_whip["lookOffset"] = ["@right", -3.0]
            k_whip["t"] = t0
            k_land = json.loads(json.dumps(k0))
            k_land["t"] = r2(min(t1, t0 + 0.3))
            extra_keys = [k_whip, k_land]

        # 解析 "@right" 偏移：转成相机右方向的世界坐标
        def resolve_offsets(k, ref_k):
            for fld in ("lookOffset", "posOffset"):
                v = k.get(fld)
                if isinstance(v, list) and v and v[0] == "@right":
                    tx, tz = char_xz_yaw(subject)[:2] if not group else (0.0, 0.0)
                    if "sph" in ref_k:
                        s = ref_k["sph"]
                        yaw = 0.0 if s.get("ref") == "world" else char_xz_yaw(subject)[2]
                        A = math.radians(yaw + s["azim"])
                        cx, cz = tx + math.sin(A) * s["dist"], tz + math.cos(A) * s["dist"]
                    else:
                        cx, cz = tx, tz + 3
                    fx, fz = tx - cx, tz - cz
                    n = math.hypot(fx, fz) or 1
                    rx, rz = -fz / n, fx / n  # forward × up
                    k[fld] = [r2(rx * v[1]), 0, r2(rz * v[1])]

        for k in [k0, k1] + extra_keys:
            resolve_offsets(k, k0)
        if extra_keys:
            k1["u"] = 1
            keys_out = extra_keys + [k1]
        else:
            k0["u"], k1["u"] = 0, 1
            keys_out = [k0, k1] if k0 != {**k1, "u": 0} else [k0]
        label = " ".join(x for x in (size_t, angle_t if angle_t not in ("平视",) else "", move_t if move_t not in ("固定", "静止") else "") if x).strip()
        shots.append({
            "id": str(idx + 1), "t": [t0, t1], "label": label or frame_desc,
            "src": {"size": size_t, "angle": angle_t, "move": move_t, "action": action_t, "subject": subject},
            "camera": {"ease": ease, "shake": shake, "keys": keys_out},
        })
        prev_subject = subject

    previs = {
        "version": 1, "id": seg["id"], "ratio": ratio, "fps": a.fps, "shortSide": a.short_side, "duration": duration,
        "source": {"storyboard": os.path.relpath(a.storyboard), "segment": seg["id"], "beat": seg.get("beat", "")},
        "overlay": {"enabled": True, "shotInfo": True, "names": True, "timeline": True},
        "scene": {
            "id": seg.get("scene"), "background": "#2a2e36",
            "ground": {"size": [24, 24], "color": "#6b6f78", "grid": True},
            "objects": [
                {"id": "back_wall", "type": "box", "size": [8, 3, 0.2], "position": [0, 0, -3.2], "color": "#8b8f99", "label": "墙"},
            ],
        },
        "characters": characters,
        "shots": shots,
    }
    text = json.dumps(previs, ensure_ascii=False, indent=2)
    if a.out:
        os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
        open(a.out, "w", encoding="utf-8").write(text + "\n")
        print("[previs] 草稿已写出：%s（%d 镜头，%d 角色）" % (a.out, len(shots), len(characters)), file=sys.stderr)
    else:
        print(text)


if __name__ == "__main__":
    main()
