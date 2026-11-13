"""blender_previs.py — 用 Blender（Workbench 引擎）把预演 JSON 渲染成 mp4。与 render.mjs 读同一份 JSON。

用法：
  blender -b -P blender_previs.py -- previs.json out.mp4 [--clean] [--fps N] [--short-side N] [--keep-frames]

说明：
  - 时间求值复用同目录 previs_eval.py（与 three.js 版 previs_eval.cjs 逐帧数值一致），每一帧烘焙关键帧。
  - 坐标换算：预演 JSON 是 Y 轴向上（three.js），Blender 是 Z 轴向上：(x, y, z) → (x, -z, y)。
  - 叠字：镜头编号/时间用 Blender 的 Stamp（note 字段，逐帧更新）；角色名用朝向相机的文字对象。
    中文需要 CJK 字体：设置 PREVIS_FONT=/path/to/font.ttc，或自动查找常见系统字体；找不到时角色名改用 id。
  - 先渲染 PNG 序列再用 ffmpeg 合成（FFMPEG 环境变量 > PATH > imageio-ffmpeg）；没有 ffmpeg 时改用 Blender 自带的 FFMPEG 输出。
  - 实测：pip 版 bpy 4.2.0（python3.11 直接运行本脚本，等价于 blender -b -P）跑通示例；完整 Blender 应用与 3.x/5.x 未实测。
"""
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import previs_eval as PE  # noqa: E402


# ------------------------------------------------------------------ args
def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"clean": False, "fps": None, "short_side": None, "keep_frames": False}
    pos = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--clean":
            opts["clean"] = True
        elif a == "--keep-frames":
            opts["keep_frames"] = True
        elif a == "--fps":
            i += 1
            opts["fps"] = int(argv[i])
        elif a == "--short-side":
            i += 1
            opts["short_side"] = int(argv[i])
        else:
            pos.append(a)
        i += 1
    if len(pos) < 2:
        sys.exit("用法：blender -b -P blender_previs.py -- previs.json out.mp4 [--clean] [--fps N] [--short-side N]")
    return pos[0], pos[1], opts


# ------------------------------------------------------------------ helpers
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # three(Y-up) → blender(Z-up)


def v3b(p):
    return Vector((p[0], -p[2], p[1]))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h, alpha=1.0):
    h = (h or "#9aa0aa").lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def lighten(rgba, k):
    return tuple(c + (1 - c) * k for c in rgba[:3]) + (rgba[3],)


def new_obj(name, bm, color, parent=None, smooth=False):
    if smooth:
        for f in bm.faces:
            f.smooth = True
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.color = color
    if parent is not None:
        ob.parent = parent
    return ob


def bm_cube(bm, size, center=(0, 0, 0)):
    m = Matrix.Translation(Vector(center)) @ Matrix.Diagonal((size[0], size[1], size[2], 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def bm_cyl(bm, radius, depth, center=(0, 0, 0), segments=24, rot=None, radius2=None):
    m = Matrix.Translation(Vector(center)) @ (rot or Matrix.Identity(4))
    r2 = radius if radius2 is None else radius2
    try:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=r2, depth=depth, matrix=m)
    except TypeError:  # Blender < 3.0
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, diameter1=radius, diameter2=r2, depth=depth, matrix=m)


def bm_sphere(bm, radius, center=(0, 0, 0)):
    m = Matrix.Translation(Vector(center))
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, radius=radius, matrix=m)
    except TypeError:  # Blender < 3.0
        bmesh.ops.create_uvsphere(bm, u_segments=20, v_segments=12, diameter=radius, matrix=m)


def three_rot_to_blender(rot_x_deg, rot_y_deg):
    """three.js Euler('XYZ') 的 Rx·Ry 换到 Blender 坐标。"""
    r3 = Matrix.Rotation(math.radians(rot_x_deg), 3, "X") @ Matrix.Rotation(math.radians(rot_y_deg), 3, "Y")
    return (C @ r3 @ C.inverted()).to_4x4()


def find_cjk_font():
    cands = [os.environ.get("PREVIS_FONT", "")]
    cands += ["/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc", "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
              "/usr/share/fonts/google-noto-cjk/NotoSansCJK-Regular.ttc", "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
              "/System/Library/Fonts/PingFang.ttc", "/System/Library/Fonts/STHeiti Medium.ttc",
              "C:\\Windows\\Fonts\\msyh.ttc", "C:\\Windows\\Fonts\\simhei.ttf"]
    if shutil.which("fc-match"):
        try:
            out = subprocess.run(["fc-match", "-f", "%{file}", ":lang=zh"], capture_output=True, text=True, timeout=10).stdout
            cands.insert(1, out.strip())
        except (OSError, subprocess.SubprocessError):
            pass
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def find_ffmpeg():
    if os.environ.get("FFMPEG"):
        return os.environ["FFMPEG"]
    cands = []
    if shutil.which("ffmpeg"):
        cands.append(shutil.which("ffmpeg"))
    try:
        out = subprocess.run(["python3", "-I", "-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        if out:
            cands.append(out)
    except (OSError, subprocess.SubprocessError):
        pass
    best, best_key = None, None
    for exe in cands:
        try:
            ver = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=10).stdout
            enc = subprocess.run([exe, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=10).stdout
        except (OSError, subprocess.SubprocessError):
            continue
        m = re.search(r"ffmpeg version \D*(\d+)\.(\d+)", ver)
        key = ("libx264" in enc, int(m.group(1)) if m else 0, int(m.group(2)) if m else 0)
        if best_key is None or key > best_key:
            best, best_key = exe, key
    return best


# ------------------------------------------------------------------ build
def build(spec, opts):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    W, H, fps = spec["width"], spec["height"], spec["fps"]
    n = int(round(spec["duration"] * fps))
    scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = W, H, 100
    scene.render.fps, scene.render.fps_base = fps, 1.0
    scene.frame_start, scene.frame_end = 1, n
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "OBJECT"
    sh.show_shadows = True
    sh.show_object_outline = True
    for attr, val in (("render_aa", "FXAA"),):
        try:
            setattr(scene.display, attr, val)
        except (AttributeError, TypeError):
            pass
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("previs_world")
    world.color = hex_rgba(spec["scene"].get("background") or "#2a2e36")[:3]
    scene.world = world

    # 地面 + 网格
    g = spec["scene"]["ground"]
    if g:
        gs = g.get("size") or [24, 24]
        bm = bmesh.new()
        bm_cube(bm, (gs[0], gs[1], 0.02), (0, 0, -0.01))
        new_obj("ground", bm, hex_rgba(g.get("color")))
        if g.get("grid", True):
            bm = bmesh.new()
            size = int(round(max(gs)))
            for i in range(size + 1):
                c = -size / 2.0 + i
                bm_cube(bm, (0.012, size, 0.004), (c, 0, 0.002))
                bm_cube(bm, (size, 0.012, 0.004), (0, c, 0.002))
            new_obj("grid", bm, hex_rgba("#50555e"))

    # 静态几何体（position 为底面中心）
    for i, o in enumerate(spec["scene"]["objects"]):
        size = o.get("size") or [1, 1, 1]
        p = o.get("position") or [0, 0, 0]
        if len(p) == 2:
            p = [p[0], 0, p[1]]
        typ = o.get("type") or "box"
        bm = bmesh.new()
        if typ == "cylinder":
            h = size[1]
            bm_cyl(bm, size[0] / 2.0, h)  # create_cone 沿 blender Z（= three 的 Y）
            center3 = [p[0], p[1] + h / 2.0, p[2]]
        elif typ == "sphere":
            h = size[0]
            bm_sphere(bm, size[0] / 2.0)
            center3 = [p[0], p[1] + h / 2.0, p[2]]
        elif typ == "plane":
            h = size[1]
            # three PlaneGeometry 在 XY 平面（法线 +Z）→ blender 中是 XZ 平面的薄片
            bm_cube(bm, (size[0], 0.01, size[1]))
            center3 = [p[0], p[1], p[2]]
        else:
            h = size[1]
            depth = size[2] if len(size) > 2 else size[0]
            bm_cube(bm, (size[0], depth, size[1]))  # blender (x, y, z) = three (x, z, y)
            center3 = [p[0], p[1] + h / 2.0, p[2]]
        alpha = o.get("opacity", 1.0)
        ob = new_obj(o.get("id") or "obj%d" % i, bm, hex_rgba(o.get("color"), alpha))
        rx = o.get("rotX", 0) if typ == "plane" else 0
        ob.matrix_world = Matrix.Translation(v3b(center3)) @ three_rot_to_blender(rx, o.get("rotY", 0) or 0)

    # 角色：root 空物体（位置/朝向）+ 身体/头/鼻子/胸前标记/地面箭头；本地前方 = -Y
    font_path = find_cjk_font() if (spec["overlay"]["enabled"] and spec["overlay"]["names"]) else None
    font = bpy.data.fonts.load(font_path) if font_path else None
    actors = []
    for c in spec["characters"]:
        h, r = c["height"], 0.2
        body_h = h * 0.84
        col = hex_rgba(c["color"])
        root = bpy.data.objects.new("char_" + c["id"], None)
        scene.collection.objects.link(root)
        bm = bmesh.new()
        L = max(0.1, body_h - 2 * r)
        bm_cyl(bm, r, L, (0, 0, 0))
        bm_sphere(bm, r, (0, 0, L / 2))
        bm_sphere(bm, r, (0, 0, -L / 2))
        body = new_obj(c["id"] + "_body", bm, col, root, smooth=True)
        bm = bmesh.new()
        bm_sphere(bm, 0.12)
        head = new_obj(c["id"] + "_head", bm, lighten(col, 0.35), root, smooth=True)
        bm = bmesh.new()
        bm_cyl(bm, 0.045, 0.14, rot=Matrix.Rotation(math.radians(90), 4, "X"), radius2=0.0)  # 尖端指向 -Y
        nose = new_obj(c["id"] + "_nose", bm, hex_rgba("#f5f5f5"), root)
        bm = bmesh.new()
        bm_cube(bm, (0.16, 0.04, 0.16))
        chest = new_obj(c["id"] + "_chest", bm, hex_rgba("#f5f5f5"), root)
        chest.location = (0, -(r - 0.01), h * 0.68)
        bm = bmesh.new()
        vs = [bm.verts.new(v) for v in ((-0.16, -0.25, 0.01), (0.16, -0.25, 0.01), (0, -0.55, 0.01))]
        bm.faces.new(vs)
        new_obj(c["id"] + "_arrow", bm, col, root)
        label = None
        if spec["overlay"]["enabled"] and spec["overlay"]["names"]:
            cu = bpy.data.curves.new(c["id"] + "_label", "FONT")
            name = c["name"] if (font or all(ord(ch) < 128 for ch in c["name"])) else c["id"]
            cu.body = name
            cu.size = 0.09
            cu.align_x, cu.align_y = "CENTER", "BOTTOM"
            if font:
                cu.font = font
            label = bpy.data.objects.new(c["id"] + "_label", cu)
            scene.collection.objects.link(label)
            label.color = col
            label.parent = root
        actors.append({"c": c, "root": root, "body": body, "head": head, "nose": nose, "chest": chest, "label": label,
                       "body_h": body_h})

    cam_data = bpy.data.cameras.new("previs_cam")
    cam_data.sensor_fit = "VERTICAL"
    cam_data.clip_start, cam_data.clip_end = 0.05, 300
    cam = bpy.data.objects.new("previs_cam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.rotation_mode = "QUATERNION"
    for a in actors:
        if a["label"] is not None:
            con = a["label"].constraints.new("TRACK_TO")
            con.target, con.track_axis, con.up_axis = cam, "TRACK_Z", "UP_Y"

    # 逐帧烘焙
    prev_q = None
    for f in range(1, n + 1):
        t = (f - 1) / float(fps)
        for a in actors:
            st = PE.char_state(spec, a["c"]["id"], t)
            pf, h = st["poseFactor"], a["c"]["height"]
            a["root"].location = v3b(st["pos"])
            a["root"].rotation_euler = (0, 0, math.radians(st["yaw"]))
            a["root"].keyframe_insert("location", frame=f)
            a["root"].keyframe_insert("rotation_euler", frame=f)
            a["body"].scale = (1, 1, pf)
            a["body"].location = (0, 0, a["body_h"] / 2 * pf)
            a["head"].location = (0, 0, h * pf - 0.12)
            a["nose"].location = (0, -0.15, h * pf - 0.13)
            a["chest"].location = (0, -0.19, h * 0.68 * pf)
            for ob, path in ((a["body"], "scale"), (a["body"], "location"), (a["head"], "location"),
                             (a["nose"], "location"), (a["chest"], "location")):
                ob.keyframe_insert(path, frame=f)
            if a["label"] is not None:
                a["label"].location = (0, 0, h * pf + 0.12)
                a["label"].keyframe_insert("location", frame=f)
        cs = PE.camera_state(spec, t)
        p, lk = v3b(cs["pos"]), v3b(cs["look"])
        q = (lk - p).to_track_quat("-Z", "Y") @ Quaternion((0, 0, 1), math.radians(cs["roll"]))
        if prev_q is not None:
            q.make_compatible(prev_q)
        prev_q = q
        cam.location = p
        cam.rotation_quaternion = q
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_quaternion", frame=f)
        cam_data.angle_y = math.radians(cs["vfov"])
        cam_data.keyframe_insert("lens", frame=f)

    # 叠字：Stamp note 逐帧更新
    r = scene.render
    if spec["overlay"]["enabled"] and spec["overlay"]["shotInfo"]:
        r.use_stamp = True
        for attr in ("use_stamp_date", "use_stamp_time", "use_stamp_render_time", "use_stamp_frame", "use_stamp_frame_range",
                     "use_stamp_memory", "use_stamp_hostname", "use_stamp_camera", "use_stamp_lens", "use_stamp_scene",
                     "use_stamp_marker", "use_stamp_filename", "use_stamp_sequencer_strip", "use_stamp_labels"):
            if hasattr(r, attr):
                setattr(r, attr, False)
        r.use_stamp_note = True
        r.stamp_font_size = max(12, int(min(W, H) * 0.04))
        total = len(spec["shots"])

        def on_frame(scn, *_):
            tt = (scn.frame_current - 1) / float(fps)
            s = PE.shot_at(spec, tt)
            scn.render.stamp_note_text = "镜头 %s/%d %s  %.1fs/%.1fs [%s-%ss]" % (
                s["id"], total, s["label"], tt, spec["duration"], s["t"][0], s["t"][1])

        bpy.app.handlers.frame_change_pre.clear()
        bpy.app.handlers.frame_change_pre.append(on_frame)
    else:
        r.use_stamp = False
    return n


def render(out, n, fps, keep_frames):
    scene = bpy.context.scene
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ff = find_ffmpeg()
    if ff:
        tmp = tempfile.mkdtemp(prefix="previs_frames_")
        scene.render.image_settings.file_format = "PNG"
        scene.render.filepath = os.path.join(tmp, "f_####")
        bpy.ops.render.render(animation=True)
        enc = subprocess.run([ff, "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
        venc = (["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
                if "libx264" in enc else ["-c:v", "mpeg4", "-q:v", "5", "-pix_fmt", "yuv420p"])
        cmd = [ff, "-y", "-loglevel", "error", "-framerate", str(fps), "-start_number", "1",
               "-i", os.path.join(tmp, "f_%04d.png")] + venc + ["-frames:v", str(n), out]
        subprocess.run(cmd, check=True)
        if keep_frames:
            print("[previs] PNG 帧保留在", tmp)
        else:
            shutil.rmtree(tmp, ignore_errors=True)
    else:
        print("[previs] 未找到外部 ffmpeg，改用 Blender 内置 FFMPEG 输出")
        st = scene.render.image_settings
        if hasattr(st, "media_type"):  # Blender 5.x
            st.media_type = "VIDEO"
        st.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.filepath = out
        bpy.ops.render.render(animation=True)
    print("[previs] 完成", out)


def main():
    src, out, opts = parse_args()
    import json
    with open(src, encoding="utf-8") as f:
        raw = json.load(f)
    if opts["fps"]:
        raw["fps"] = opts["fps"]
    if opts["short_side"]:
        raw["shortSide"] = opts["short_side"]
        raw.pop("resolution", None)
    if opts["clean"]:
        raw["overlay"] = dict(raw.get("overlay") or {}, enabled=False)
    spec, errors, warnings = PE.normalize(raw)
    for w in warnings:
        print("[warn]", w)
    if errors:
        for e in errors:
            print("[error]", e)
        sys.exit(2)
    n = build(spec, opts)
    render(out, n, spec["fps"], opts["keep_frames"])


main()
