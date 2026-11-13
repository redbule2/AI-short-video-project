# 其它引擎与源仓库原文

本 skill 默认的目标是 Seedance 2.5（即梦）＋中文提示词＋sd25-pe。目标换了，或要查源仓库的英文写法时，读这里。

## 一、引擎路由

| 目标 | 怎么办 |
|---|---|
| Seedance 2.5（即梦） | 默认流程：底稿 → 场景段，素材写法按 sd25-pe |
| Seedance 2.0 | 用已核实的 2.0 参考角色与引擎规则；下文源仓库的英文块骨架就是为它写的 |
| Cinema Studio | 正文 **512 字符硬顶**，每个 @Element 暗耗 80–100 字符；不变量移进 Elements 或 2000 字符以内的 Manual Style；**逐镜光源和走位只能进正文**。只吃正面句的版本（Cinema 3.0）把否定句改成正面锁：用"场景只包含参考图所示"代替"不要加家具" |
| 其它模型 | 只交模型中立的空间描写＋继承／排除清单 |

**图像模型特例**：某些图像模型（NBP）把城市、环境图当参考反而更差——地点走文字更稳。不要把 Seedance 的场景图经验外推到这些模型上。

## 二、源仓库的英文写法（英文提示词、Seedance 2.0 用）

源仓库的空间块分三种：

| 构件 | 含不含人 | 用途 | 在用户中文模板里对应 |
|---|---|---|---|
| GEO SPATIAL LAYOUT（`HELL-GRIND.md:151-191`） | 不含人 | 场景纯地图，源仓库做法是每次调用逐字复制 | 场景段（v6 改为翻译后再贴） |
| LOCATION MAP（块骨架的一个槽，`evals/cases/harvest.json` 六例） | 6 例里 5 例含当镜人物和行进方向 | 块骨架提示词里的空间槽，1–2 句 | 分镜各镜的画面构图 |
| Spatial Layout Block（seedance `SKILL.md:1095-1157`） | 含人 | 逐镜人物投影 | 分镜各镜的画面构图 |

六个 LOCATION MAP 实例（照抄，用来对齐英文语感）：

```
LOCATION MAP: The lamp post is the center anchor; @tall_traveler stands frame-left
of it, @short_traveler frame-right; neither crosses the central vertical axis.
```
```
LOCATION MAP: Bench runs horizontally; the taller figure stands frame-left, the
shorter frame-right; neither crosses the central vertical axis.
```
```
LOCATION MAP: Counter runs frame-left to frame-right; the window sits behind the
counter; @lead stands at the counter's center mark.
```
```
LOCATION MAP: The spiral stair enters frame-left; the lamp assembly occupies the
center platform; the desk sits against the seaward window frame-right. The keeper
moves left to right across the platform.
```
```
LOCATION MAP: The gate sits frame-left; the raked bed runs diagonally toward
frame-right; the gardener works away from camera.
```
```
LOCATION MAP: Stalls run in a single aisle toward a far door; the vendor works the
second stall frame-left.
```

共同点：短（1–2 句）· 一个 center anchor · 一律 frame-left／frame-right · 带 crossing rule。注意它们是**逐镜**写的，所以可以用画面左右；中文场景段是跨镜复用的，不能这样写。

其它源仓库原句：

- 环境参考：`STYLE REFERENCE ONLY, not a fixed keyframe; the model extends the world`。v5 称之为"官方措辞"，出处其实是源仓库的 `seedance-2-5/SKILL.md`，不是 sd25-pe。中文提示词按 sd25-pe 写，见 SKILL.md §七。
- 机位侧：`camera ALWAYS stays on the corpse-field side — NEVER crosses`。
- 运动方向：`screen-left to screen-right, locked`（源仓库认为 `locked` 是起作用的那个词）。
- 锚点：`The lamp post is the center anchor`。

## 三、源仓库的其它经验（Seedance 2.5 上未验证）

- **跨镜追踪**：Seedance 2.x 跨 CUT 最多稳定追踪约 3 名具名角色。这是 2.0 时代的经验；sd25-pe 给 2.5 的推荐是 1–8 个主体。v6 起四名以上不报阻断，见 `shot-checks.md` §6。
- **续接链**：约 2 条封顶（硬顶 3），之后从原始锚点重开；扩展要匹配源视频的分辨率和时长。
- **回喂尾段**：回喂成片**最后 3–4 秒视频**，优于回喂静帧——姿势、取景、光、运动一起继承。用在 2.5 上时，按 sd25-pe 把它写成参考视频的职责。
- **开场定场**：一次调用多个 CUT 时，开场约一秒给人物都已就位的全景、动作先压住（可以有一声短短的"嗯"或上一句的尾音，不是绝对静音），后续 CUT 不容易换位；只稳定同一次调用内的镜头。写进中文提示词时不写秒数。
- **中文字数**：源仓库有"中文 1800 字上限裁剪时，空间段是第二优先被裁的"一说。出处没注明，而且和 sd25-pe 的"不设固定字数上限"冲突，主流程不采用。如果这是某个平台输入框的真实限制，注明是哪个平台后再用。

## 四、反打与多视图工具（平台相关）

- **3D Mode**：从同一张 Hero Frame 出反打或过肩。
- **五视图地点表**（资产阶段一次预生成全角度）：正面全景／左侧透视／右侧透视／反打对向视图／环境细节特写；用 Grid Generation 或 3D Mode 同一个 seed 出，保证光和材质一致。
