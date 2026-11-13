# 即梦短剧 CLI 与 Skill

`jimeng-novel` 提供即梦短剧画布管理、节点编辑、素材上传下载、图片／视频／音频生成、任务查询、AI 剧本、分组、布局、连线及积分查询能力。

## 安装与登录

推荐使用发布方提供的公开 HTTPS tgz 执行 `npm install -g <版本URL>`，需要 Node.js 18+（含 npm）；npm 包内含 macOS / Linux x64、ARM64 及 Windows x64 原生程序和 JS runtime，Skill 单独交付。安装不需要 Go、Python 或 curl，使用 Skill 的 Python 小工具另需 Python 3.10+，视频合成/抽帧另需 FFmpeg。

本完整归档保留二进制、runtime 和 `jimeng-drama` Skill，不能单独复制程序或移动 runtime。Bash 安装器另需 Python 3.10+、Node.js 18+ 和 curl；Windows 使用对应 PowerShell 入口。各平台构建和文件校验不代表真实宿主均已验收。

安装完成后，在新终端运行以下命令，或使用安装器输出的命令绝对路径：

```bash
jimeng-novel --version
jimeng-novel login
jimeng-novel status
jimeng-novel canvas list --limit 1
```

正式版安装器默认使用生产环境；登录及业务访问仍需本人授权。不要将 Token、Cookie 或设备密钥发送到对话中。生成会消耗账号积分；查询与安装不自动触发生成。

## 命令

```bash
jimeng-novel --help                                   # 从零到成片的命令地图
mkdir my-drama && cd my-drama
jimeng-novel init --title "短剧项目"                   # 当前目录绑定新画布，之后的命令自动带上
jimeng-novel node create --key cast/<角色>.<造型> --type image --model <模型> --prompt-file cast/<角色>.md#<造型>
jimeng-novel credit estimate --key cast/<角色>.<造型>
jimeng-novel node run --key cast/<角色>.<造型> --wait 120 --out cast/
jimeng-novel node create --key E01/S01 --type video --model <模型> --prompt-file shots/E01.md#S01 --ref <角色>=file:cast/<角色>.<造型>.png --param duration=5
jimeng-novel node run --key E01/S01 --wait 480 --out out/E01/
jimeng-novel node result --key E01/S01 --wait 480 --out out/E01/
jimeng-novel compose out/E01/S01.mp4 --srt out/E01.srt --out out/E01.mp4
```

输出默认是文本，末行「下一步:」给出可复制的命令；`-j` 输出 JSON 信封，`--jq` 直接取字段；出错信息写到 stderr。完整参数以对应命令的 `--help` 为准。

创建和更新节点只保存配置，`node run` 才提交生成。`--wait` 到期仍未完成时返回 running，接着执行 `node result` 同样的 key；超时不代表任务失败，不应直接重复提交。`--out` 从不覆盖，内容不同的旧文件移到同目录 `old/`。

当前保留基础图片、视频、音频生成，以及样片（480p）转成片（1080p）；不提供音频分离或视频配音翻译。

## Skill

- `skills/jimeng-drama/SKILL.md`：短剧创作流程、剧本、角色场景、分镜及成片组织。

让 Agent 阅读安装器输出的 SKILL.md，并按需加载其相对引用文件。安装器默认注册到支持的宿主 Skill 目录；其他宿主可通过 `--skills-dir` 指定目录，或直接读取完整路径。
