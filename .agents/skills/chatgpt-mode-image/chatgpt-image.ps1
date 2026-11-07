# chatgpt-image.ps1 — 在 Codex 桌面版的 ChatGPT 模式里出图（不是 Codex 的 image_gen），把原图存到指定位置。
# 由 chatgpt-image.sh 调用，参数见 SKILL.md。只用系统自带的 Windows PowerShell 5.1 + UI Automation；剪贴板要求 -STA。
# 流程：codex://new?mode=chat&prompt=.. 切到 ChatGPT 模式、开新聊天并填好提示词
#    → UIA 核对输入框后点 Send → 盯着对话直到出图（Stop 按钮消失、出现 Copy image）
#    → 点 Copy image，从剪贴板取 PNG 原图（全分辨率）存盘，再把剪贴板里原来的文字放回去。
#    对话被切走（有人在用这个窗口）时，切回 ChatGPT 模式，从侧栏新出现的对话里按提示词内容找回来。
# 注意：本文件必须存成带 BOM 的 UTF-8，否则 PowerShell 5.1 会按 GBK 读坏中文。
param(
  [string]$PromptFile = '',
  [string]$Out = '',          # 输出 .png 路径或目录；空 = 当前目录
  [int]$Timeout = 600,        # 等出图的秒数
  [switch]$Force              # 同名覆盖（默认自动加 -v2、-v3）
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms, System.Drawing
Add-Type -Namespace CgImg -Name User32 -MemberDefinition @'
[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
[DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
public struct POINT { public int X; public int Y; }
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

$AE = [System.Windows.Automation.AutomationElement]
$Desc = [System.Windows.Automation.TreeScope]::Descendants
$CT = [System.Windows.Automation.ControlType]
$MaxUrl = 30000   # 深链接要经过命令行，上限 32767，留余量
$Suffix = '（请直接生成 1 张图片，不要提问，不要只回复文字。）'
$clock = [Diagnostics.Stopwatch]::StartNew()
$result = [ordered]@{ ok = $false; status = $null; error = $null; image = $null; warnings = @() }

function Say([string]$s) { [Console]::Out.WriteLine($s) }
function Finish([int]$code) {
  $result.seconds = [Math]::Round($clock.Elapsed.TotalSeconds, 1)
  Say ('RESULT_JSON ' + ($result | ConvertTo-Json -Compress -Depth 3))
  exit $code
}
function Fail([string]$msg, [int]$code = 1) { $result.error = $msg; Finish $code }
function Warn([string]$msg) { $result.warnings = @($result.warnings) + $msg }
# 比对用：输入框和对话会解析 Markdown，去掉空白、反斜杠和 Markdown 符号再比
function Norm([string]$s) { if ($null -eq $s) { return '' }; $s -replace '[\s\\*_`~#>•]+', '' }

# Codex 桌面版是商店包 OpenAI.Codex，进程名 ChatGPT.exe（按路径区分，免得认成 ChatGPT 桌面版）
function Get-Windows {
  $ids = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\OpenAI.Codex_*' } | ForEach-Object { $_.Id })
  if ($ids.Count -eq 0) { return }
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Chrome_WidgetWin_1')
  foreach ($w in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    if ($ids -contains $w.Current.ProcessId) { $w }
  }
}
function Find-All($win, $type) {
  $win.FindAll($Desc, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type)))
}
function Find-Button($win, [string]$name, [switch]$Sidebar) {
  $hit = $null
  foreach ($b in Find-All $win $CT::Button) {
    if ($b.Current.Name -ne $name) { continue }
    if ($Sidebar -and $b.Current.ClassName -notlike '*sidebar-item*') { continue }
    $hit = $b   # 取最后一个（最新的消息）
  }
  $hit
}
function Invoke-El($el) { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Get-Text($el) {
  try { $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern).DocumentRange.GetText(-1) } catch { '' }
}
function Find-Composer($win) {
  foreach ($e in Find-All $win $CT::Edit) { if ($e.Current.ClassName -like 'ProseMirror*') { return $e } }
}
# 侧栏里的对话条目（只认 sidebar-item，免得点到对话区的按钮）
function Sidebar-Names($win) {
  @(Find-All $win $CT::Button | Where-Object { $_.Current.ClassName -like '*sidebar-item*' } | ForEach-Object { $_.Current.Name } | Where-Object { $_ })
}
# 对话里所有文字（按界面顺序）
function Page-Texts($win) { @(Find-All $win $CT::Text | ForEach-Object { $_.Current.Name }) }
function Is-OurChat($win) { (Norm ((Page-Texts $win) -join '')).Contains($script:head) }
# 最后一条 ChatGPT 回复的文字（出错时报给调用方）
function Reply-Text($win) {
  $t = Page-Texts $win
  $i = [Array]::LastIndexOf($t, 'ChatGPT said:')
  if ($i -lt 0 -or $i -ge $t.Count - 1) { return '' }
  (@($t[($i + 1)..($t.Count - 1)] | Where-Object { $_ -and $_ -notlike 'ChatGPT can make mistakes*' -and $_.Trim() }) -join "`n").Trim()
}
# 窗口被完全挡住或最小化时，Chromium 会把页面当后台，出图会一直卡在 Creating image。
# 这时把窗口浮到最上层（置顶再取消置顶，不抢键盘焦点）；只要还有一处露在外面就不动它。
function Ensure-Visible($win) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  if ([CgImg.User32]::IsIconic($h)) { [CgImg.User32]::ShowWindow($h, 4) | Out-Null }   # SW_SHOWNOACTIVATE
  $r = New-Object CgImg.User32+RECT
  [CgImg.User32]::GetWindowRect($h, [ref]$r) | Out-Null
  foreach ($f in @(@(0.5, 0.5), @(0.25, 0.3), @(0.75, 0.3), @(0.25, 0.8), @(0.75, 0.8))) {
    $p = New-Object CgImg.User32+POINT
    $p.X = $r.Left + [int](($r.Right - $r.Left) * $f[0]); $p.Y = $r.Top + [int](($r.Bottom - $r.Top) * $f[1])
    $hit = [CgImg.User32]::WindowFromPoint($p)
    if ($hit -ne [IntPtr]::Zero -and [CgImg.User32]::GetAncestor($hit, 2) -eq $h) { return }   # GA_ROOT
  }
  [CgImg.User32]::SetWindowPos($h, [IntPtr](-1), 0, 0, 0, 0, 0x13) | Out-Null   # HWND_TOPMOST，NOSIZE|NOMOVE|NOACTIVATE
  [CgImg.User32]::SetWindowPos($h, [IntPtr](-2), 0, 0, 0, 0, 0x13) | Out-Null   # HWND_NOTOPMOST
  $script:raised++
}
$script:raised = 0

function Resolve-Out([string]$o) {
  if (-not $o) { $o = '.' }
  $isDir = $o -match '[\\/]$'
  $o = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($o)
  if ($isDir -or (Test-Path $o -PathType Container)) {
    New-Item -ItemType Directory -Force $o | Out-Null
    $o = Join-Path $o ('chatgpt-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.png')
  }
  if ([IO.Path]::GetExtension($o) -ne '.png') { $o += '.png' }
  New-Item -ItemType Directory -Force (Split-Path $o) | Out-Null
  if (-not $Force) {
    $base = $o.Substring(0, $o.Length - 4); $n = 2
    while (Test-Path $o) { $o = "$base-v$n.png"; $n++ }
  }
  $o
}

try {
  if (-not $PromptFile -or -not (Test-Path $PromptFile)) { Fail '缺少提示词' 2 }
  $prompt = [IO.File]::ReadAllText($PromptFile).Trim()
  if (-not $prompt) { Fail '提示词是空的' 2 }
  $outPath = Resolve-Out $Out
  $sent = "$prompt`n`n$Suffix"
  $want = Norm $sent
  $script:head = Norm $prompt
  if ($script:head.Length -gt 60) { $script:head = $script:head.Substring(0, 60) }
  $url = $null
  if ($sent.Length -le $MaxUrl) { $url = 'codex://new?mode=chat&prompt=' + [Uri]::EscapeDataString($sent) }
  if ($null -eq $url -or $url.Length -gt $MaxUrl) { Fail '提示词太长，深链接装不下（约 3000 个汉字以内）' 2 }

  # 1. 切到 ChatGPT 模式、开新聊天、填好提示词（Codex 没开会自动启动）
  $coldStart = -not (Get-Windows)
  Start-Process $url
  $wait = 30; if ($coldStart) { $wait = 120 }
  $deadline = (Get-Date).AddSeconds($wait)
  $win = $null; $seen = ''; $refired = $false
  while (-not $win -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    foreach ($w in Get-Windows) {
      $c = Find-Composer $w
      if (-not $c) { continue }
      $seen = Get-Text $c
      if ((Norm $seen) -eq $want) { $win = $w; break }
    }
    if (-not $win -and $coldStart -and -not $refired -and $clock.Elapsed.TotalSeconds -gt 30) { Start-Process $url; $refired = $true }
  }
  if (-not $win) {
    if ($seen.Length -gt 120) { $seen = $seen.Substring(0, 120) + '…' }
    $result.composer_text = $seen
    Fail "等了 $wait 秒，输入框里的内容和提示词对不上（可能有人在 Codex 里打字，或深链接没生效），没有发送"
  }

  # 2. 记下侧栏现有对话（之后找回自己的对话用），点发送
  $before = Sidebar-Names $win
  $send = Find-Button $win 'Send'
  if (-not $send -or -not $send.Current.IsEnabled) { Fail '找不到可用的发送按钮，没有发送' }
  Invoke-El $send
  $tSend = Get-Date

  # 3. 等出图
  $deadline = $tSend.AddSeconds($Timeout)
  $idle = 0; $lastRecover = [DateTime]::MinValue; $copyBtn = $null
  while ($true) {
    Start-Sleep -Seconds 2
    Ensure-Visible $win
    if ((Get-Date) -gt $deadline) { $result.status = 'timeout'; Fail "等了 $Timeout 秒还没出图；图生成后在 ChatGPT 模式的这个对话里，可以手动保存" 124 }
    if (Is-OurChat $win) {
      if (Find-Button $win 'Stop') { $idle = 0; continue }
      $copyBtn = Find-Button $win 'Copy image'
      if ($copyBtn) { break }
      # 没在生成、也没有图：可能刚发出去还没开始，或者只回了文字。连续几次都这样才算结束。
      if (((Get-Date) - $tSend).TotalSeconds -gt 10 -and (Reply-Text $win)) { $idle++ }
      if ($idle -ge 3) {
        $result.status = 'no_image'
        $result.reply = Reply-Text $win
        Fail 'ChatGPT 只回了文字，没有出图（回复见 reply）'
      }
      continue
    }
    # 对话被切走了：每 30 秒尝试切回一次
    if (((Get-Date) - $lastRecover).TotalSeconds -lt 30) { continue }
    $lastRecover = Get-Date
    Start-Process 'codex://new?mode=chat'
    Start-Sleep -Seconds 2
    $new = @(Sidebar-Names $win | Where-Object { $before -notcontains $_ } | Select-Object -Unique)
    foreach ($name in $new) {
      $item = Find-Button $win $name -Sidebar
      if (-not $item) { continue }
      try { Invoke-El $item } catch { continue }
      Start-Sleep -Seconds 2
      if (Is-OurChat $win) { Warn '对话中途被切走，已自动切回'; break }
    }
  }

  # 4. 复制原图，存盘，恢复剪贴板里原来的文字
  $oldText = $null
  try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $oldText = [System.Windows.Forms.Clipboard]::GetText() } } catch { }
  $seq = [CgImg.User32]::GetClipboardSequenceNumber()
  Invoke-El $copyBtn
  $deadline = (Get-Date).AddSeconds(20)
  $saved = $false
  while (-not $saved -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ([CgImg.User32]::GetClipboardSequenceNumber() -eq $seq) { continue }
    try {
      $data = [System.Windows.Forms.Clipboard]::GetDataObject()
      $png = $data.GetData('PNG')
      if ($png -is [IO.Stream]) {
        $fs = [IO.File]::Create($outPath); try { $png.CopyTo($fs) } finally { $fs.Dispose() }
        $saved = $true
      } elseif ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        [System.Windows.Forms.Clipboard]::GetImage().Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
        $saved = $true
        Warn '剪贴板里没有 PNG 原图，改存位图（透明通道会丢）'
      }
    } catch { }
  }
  if ($null -ne $oldText) { try { [System.Windows.Forms.Clipboard]::SetText($oldText) } catch { Warn '剪贴板里原来的文字没能放回去' } }
  if (-not $saved) { Fail '点了 Copy image，但 20 秒内剪贴板里没拿到图片；图在 ChatGPT 模式的这个对话里，可以手动保存' }

  $img = [System.Drawing.Image]::FromFile($outPath)
  $result.width = $img.Width; $result.height = $img.Height; $img.Dispose()
  $result.bytes = (Get-Item $outPath).Length
  $newChats = @(Sidebar-Names $win | Where-Object { $before -notcontains $_ } | Select-Object -Unique)
  if ($newChats.Count -eq 1) { $result.chat = $newChats[0] }
  if ($script:raised -gt 0) { $result.raised = $script:raised }
  $result.ok = $true; $result.status = 'done'; $result.image = $outPath
  Say "已保存：$outPath（$($result.width)x$($result.height)）"
  Finish 0
} catch {
  Fail ("脚本异常：" + $_.Exception.Message)
}
