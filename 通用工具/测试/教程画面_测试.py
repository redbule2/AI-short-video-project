"""合成视频.py 的画面测试：
① label_side：标位「右」尖朝左、标签在框右边；「左」尖朝右、标签在框左边；
② 点位：鼠标点在框里的哪儿照「点位」走，不写就在正中偏下（0.5, 0.55）；
③ 角标：写了「角标」每一帧左下角都有红底小牌子，不写就没有。
跑法：python -I -X utf8 教程画面_测试.py（本机用 Codex 自带的 python）"""

import importlib.util
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent / "流水线教程"
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location("hecheng", TOOLS / "合成视频.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

fails = 0


def check(ok, what):
    global fails
    print(("通过  " if ok else "没过  ") + what)
    if not ok:
        fails += 1


# ① 旁边的标签：尖在哪一头
for side, tip_left in (("右", True), ("左", False)):
    im = mod.label_side("快，日常用", side)
    a = np.asarray(im.getchannel("A"))
    mid = im.height // 2
    tip_x = 1 if tip_left else im.width - 2      # 尖那一头的边上：只有中间一行是实的
    body_x = im.width - 2 if tip_left else 1     # 另一头是标签本身：中间实，顶上是圆角
    check(a[mid, tip_x] > 0 and a[2, tip_x] == 0 and a[mid, body_x] > 0,
          "标位「%s」：尖朝%s" % (side, "左" if tip_left else "右"))
check(mod.label_side("快", "右").size == mod.label_side("快", "左").size, "左右两种标签一样大")

# ② 点位：做一课只有一句、一张灰图的小课，看鼠标落在哪
root = Path(tempfile.mkdtemp())


def lesson(name, click, extra=None):
    d = root / name
    d.mkdir()
    Image.new("RGB", (1920, 1080), (60, 60, 60)).save(d / "截图_测试.png")
    (d / "框.json").write_text(json.dumps({"测试": {"图": "截图_测试.png", "宽": 1280, "高": 720, "倍数": 1.5,
                                                  "框": {"钮": [400, 300, 480, 60]}}}, ensure_ascii=False), encoding="utf-8")
    (d / "画面.json").write_text(json.dumps(dict({"系列": "测试", "课": "第 1 课", "标题": "测试", "行": [
        {"场": "图:测试", "动作": [{"看": "全", "时": 0}, dict({"点": "钮", "字": "点", "提前": 0}, **click)]}]}, **(extra or {})),
        ensure_ascii=False), encoding="utf-8")
    (d / "解说词.txt").write_text("点这里。\n", encoding="utf-8")
    L = mod.Lesson(str(d), trial=True)
    if extra:
        return L
    s = L.scenes[0]
    win = np.asarray(L.render_img_scene(s, s["click"][0][0] + 0.3)).astype(int)
    ys, xs = np.where(win.min(axis=2) > 240)   # 鼠标是白的，底图是灰的
    c = np.asarray(L.cur).astype(int)
    cy, cx = np.where((c[:, :, :3].min(axis=2) > 240) & (c[:, :, 3] > 200))   # 鼠标贴图里白色从哪开始
    k = mod.WW / 1280
    # 贴图左上角放在鼠标尖往左上 4 像素：鼠标尖 = 白色最左上 - 贴图里白色起点 + 4，再换回页面坐标
    return s["click"][0][2], (xs.min() - cx.min() + 4) / k, (ys.min() - cy.min() + 4) / k


fp, x, y = lesson("默认", {})
check(fp == [0.5, 0.55], "不写点位，存的是正中偏下")
check(abs(x - (400 + 480 * 0.5)) < 3 and abs(y - (300 + 60 * 0.55)) < 3, "不写点位，鼠标在框的正中偏下（%.0f, %.0f）" % (x, y))
fp, x, y = lesson("偏左", {"点位": [0.1, 0.5]})
check(fp == [0.1, 0.5], "写了点位，照存")
check(abs(x - (400 + 480 * 0.1)) < 3 and abs(y - (300 + 60 * 0.5)) < 3, "点位 [0.1, 0.5]：鼠标在框的左头（%.0f, %.0f）" % (x, y))



# ③ 角标：左下角那块（窗口左边、字幕那一行）有没有红底
def seal_px(L, t):
    fr = np.asarray(L.frame(t)).astype(int)
    y0 = mod.WY + mod.WH
    part = fr[y0:, mod.WX:mod.WX + 200]
    return int((np.abs(part - np.array(mod.SEAL)).sum(axis=2) < 30).sum())


with_mark = lesson("有角标", {}, {"角标": "飞拓内训"})
check(seal_px(with_mark, 0.5) > 2000 and seal_px(with_mark, with_mark.total - 1) > 2000, "写了角标：画面左下角有红底小牌子")
no_mark = lesson("没角标", {}, {"印": "案"})
check(seal_px(no_mark, 0.5) == 0, "没写角标：左下角什么都没有")

print("全部通过" if not fails else "没过 %d 条" % fails)
raise SystemExit(1 if fails else 0)
