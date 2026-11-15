---
name: deepseek
description: 调 DeepSeek 要第二意见或审稿，模型默认 deepseek-flash（--model deepseek-v4-pro 可换）。用户要让 DeepSeek 审、评、看图，或者要做重要判断、想要一个非 Claude 的独立意见时使用。不要自己临时写 curl 或 Python 去调 API。
---

# DeepSeek 通道（项目内副本）

2026-11-07 用户同意后，从全局 deepseek 技能和 `E:/ai-bridge` 复制进来。`ds.sh`、`deepseek.py` 原样复制，只改了两处：
- 密钥仍读 `E:/ai-bridge/deepseek.key` 或环境变量 `DEEPSEEK_API_KEY`，不放进本仓库；
- 用法说明里的路径改成本目录。

2026-11-14 用户要能换模型，`deepseek.py` 加了 `--model`：默认 `deepseek-flash`；`deepseek-v4-pro` 看不了图、贵三四倍。续问不写就沿用那次的。

调用记录写在本目录的 `runs/`，已经 gitignore。

```bash
bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort high "问题"
bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort max -f C:/路径/任务书.md --out C:/路径/答卷.md
bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort high --image E:/路径/图.png "这张图有什么问题？"
bash E:/AI短视频项目/.agents/skills/deepseek/ds.sh --effort low --resume <run_dir> "接着问"
```

- **输出**：`=== 回复 ===` 下面是正文，最后一行一定是 `RESULT_JSON {...}`。
  - 字段：ok、error、out、run_dir、cost_usd、attempts、fallback、truncated。
  - 实际写到哪个文件，以 `out` 为准。
- **档位**：每次自己定，显式写出来。
  - none：只加工文字。
  - low：简单问答。
  - high：默认档。
  - max：要拿去做决定的结论、审稿。长任务书要 5–10 分钟，放后台跑。
- **任务书要自足**：它读不了本机文件，也上不了网。
  - 要审的剧本、提示词，原文全部写进去；背景写准，拿不准的写明拿不准。
  - 用得到"今天"时，开头写明日期。
  - 超过几百字，写成 UTF-8 的 .md，用 `-f` 传。
  - 输出格式、语言、字数这些关键要求写进正文。
- **汇报**：
  - 先核对它用到的事实。
  - 转述时注明是"DeepSeek 的看法"，和我的判断分开写。
  - 改不改由用户决定。
- **出错时看 `error`**：
  - 401：key 失效，请用户处理。
  - 402：余额不足，请用户处理。
  - 结果被截断：调大 `--max-tokens` 重跑。
  - 提示"服务端指纹变了"：先告诉用户。
