# codex-chat.ps1 — 在 Codex 桌面版里开一个看得见的新对话（或续接旧对话），发指令，读回复。
# 由 codex-chat.sh 调用，参数见 SKILL.md。只用系统自带的 Windows PowerShell 5.1 + UI Automation。
# 流程：codex://threads/new?mode=codex&path=..&prompt=.. 深链接开新对话并填好提示词
#      （mode=codex：窗口停在 ChatGPT 模式时也开成 Codex 模式的对话；续接前先用 codex://new?mode=codex 切回）
#    → UIA 核对输入框里确实是这段话、而且在 Codex 模式，再点 Send（Send 灰着就报出当前模型，不发）
#    → 在 ~/.codex/sessions 的会话记录里找到这条消息，拿到 thread_id、turn_id
#    → 等同一 turn_id 的 task_complete，取 last_agent_message。
# 注意：本文件必须存成带 BOM 的 UTF-8，否则 PowerShell 5.1 会按 GBK 读坏中文。
param(
  [string]$PromptFile = '',
  [string]$Path = '',        # 新对话的项目目录；空 = Codex 当前默认项目
  [string]$Thread = '',      # 续接：会话 ID 或 last
  [int]$Timeout = 1800,      # 等回复的秒数
  [switch]$NoWait,           # 发出去就返回，之后用 -Read 取回复
  [switch]$Read              # 只读：取 -Thread 的最新回复
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$AE = [System.Windows.Automation.AutomationElement]
$Desc = [System.Windows.Automation.TreeScope]::Descendants
$Sessions = Join-Path $env:USERPROFILE '.codex\sessions'
$Archived = Join-Path $env:USERPROFILE '.codex\archived_sessions'   # 对话归档后，会话记录挪到这里
$StateDir = Join-Path $env:LOCALAPPDATA 'codex-chat'
$LastFile = Join-Path $StateDir 'last_thread.txt'
$MaxUrl = 30000   # 深链接要经过命令行，上限 32767，留余量
$clock = [Diagnostics.Stopwatch]::StartNew()
$result = [ordered]@{ ok = $false; status = $null; error = $null; thread_id = $null; warnings = @() }

function Say([string]$s) { [Console]::Out.WriteLine($s) }
function Finish([int]$code) {
  $result.seconds = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
  Say ('RESULT_JSON ' + ($result | ConvertTo-Json -Compress -Depth 3))
  exit $code
}
function Fail([string]$msg, [int]$code = 1) { $result.error = $msg; Finish $code }
function Warn([string]$msg) { $result.warnings = @($result.warnings) + $msg }
# 比对用：输入框会解析 Markdown（*斜体* 显示时没有星号、列表改缩进），发出去时又会加反斜杠转义（`变成\`），
# 所以去掉空白、反斜杠和 Markdown 符号再比
function Norm([string]$s) { if ($null -eq $s) { return '' }; $s -replace '[\s\\*_`~#>•]+', '' }
function EventTime($o) { [DateTimeOffset]::Parse($o.timestamp, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime }

# 读会话记录。Codex 正在写的文件也能读；最后一行可能只写了一半，解析失败就跳过。
# 文件不在了（对话刚被归档、记录正在挪）就当没读到，下一轮再找。
function Read-Events([string]$file) {
  try { $fs = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete') }
  catch [IO.FileNotFoundException], [IO.DirectoryNotFoundException] { return }
  try { $text = (New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() }
  foreach ($line in $text.Split("`n")) {
    if ($line -notmatch '"type":"(task_started|task_complete|turn_aborted|UserMessage|AgentMessage)"') { continue }
    try { $line | ConvertFrom-Json } catch { }
  }
}
function Message-Text($item) { (@($item.content) | ForEach-Object { $_.text }) -join '' }
# 这一回合实际用的模型和推理深度：会话记录里这一回合的 turn_context（只读，2026-11-14 加）
function Turn-Settings([string]$file, [string]$turn) {
  try { $fs = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]'ReadWrite, Delete') } catch { return }
  try { $text = (New-Object IO.StreamReader($fs, [Text.Encoding]::UTF8)).ReadToEnd() } finally { $fs.Dispose() }
  foreach ($line in $text.Split("`n")) {
    if ($line -notmatch '"type":"turn_context"' -or $line -notmatch ('"turn_id":"' + [regex]::Escape($turn) + '"')) { continue }
    $e = $null; $m = $null
    if ($line -match '"effort":"([A-Za-z]+)"') { $e = $Matches[1] } elseif ($line -match '"reasoning_effort":"([A-Za-z]+)"') { $e = $Matches[1] }
    if ($line -match '"model":"([^"]+)"') { $m = $Matches[1] }
    return @{ effort = $e; model = $m }
  }
}
# 按会话 ID 找记录文件：没归档的在 sessions，归档了的在 archived_sessions
function Find-Rollout([string]$id) {
  Get-ChildItem $Sessions, $Archived -Recurse -Filter "rollout-*-$id.jsonl" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
# 回合是不是被归档掐断的：任务书让 Codex 发完回复、最后把自己这个对话归档，归档会当场中止这一回合（interrupted）。
# 中止事件可能比挪文件早写进去，等几秒看记录挪没挪进 archived_sessions；挪了返回新路径。
function Archived-Path([string]$id) {
  for ($i = 0; $i -lt 10; $i++) {
    $f = Find-Rollout $id
    if ($f -and $f.FullName -like "$Archived\*") { return $f.FullName }
    Start-Sleep -Seconds 1
  }
}
$ArchivedNote = 'Codex 最后把这个对话归档了（任务书要求），回复取自归档前最后一条消息'
function Resolve-Thread([string]$t) {
  if ($t -ne 'last') { return $t }
  $id = Get-Content $LastFile -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $id) { Fail '没有上一次的会话记录，请直接给会话 ID' 2 }
  $id.Trim()
}

# Codex 桌面版是商店包 OpenAI.Codex，进程名 ChatGPT.exe（按路径区分，免得认成 ChatGPT 桌面版）
function Get-CodexWindows {
  $ids = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\OpenAI.Codex_*' } | ForEach-Object { $_.Id })
  if ($ids.Count -eq 0) { return }
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Chrome_WidgetWin_1')
  foreach ($w in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    if ($ids -contains $w.Current.ProcessId) { $w }
  }
}
function Find-Composer($win) {
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
  foreach ($e in $win.FindAll($Desc, $cond)) { if ($e.Current.ClassName -like 'ProseMirror*') { return $e } }
}
function Get-Text($el) {
  try { $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1) } catch { '' }
}
function Find-Buttons($win) {
  $win.FindAll($Desc, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)))
}
# 发送按钮：优先返回能点的；只有灰的就返回灰的（调用方据此报模型），没有返回 $null
function Find-Send($win) {
  $grey = $null
  foreach ($b in Find-Buttons $win) {
    if (@('Send', '发送') -notcontains $b.Current.Name) { continue }
    if ($b.Current.IsEnabled) { return $b }
    if (-not $grey) { $grey = $b }
  }
  $grey
}
# 输入框下面的模型按钮名字（如「GPT-6.1 Sol Ultra」），排在「Change permissions」后面。只读名字，不点它。
function Model-Name($win) {
  $prev = ''; $gpt = $null
  foreach ($b in Find-Buttons $win) {
    $n = $b.Current.Name
    if (@('Change permissions', '更改权限') -contains $prev -and $n) { return $n }
    if ($n -like 'GPT*') { $gpt = $n }
    $prev = $n
  }
  $gpt
}
# Codex 桌面版分 Codex 模式和 ChatGPT 模式（ChatGPT 模式里又分 chat / work，work 是 Work with ChatGPT，模型表也不同）。
# 认法：左上角「Switch mode, current mode: Codex / ChatGPT」按钮；没有这个按钮时，输入框名字带 ChatGPT 就是 ChatGPT 模式。
# 返回 codex / chatgpt，认不出返回 $null。Codex 模式不记在 home-composer-mode-v1 里，那个键只分 chat / work。
function Ui-Surface($win) {
  foreach ($b in Find-Buttons $win) {
    if ($b.Current.Name -match 'current mode:\s*(\S+)') {
      if ($Matches[1] -eq 'Codex') { return 'codex' }
      if ($Matches[1] -eq 'ChatGPT') { return 'chatgpt' }
    }
  }
  $c = Find-Composer $win
  if ($c -and $c.Current.Name -like '*ChatGPT*') { return 'chatgpt' }
}
function Get-Surface {
  foreach ($w in Get-CodexWindows) { $s = Ui-Surface $w; if ($s) { return $s } }
}
# 这个输入框是不是 Codex 模式的（叫 Do anything / Work with Codex）：名字不带 ChatGPT，左上角按钮也不是 ChatGPT。
# 切模式的半途中按钮和输入框会短暂对不上（输入框名字为空），这时不算。
function Is-CodexComposer($w, $c) {
  $n = $c.Current.Name
  [bool]($n -and $n -notlike '*ChatGPT*' -and (Ui-Surface $w) -ne 'chatgpt')
}
# 深链接填错了地方（别的模式的输入框）又没发出去时，把我们填的提示词清掉，免得之后被人顺手发出去
function Clear-Stray($c) {
  try { if ($c -and (Norm (Get-Text $c)) -eq $want) { $c.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue('') } } catch { }
}
# 切到 Codex 模式，等界面确认；返回最后看到的模式（codex / chatgpt / 认不出时 $null）
function Switch-Codex([int]$wait) {
  $t0 = Get-Date; $next = $t0; $s = $null
  while (((Get-Date) - $t0).TotalSeconds -lt $wait) {
    # 这个深链接偶尔不生效（冷启动时界面还没加载好；11-07 热窗口也碰到过一次，30 秒没反应），没切过去就每 8 秒补发
    if ((Get-Date) -ge $next) { Start-Process 'codex://new?mode=codex'; $next = (Get-Date).AddSeconds(8) }
    Start-Sleep -Milliseconds 500
    $s = Get-Surface
    if ($s -eq 'codex') { break }
  }
  $s
}
function Build-Url([string]$text) {
  $q = 'prompt=' + [Uri]::EscapeDataString($text)
  if ($Thread) { return "codex://threads/$($Thread)?$q" }
  if ($Path) { $q = 'path=' + [Uri]::EscapeDataString($Path) + '&' + $q }
  "codex://threads/new?mode=codex&$q"   # 不带 mode 会沿用窗口当前的模式，停在 ChatGPT 模式时就开成 ChatGPT 的对话
}

try {
  if ($Thread) { $Thread = Resolve-Thread $Thread; $result.thread_id = $Thread }

  # ---------- 只读：某个会话的最新回复 ----------
  if ($Read) {
    if (-not $Thread) { Fail '读回复要给会话 ID 或 last' 2 }
    $f = Find-Rollout $Thread
    if (-not $f) { Fail "找不到会话 $Thread 的记录" }
    $status = 'idle'; $reply = $null; $said = $null
    foreach ($o in Read-Events $f.FullName) {
      switch ($o.payload.type) {
        'task_started'  { $status = 'running'; $said = $null }
        'task_complete' { $status = 'done'; $reply = $o.payload.last_agent_message }
        'turn_aborted'  { $status = 'aborted'; $result.reason = $o.payload.reason }
        'item_completed' { if ($o.payload.item.type -eq 'AgentMessage') { $said = Message-Text $o.payload.item } }
      }
    }
    if ($status -eq 'aborted' -and $result.reason -eq 'interrupted' -and $f.FullName -like "$Archived\*") {
      $status = 'done'; $reply = $said; Warn $ArchivedNote
    }
    if ($null -ne $reply) { Say '=== Codex 回复 ==='; Say $reply }
    $result.ok = $true; $result.status = $status; $result.rollout = $f.FullName
    Finish 0
  }

  # ---------- 发送 ----------
  if (-not $PromptFile -or -not (Test-Path $PromptFile)) { Fail '缺少提示词' 2 }
  $prompt = [IO.File]::ReadAllText($PromptFile).Trim()
  if (-not $prompt) { Fail '提示词是空的' 2 }
  if ($Path -and -not $Thread) {
    $Path = [IO.Path]::GetFullPath($Path)
    if ($Path.Length -gt 3) { $Path = $Path.TrimEnd('\') }
    if (-not (Test-Path $Path -PathType Container)) { Fail "项目目录不存在：$Path" 2 }
    $result.cwd = $Path
  }

  $sent = $prompt
  $url = $null
  if ($prompt.Length -le $MaxUrl) { $url = Build-Url $prompt }
  if ($null -eq $url -or $url.Length -gt $MaxUrl) {
    # 深链接装不下：全文存文件，对话里只发一句「去读这个文件」
    New-Item -ItemType Directory -Force (Join-Path $StateDir 'prompts') | Out-Null
    $pf = Join-Path $StateDir ('prompts\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.md')
    [IO.File]::WriteAllText($pf, $prompt, (New-Object Text.UTF8Encoding($false)))
    $sent = "任务内容较长，全文在这个文件里，请先完整读取，再照着做：$pf"
    $url = Build-Url $sent
    Warn "提示词太长，改为发送文件路径：$pf"
  }
  $want = Norm $sent

  # 几个任务同时发（照方案改一次出几张图）：从切模式到在会话记录里认出这条消息，一次只让一个进，
  # 免得两个深链接抢同一个输入框（11-15 加）。进程退出时系统会放开；等的那头收到 Abandoned 也算拿到。
  $sendLock = New-Object Threading.Mutex($false, 'Local\codex-chat-send')
  $locked = $false
  try { $locked = $sendLock.WaitOne([TimeSpan]::FromSeconds(600)) } catch [Threading.AbandonedMutexException] { $locked = $true }
  if (-not $locked) { Fail '别的任务一直在往 Codex 里发消息，等了 600 秒还没轮到，没有发送' }

  # chatgpt-mode-image 用完窗口会停在 ChatGPT 模式，提示词会发成 ChatGPT 的对话（11-07 出过两次）。
  # 新对话的深链接带了 mode=codex；续接旧对话的深链接不认 mode，先切回 Codex 模式。
  $surface = Get-Surface
  if ($Thread -and $surface -ne 'codex') {
    $wait = 30; if (-not (Get-CodexWindows)) { $wait = 120 }
    if ((Switch-Codex $wait) -eq 'chatgpt') { Fail "等了 $wait 秒，Codex 还在 ChatGPT 模式，没切回 Codex 模式，没有发送" }
  }

  # 打开（必要时启动）Codex，深链接会新建对话并把提示词填进输入框。
  # 深链接里切模式那一步偶尔晚到或不生效，提示词照样填进当前模式的输入框（11-07 出图时就这样反过来发成了 Codex 任务），
  # 所以只认 Codex 模式里、连续两次都对得上的输入框；没等到就每 10 秒补发一次（冷启动时第一次也可能在界面加载完之前就到了）。
  $coldStart = -not (Get-CodexWindows)
  $tStart = [DateTime]::UtcNow.AddSeconds(-2)
  $wait = 30; if ($coldStart) { $wait = 120 }
  $deadline = (Get-Date).AddSeconds($wait)
  $next = Get-Date; $fired = 0
  $win = $null; $cand = $null; $stray = $null
  $seen = ''
  while (-not $win -and (Get-Date) -lt $deadline) {
    if ((Get-Date) -ge $next -and $fired -lt 4) { Start-Process $url; $fired++; $next = (Get-Date).AddSeconds(10) }
    Start-Sleep -Milliseconds 500
    $hit = $null
    foreach ($w in Get-CodexWindows) {
      $c = Find-Composer $w
      if (-not $c) { continue }
      $seen = Get-Text $c
      if ((Norm $seen) -ne $want) { continue }
      if (-not (Is-CodexComposer $w $c)) { $stray = $c; continue }
      $hit = $w; break
    }
    if ($hit -and $cand -and $hit.Current.NativeWindowHandle -eq $cand.Current.NativeWindowHandle) { $win = $hit }
    $cand = $hit
  }
  if (-not $win) {
    if ($stray) { Clear-Stray $stray; Fail "等了 $wait 秒，Codex 没切到 Codex 模式，提示词填进了 ChatGPT 模式的输入框（已清空），没有发送" }
    if ($seen.Length -gt 120) { $seen = $seen.Substring(0, 120) + '…' }
    $result.composer_text = $seen
    Fail "等了 $wait 秒，Codex 输入框里的内容和提示词对不上（可能有人在 Codex 里打字，或深链接没生效），没有发送"
  }
  if ($surface -eq 'chatgpt') { Warn 'Codex 原来停在 ChatGPT 模式，已切回 Codex 模式' }

  # 发送键刚填完字可能要等一下才亮；一直灰着多半是当前模型用不了（11-07 用 mode=work 切到 Work with ChatGPT，模型是 GPT-6 Astra，就发不出去）
  $send = Find-Send $win
  $deadline = (Get-Date).AddSeconds(5)
  while ($send -and -not $send.Current.IsEnabled -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500; $send = Find-Send $win }
  $model = Model-Name $win
  if ($model) { $result.model = $model }
  if (-not $send -or -not $send.Current.IsEnabled) {
    $hint = '没认出当前模型'; if ($model) { $hint = "当前模型是「$model」" }
    if ($send) { Fail "发送按钮是灰的，没有发送。$hint，可能用不了：请在 Codex 输入框下面的模型按钮里手动换一个能用的模型，再重跑" }
    Fail "找不到发送按钮（Codex 可能正忙或界面变了），没有发送。$hint"
  }
  # 点之前最后核对一次：还是这段话、还在 Codex 模式（可能有人这时在用 ChatGPT 模式）
  $c = Find-Composer $win
  if (-not $c -or (Norm (Get-Text $c)) -ne $want -or -not (Is-CodexComposer $win $c)) { Fail '发送前输入框变了（内容或模式不对，可能有人在用这个窗口），没有发送' }
  $tSend = [DateTime]::UtcNow.AddSeconds(-2)
  $send.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()

  # 在会话记录里认出这条消息
  $found = $null
  $deadline = (Get-Date).AddSeconds(60)
  while (-not $found -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 700
    # 续接：直接按会话 ID 找文件。Codex 一直开着会话文件在写，NTFS 目录里的修改时间不会及时更新，不能按时间筛。
    if ($Thread) { $files = @(Find-Rollout $Thread | Where-Object { $_ }) }
    else {
      $files = Get-ChildItem $Sessions, $Archived -Recurse -Filter 'rollout-*.jsonl' -ErrorAction SilentlyContinue |
        Where-Object { $_.CreationTimeUtc -ge $tStart -or $_.LastWriteTimeUtc -ge $tSend }
    }
    foreach ($f in $files) {
      foreach ($o in Read-Events $f.FullName) {
        $p = $o.payload
        if ($p.type -ne 'item_completed' -or $p.item.type -ne 'UserMessage') { continue }
        if ($Thread -and $p.thread_id -ne $Thread) { continue }
        if ((EventTime $o) -lt $tSend) { continue }
        $txt = (@($p.item.content) | Where-Object { $_.type -eq 'text' } | ForEach-Object { $_.text }) -join ''
        if ((Norm $txt) -eq $want) { $found = @{ file = $f.FullName; thread = $p.thread_id; turn = $p.turn_id }; break }
      }
      if ($found) { break }
    }
  }
  if (-not $found) { Fail '已点发送，但 60 秒内没在会话记录里找到这条消息，请到 Codex 窗口里看一眼' }
  $result.thread_id = $found.thread
  $result.rollout = $found.file
  $ts = $null
  for ($i = 0; $i -lt 10 -and -not ($ts -and $ts.effort); $i++) { $ts = Turn-Settings $found.file $found.turn; if (-not ($ts -and $ts.effort)) { Start-Sleep -Milliseconds 500 } }
  if ($ts) { $result.effort = $ts.effort; $result.model_id = $ts.model }
  New-Item -ItemType Directory -Force $StateDir | Out-Null
  Set-Content -Path $LastFile -Value $found.thread -Encoding ASCII
  $sendLock.ReleaseMutex(); $locked = $false

  if ($NoWait) { $result.ok = $true; $result.status = 'sent'; Finish 0 }

  # 等这一回合结束
  $deadline = (Get-Date).AddSeconds($Timeout)
  while ($true) {
    $status = 'running'; $reply = $null; $said = $null
    # 记录不在原处了：对话被归档、挪进了 archived_sessions，换到新位置接着读
    if (-not [IO.File]::Exists($found.file)) { $f = Find-Rollout $found.thread; if ($f) { $found.file = $f.FullName } }
    foreach ($o in Read-Events $found.file) {
      $p = $o.payload
      if ($p.turn_id -ne $found.turn) { continue }
      if ($p.type -eq 'task_complete') { $status = 'done'; $reply = $p.last_agent_message }
      elseif ($p.type -eq 'turn_aborted') { $status = 'aborted'; $result.reason = $p.reason }
      elseif ($p.item.type -eq 'AgentMessage') { $said = Message-Text $p.item }
    }
    if ($status -ne 'running') { break }
    if ((Get-Date) -gt $deadline) {
      $result.status = 'running'
      Fail "等了 $Timeout 秒还没做完；Codex 还在跑，之后用 read $($found.thread) 取回复" 124
    }
    Start-Sleep -Seconds 1
  }
  if ($status -eq 'aborted' -and $result.reason -eq 'interrupted') {
    $a = Archived-Path $found.thread
    if ($a) { $found.file = $a; $status = 'done'; $reply = $said; Warn $ArchivedNote }
  }
  $result.status = $status
  $result.rollout = $found.file
  if ($status -eq 'aborted') { Fail '这一回合被中止了（在 Codex 里点了停止，或出错）' }
  Say '=== Codex 回复 ==='
  Say $reply
  $result.ok = $true
  $result.reply_chars = "$reply".Length
  Finish 0
} catch {
  Fail ("脚本异常：" + $_.Exception.Message)
}
