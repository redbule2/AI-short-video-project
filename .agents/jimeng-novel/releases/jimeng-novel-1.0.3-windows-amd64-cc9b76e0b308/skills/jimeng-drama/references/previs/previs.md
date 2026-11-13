# 白模预演

几何体白模视频，作为参考视频教视频模型运镜和切镜节奏，不提供画面、人物和颜色。渲染不花积分。

用户要求预演或「教模型运镜」时做。用户没提时，遇到复杂运镜（环绕、升降、跟拍、甩镜、推拉加横移）、多人走位、文字反复拍错机位的段主动提议，这些是文字最难兑现的地方；固定机位的对话不必预演，只多占一个参考名额。模型的视频参考上限为 0（看 `model describe`）就不支持。

## 流程

```
1. 照 <skill>/scripts/previs/examples/standoff.storyboard.json 的格式，把这一段写成临时镜头表 previs/E01/S03.shots.json
2. python3 <skill>/scripts/previs/from_storyboard.py previs/E01/S03.shots.json S03 -o previs/E01/S03.previs.json
3. node <skill>/scripts/previs/render.mjs previs/E01/S03.previs.json --report      # 纯计算：每镜头首/中/尾的机位和入画
4. node <skill>/scripts/previs/render.mjs previs/E01/S03.previs.json --stills previs/E01/stills/S03   # 每镜头 3 张 PNG
5. 微调 previs.json，重复 3–4
6. node <skill>/scripts/previs/render.mjs previs/E01/S03.previs.json -o previs/E01/S03.review.mp4   # 带叠字，发给用户审运镜
7. 用户认可后：node <skill>/scripts/previs/render.mjs previs/E01/S03.previs.json --clean -o previs/E01/S03.mp4   # 挂载版
```

审片版带叠字，方便用户对上镜头号和时间；挂给模型的必须是 `--clean` 版（见「挂到视频节点」）。用户认可运镜不等于同意付费，出视频照样按铁律 1 报价。

镜头表是 `shots/E01.md` 里这一段的结构化抄写：`ratio`，`segments[]` 一项，含 `id`、`duration`、`cast`（角色列表，直接写「女主」这类名字最省事）、`shots[]`（每镜头 `t: [起, 止]`、`size` 景别、`angle`、`move`、`action`、`dialogue: [{"who"}]`）。脚本认常规中文镜头词；cast 用英文 id 时加 `--characters` 映射显示名（见 examples/standoff.characters.json）。也可以照 examples/standoff.previs.json 直接手写。

脚本产出是草稿：两人沿 X 轴面对面相距 1.2m，相机在 +Z 一侧（守 180° 轴线），主体按说话人 > 动作里先出现的角色 > cast 第一个，`src` 字段留着原始描述供对照。看 report 和 stills 时查：主体的头在画内，过肩镜头的前景角色在画面边缘；出现 `⚠相机在身体内` 就调 azim/dist 或挪人；正反打两镜里两人左右位置不变（否则越轴）；镜头时长和分镜一致、首尾相接，最后一镜结束于 `duration`（对不上时 render.mjs 打 `[warn]`，节奏会错位）。

怎么读画面：灰色胶囊体是角色，头上的白色鼻锥指向面朝的方向，胸前白块标出正面，脚下箭头也指朝向；叠字左上是镜头号、label 和时间，底部是镜头时间轴，头顶是角色名。

## 预演 JSON

米和秒，Y 轴向上，地面 y=0；`yaw` 度数，0 面向 +Z，90 面向 +X。

- 顶层：`id`、`ratio`、`fps`、`shortSide`（默认 480，或 `resolution: [w, h]`）、`duration`、`overlay`、`scene`、`characters`、`shots`。
- `scene.objects[]`：`type` 为 box / cylinder / sphere / plane；`size` 对 box 是 [x 宽, y 高, z 深]，cylinder [直径, 高]，sphere [直径]；`position` 是底面中心；可选 `rotY`、`opacity`、`label`。家具墙门用 box，地面网格提供运动视差，宜保留。
- `characters[].keys[]`：`t`（段内秒）、`pos`（[x,y,z] 或 [x,z]）、`yaw` 或 `face`（角色 id 或点）、`pose`（stand / sit / crouch / kneel / lie，只改高度）、`ease`。缺省沿用上一个 key，两 key 之间插值就是走位。
- `shots[].camera.keys[]`：
  - 时间 `t`（绝对秒）或 `u`（镜头内 0–1），都不写就均匀分布。
  - `lookAt`：点、`"角色id:部位"`（head/eyes/neck/shoulder/chest/waist/hip/knee/feet，默认 chest），或锚点数组（取中点，双人镜头用）。
  - 机位二选一。`sph: {dist, azim, elev, ref}` 绕注视目标：azim=0 是目标正面，正值绕到目标左手侧；elev 正值为俯；ref 默认 `"target"` 跟角色朝向，`"world"` 时 0 为 +Z。`pos` 是世界坐标或 `"角色id:eyes"`（主观）；加 `follow: "角色id"` 时是相对该角色脚底的偏移，过肩镜头这样写。
  - `lookOffset` / `posOffset` 做摇和移；`focal` 等效焦距（mm，横竖屏通用）或 `fov` 垂直视角；`roll` 画面倾斜。
  - `ease`：inOut（默认）/ linear / in / out / hold；镜头级 `shake` 0–1 是手持强度。
  - 相邻 key 都用 sph 时按 dist/azim/elev 分别插值，azim 0→270 就是真实环绕；否则直线插值。镜头之间硬切。

## 景别、角度、运镜

距离 = (主体处画面高 / 2) / tan(垂直 FOV / 2)。脚本的取值（主体处画面高 / 焦距 / 注视部位）：大远景 14m/24/waist，远景 6m/24/waist，全景 2.4m/28/waist，中全景 1.8m/35/chest，中景 1.25m/35/chest，中近景 0.95m/50/chest，近景 0.7m/50/neck，特写 0.36m/85/head，大特写 0.18m/100/head。9:16 下中景约 1.2m、特写约 0.8m；16:9 同景别距离约为 1.75 倍。

- 仰俯 elev：平视 0（全景以上 5），俯 28，鸟瞰 70，仰 -18，大仰 -40；荷兰角 roll 12。
- 方位 azim：默认 ±25（取落在 +Z 侧的符号），斜侧 40，侧面 90，背面 165。
- 过肩：机位在前景角色肩后 0.9m、向镜头侧偏 0.3m、高约 1.5m，焦距 50（中景以上 35），`follow` 前景角色。主观镜头 `pos` 取另一角色的 eyes。

| 运镜 | 首 key → 尾 key |
|---|---|
| 推 / 拉 | `sph.dist` ×0.6 / ×1.67（缓 ×0.75 / ×1.33，急推 ×0.45 且 ease=in） |
| 左右摇 | 机位不动，首 key `lookOffset` 偏到反方向约 1.5m，尾 key 归零；上下摇用 `[0, ±1, 0]` |
| 横移 | 首 key `posOffset` 和 `lookOffset` 同一横向偏移约 1.2m，尾 key 归零 |
| 跟 | 角色加两个 key 沿面向走约 2m，相机 `sph`（ref=target）自动跟，ease=linear；背后跟 azim≈165 |
| 升 / 降 | `sph.elev` 0→35 且 dist ×1.2；降反过来 |
| 环绕 | `sph.azim` +90（半圈 +180，一周 +360，逆时针取负） |
| 手持 / 甩 | `shake` 0.6（轻微 0.3）；甩是首 key 看另一角色，0.3 秒后看主体 |
| 变焦 / 希区柯克 | 只改 `focal`；dist ×0.5 同时 focal ×0.5 |

## 渲染与依赖

- `render.mjs` 需要 Node 18+、Playwright、Chromium（`npx playwright install chromium`，或 `--chrome` / `PREVIS_CHROME` 指定）、带 libx264 的 ffmpeg（`FFMPEG` 指定）。three.js 已打包在 `vendor/`，离线可用。常用参数 `--clean`、`--fps`、`--short-side`、`--crf`。
- mp4 逐帧截图再编码，长片段可能超过单条命令时限：放后台跑、stderr 写日志，看「渲染 i/n」判断进度；只看运镜时调低 fps 和分辨率。
- 没有 Playwright 或浏览器时退出码 3，留下自包含的 `<out>.html`（也可 `--html` 直接生成），浏览器打开能播放、点「录制 webm」导出。
- Blender 备选：`blender -b -P <skill>/scripts/previs/blender_previs.py -- x.previs.json out.mp4 [--clean]`，中文名需 CJK 字体（`PREVIS_FONT`）。没有 Node 时 `python3 <skill>/scripts/previs/previs_eval.py x.previs.json` 也能校验并打印各镜头相机位置。

## 挂到视频节点

`--ref 预演=file:previs/E01/S03.mp4`，prompt 里写「仅参考{{预演}}的镜头运动轨迹、景别变化与节奏，不继承其画面、人物造型、颜色和文字」。不这样限定，模型会把灰色胶囊体、网格地面和叠字画进视频，`--clean` 也是为此。人物、场景、服装仍由角色图和场景图决定，拼法见 `shots/prompt-anatomy.md`。

预演占一个参考视频名额，受时长、尺寸、帧率限制；超额时保留更关键的，或把预演裁到只覆盖复杂运镜那几秒并在 prompt 写明对应时间。时长和比例与片段一致。
