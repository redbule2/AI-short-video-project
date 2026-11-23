# 给桌面软件（现在是 Codex 桌面版）截教程图：照「截图步骤.json」点界面、截图，记下要画框的东西在图上的位置。
# 出的 截图_*.png 和 框.json 跟 截图.js（网页用的那个）一个样，合成视频.py、出PDF.py 照用。
#   powershell -NoProfile -ExecutionPolicy Bypass -File 截窗口.ps1 -Lesson <课的文件夹>
#   powershell -NoProfile -ExecutionPolicy Bypass -File 截窗口.ps1 -Info                      只报窗口在哪、多大、是不是最小化
#   powershell -NoProfile -ExecutionPolicy Bypass -File 截窗口.ps1 -Out 图.png -Tree 树.json [-Do 步骤JSON]   看一眼用：先做一步再截
# 截图步骤.json：
#   { "步骤": [ { "开": "codex://new?mode=codex", "等": 2500 },          ← 开深链接
#               { "点": "新聊天@Button", "等": 1500 },                    ← 点界面上的东西（无障碍接口点，不动鼠标）
#               { "点": "~GPT-@Button", "鼠标": true, "等": 800 },        ← 真用鼠标点（下拉菜单这类要它），点完鼠标放回原处
#               { "按": "{ESC}", "等": 300 },                             ← 按键（SendKeys 写法）
#               { "打字": "Token 是什么？", "等": 300 },                   ← 往有焦点的地方贴一段字（中文 SendKeys 打不了，走剪贴板，贴完剪贴板放回原样）
#               { "等到": "评价回复@Button#2", "最多": 90000, "含藏": true },  ← 等界面上出现这样东西再往下（如回答念完才有的按钮），最多等这么多毫秒，等不到就停；含藏：滚出屏幕的也数上
#               { "滚到": "编辑 AGENTS.md@Button", "等": 600 },          ← 页面里滚出屏幕的东西，让页面滚到它（同一步里先滚再点）
#               { "焦点": "随心输入@Edit", "等": 500 },                   ← 把焦点放到这样东西上，核过真落在上面才往下（打字、按回车前都写上；截图前挪走按钮上的提示框）
#               { "窗口": "铺满" },                                       ← 窗口正好铺满所在那块屏（16:9；最小化着的先还原）；「最大化」还原；「最小化」收回去
#               { "滚到": "你说：@Text", "可失败": true },                 ← 任何一步加「可失败」：没做成只记一笔，接着往下
#               { "截": "首页", "树": true, "框": { "输入框": "@Edit", "模型": "~GPT-@Button" } } ],   ← 树：顺手存 树_首页.json（界面元素清单）
#     "收尾": [ … ] }                                                    ← 不管中途成没成，最后都做（改回设置、还原窗口）；做完把前台还给原来的窗口
#               { "核": "GPT-6.2 Sol 轻度@Button" },                      ← 核对界面上有这样东西，没有就停（改回设置后用）
# 框.json 只换这回截到的图，别的图的框留着（中途停了，接着截也不丢）。
# 找东西的写法：「名字」= 名字正好是这几个字；「~字」= 名字里有这几个字；「%字」= 网页里的 class 有这几个字（没名字的大块用）；
#   后面可加「@种类」（Button、Edit、MenuItem、Group…）和「#第几个」；几种写法用「|」隔开，先找到哪个算哪个；
#   也可以直接写 [x, y, 宽, 高]（截图像素，左上角 0,0）。框.json 里的位置跟 截图.js 一样按 1280 宽的「页面」记（倍数 = 图宽 / 1280）。
# 必须存成带 BOM 的 UTF-8（PowerShell 5.1 才认中文）。
param([string]$Lesson, [string]$Out, [string]$Tree, [string]$Do, [switch]$Info, [int]$Depth = 80)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Drawing, System.Windows.Forms
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class TutWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, IntPtr e);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint f);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
}
"@
[void][TutWin]::SetProcessDpiAwarenessContext([IntPtr](-4))   # 按真像素量，免得缩放后位置对不上
$AE = [System.Windows.Automation.AutomationElement]
$Desc = [System.Windows.Automation.TreeScope]::Descendants

function Find-CodexWindow {
  $ids = @(Get-Process ChatGPT -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\OpenAI.Codex_*' } | ForEach-Object { $_.Id })
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ClassNameProperty, 'Chrome_WidgetWin_1')
  foreach ($w in $AE::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)) {
    if (($ids -contains $w.Current.ProcessId) -and $w.Current.Name) { return $w }
  }
  throw '没找到 Codex 窗口（没开，或者被关到托盘了）'
}

function Get-Frame($h) {
  $r = New-Object TutWin+RECT
  [void][TutWin]::DwmGetWindowAttribute($h, 9, [ref]$r, 16)     # 9 = 看得见的窗口边框，不含阴影
  return $r
}

function Get-WinInfo($win) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  $r = Get-Frame $h
  $o = [ordered]@{}
  $o['标题'] = $win.Current.Name; $o['左'] = $r.L; $o['上'] = $r.T; $o['宽'] = $r.R - $r.L; $o['高'] = $r.B - $r.T
  $o['缩放'] = [math]::Round([TutWin]::GetDpiForWindow($h) / 96, 2); $o['最小化'] = [TutWin]::IsIconic($h)
  return $o
}

function Save-Shot($win, $path) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  if ([TutWin]::IsIconic($h)) { throw 'Codex 窗口最小化着，截不了；请先把它点开' }
  $r = Get-Frame $h
  $wr = New-Object TutWin+RECT
  [void][TutWin]::GetWindowRect($h, [ref]$wr)
  $bmp = New-Object System.Drawing.Bitmap(($wr.R - $wr.L), ($wr.B - $wr.T))
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $hdc = $g.GetHdc()
  [void][TutWin]::PrintWindow($h, $hdc, 2)                    # 2 = 连网页内容一起画（Chromium 窗口要这个）
  $g.ReleaseHdc($hdc); $g.Dispose()
  $crop = New-Object System.Drawing.Rectangle(($r.L - $wr.L), ($r.T - $wr.T), ($r.R - $r.L), ($r.B - $r.T))
  $img = $bmp.Clone($crop, $bmp.PixelFormat)
  $img.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $img.Dispose(); $bmp.Dispose()
}

# 「名字@种类#第几个」→ 找到的界面元素（看得见的才算；$offscreen 为真时滚出屏幕的也算）
function Find-El($win, [string]$spec, [bool]$offscreen = $false) {
  if ($spec.Contains('|')) {   # 「甲|乙」：先找甲，没有再找乙（同一样东西换了模型会变样，如闪电按钮）
    foreach ($one in $spec.Split('|')) { try { return (Find-El $win $one $offscreen) } catch { } }
    throw "界面上没找到：$spec"
  }
  $n = 1; $kind = $null; $name = $spec
  if ($name -match '^(.*)#(\d+)$') { $name = $Matches[1]; $n = [int]$Matches[2] }
  if ($name -match '^(.*)@(\w+)$') { $name = $Matches[1]; $kind = $Matches[2] }
  $contains = $name.StartsWith('~'); if ($contains) { $name = $name.Substring(1) }
  $byClass = $name.StartsWith('%'); if ($byClass) { $name = $name.Substring(1) }
  $hit = 0
  foreach ($e in $win.FindAll($Desc, [System.Windows.Automation.Condition]::TrueCondition)) {
    $c = $e.Current
    if (($c.IsOffscreen -and -not $offscreen) -or $c.BoundingRectangle.IsEmpty -or $c.BoundingRectangle.Width -le 0) { continue }
    if ($kind -and ($c.ControlType.ProgrammaticName -ne "ControlType.$kind")) { continue }
    if ($byClass) { if (-not $c.ClassName.Contains($name)) { continue } }
    elseif ($name) { if ($contains) { if (-not $c.Name.Contains($name)) { continue } } elseif ($c.Name -ne $name) { continue } }
    $hit++
    if ($hit -eq $n) { return $e }
  }
  throw "界面上没找到：$spec"
}

function Box-Of($win, $spec) {
  $r = Get-Frame ([IntPtr]$win.Current.NativeWindowHandle)
  if ($spec -is [System.Array]) { return @($spec | ForEach-Object { [int]$_ }) }
  $b = (Find-El $win $spec).Current.BoundingRectangle
  return @([int]($b.X - $r.L), [int]($b.Y - $r.T), [int]$b.Width, [int]$b.Height)
}

function Click-El($win, $spec, [bool]$mouse) {
  $e = Find-El $win $spec
  if (-not $mouse) {
    $p = $null
    if ($e.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) { $p.Invoke(); return }
    if ($e.TryGetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern, [ref]$p)) { $p.Expand(); return }
    if ($e.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) { $p.Select(); return }
  }
  # 真鼠标：先确认那一点上面是 Codex 窗口（没被别的窗口挡住），点完把鼠标放回去
  $b = $e.Current.BoundingRectangle
  $pt = New-Object TutWin+POINT; $pt.X = [int]($b.X + $b.Width / 2); $pt.Y = [int]($b.Y + $b.Height / 2)
  $top = [TutWin]::GetAncestor([TutWin]::WindowFromPoint($pt), 2)
  if ($top -ne [IntPtr]$win.Current.NativeWindowHandle) { throw "要点的地方被别的窗口挡着：$spec" }
  $old = New-Object TutWin+POINT; [void][TutWin]::GetCursorPos([ref]$old)
  [void][TutWin]::SetCursorPos($pt.X, $pt.Y); Start-Sleep -Milliseconds 60
  [TutWin]::mouse_event(2, 0, 0, 0, [IntPtr]::Zero); Start-Sleep -Milliseconds 40; [TutWin]::mouse_event(4, 0, 0, 0, [IntPtr]::Zero)
  Start-Sleep -Milliseconds 120
  [void][TutWin]::SetCursorPos($old.X, $old.Y)
}

# 把 Codex 切到前台：先借前台窗口的输入队列切（不按键）；不行再按一下 Alt 让 Windows 放行（Alt 可能让菜单栏抢走焦点，所以放后面，按完等一下再切）
function Bring-Front($win) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  if ([TutWin]::GetForegroundWindow() -eq $h) { return }
  $ft = [TutWin]::GetWindowThreadProcessId([TutWin]::GetForegroundWindow(), [IntPtr]::Zero)
  $me = [TutWin]::GetCurrentThreadId()
  $tie = $ft -and $ft -ne $me
  if ($tie) { [void][TutWin]::AttachThreadInput($me, $ft, $true) }
  [void][TutWin]::BringWindowToTop($h); [void][TutWin]::SetForegroundWindow($h)
  if ($tie) { [void][TutWin]::AttachThreadInput($me, $ft, $false) }
  Start-Sleep -Milliseconds 300
  if ([TutWin]::GetForegroundWindow() -ne $h) {
    [TutWin]::keybd_event(0x12, 0, 0, [IntPtr]::Zero); [TutWin]::keybd_event(0x12, 0, 2, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 150
    [void][TutWin]::SetForegroundWindow($h); Start-Sleep -Milliseconds 300
  }
  if ([TutWin]::GetForegroundWindow() -ne $h) { throw '没能把 Codex 窗口切到前台' }
}

function Send-Keys($win, [string]$keys) {
  Bring-Front $win
  [System.Windows.Forms.SendKeys]::SendWait($keys)
}

# 焦点是不是落在这样东西上（或它里面）
function Test-Inside($f, $e) {
  $w = [System.Windows.Automation.TreeWalker]::RawViewWalker
  for ($x = $f; $x; $x = $w.GetParent($x)) { if ([System.Windows.Automation.Automation]::Compare($x, $e)) { return $true } }
  return $false
}

# 「焦点」：切到前台、把焦点放上去，再核一遍真落在它上面才往下（落错地方再打字、按回车会出事）；菜单抢着焦点就按 Esc 退出菜单再放
function Focus-El($win, [string]$spec) {
  Bring-Front $win
  for ($i = 0; $i -lt 3; $i++) {
    $e = Find-El (Find-CodexWindow) $spec
    $e.SetFocus(); Start-Sleep -Milliseconds 250
    $f = [System.Windows.Automation.AutomationElement]::FocusedElement
    if ($f -and (Test-Inside $f $e)) { return }
    if ($f -and (@('MenuItem', 'MenuBar', 'Menu') -contains ($f.Current.ControlType.ProgrammaticName -replace '^ControlType[.]', ''))) { [System.Windows.Forms.SendKeys]::SendWait('{ESC}'); Start-Sleep -Milliseconds 300 }
  }
  throw "焦点放不到：$spec"
}

# 剪贴板一变，别的程序（剪贴板历史、聊天软件）会马上打开它读一下，这时读写会失败：隔 0.1 秒再试，最多 4 秒
function Get-Clip {
  for ($i = 0; $i -lt 40; $i++) {
    try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { return [System.Windows.Forms.Clipboard]::GetText() } else { return $null } } catch { Start-Sleep -Milliseconds 100 }
  }
  throw '剪贴板一直被别的程序占着，读不了'
}
function Set-Clip([string]$text) {   # 写进去，等别的程序读完，再读出来核一遍，对上了才算（读不了只重读，别重写：一重写它们又来读）
  for ($i = 0; $i -lt 10; $i++) {
    $done = $false
    for ($j = 0; $j -lt 20 -and -not $done; $j++) { try { [System.Windows.Forms.Clipboard]::SetText($text); $done = $true } catch { Start-Sleep -Milliseconds 100 } }
    if (-not $done) { break }
    Start-Sleep -Milliseconds 150
    if ((Get-Clip) -eq $text) { return }
  }
  throw '剪贴板一直被别的程序占着，写不进去'
}

# 「打字」：SendKeys 打不了中文，先放进剪贴板再 Ctrl+V，贴完把剪贴板里原来的字放回去（只保得住文字）
function Type-Text($win, [string]$text) {
  $old = Get-Clip
  Set-Clip $text
  Send-Keys $win '^v'
  Start-Sleep -Milliseconds 300
  if ($null -ne $old) { Set-Clip $old } else { try { [System.Windows.Forms.Clipboard]::Clear() } catch { } }
}

# 「滚到」：页面里滚出屏幕的东西，让页面自己滚到它（无障碍接口的 ScrollIntoView，不动鼠标）
function Scroll-To($win, [string]$spec) {
  $e = Find-El $win $spec $true
  $p = $null
  if (-not $e.TryGetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern, [ref]$p)) { throw "这样东西滚不过去：$spec" }
  $p.ScrollIntoView()
}

# 「等到」：每半秒找一次，找到就往下；超过「最多」毫秒（默认 60 秒）还没有就报错停下
# 「含藏」：滚出屏幕的也算（数「#第几个」时用：同一个聊天里第二条回答念完，第一条的按钮可能早滚上去了）
function Wait-El($win, [string]$spec, [int]$ms, [bool]$offscreen = $false) {
  if ($ms -le 0) { $ms = 60000 }
  $end = (Get-Date).AddMilliseconds($ms)
  while ((Get-Date) -lt $end) {
    try { [void](Find-El (Find-CodexWindow) $spec $offscreen); Write-Host "等到了：$spec"; return } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "等了 $([int]($ms / 1000)) 秒还没有：$spec"
}

# 「铺满」：不最大化，把看得见的窗口正好铺满它所在的那块屏（16:9，盖住任务栏），截出来就是整屏比例；「最大化」：还原；「最小化」：收回任务栏
# 窗口最小化着的，先还原再摆
function Set-WindowShape($win, [string]$how) {
  $h = [IntPtr]$win.Current.NativeWindowHandle
  if ($how -eq '最小化') { [void][TutWin]::ShowWindow($h, 6); Start-Sleep -Milliseconds 400; return }
  if ([TutWin]::IsIconic($h)) { [void][TutWin]::ShowWindow($h, 9); Start-Sleep -Milliseconds 800 }
  if ($how -eq '最大化') { [void][TutWin]::ShowWindow($h, 3); Start-Sleep -Milliseconds 600; return }
  $fr = Get-Frame $h
  $scr = [System.Windows.Forms.Screen]::FromRectangle((New-Object System.Drawing.Rectangle($fr.L, $fr.T, ($fr.R - $fr.L), ($fr.B - $fr.T)))).Bounds
  if ([TutWin]::IsZoomed($h)) { [void][TutWin]::ShowWindow($h, 9); Start-Sleep -Milliseconds 500 }
  for ($i = 0; $i -lt 2; $i++) {   # 看不见的边框宽窄要量了才知道，量一次、摆一次，再核一次
    $wr = New-Object TutWin+RECT; [void][TutWin]::GetWindowRect($h, [ref]$wr)
    $fr = Get-Frame $h
    $x = $scr.X - ($fr.L - $wr.L); $y = $scr.Y - ($fr.T - $wr.T)
    $w = $scr.Width + ($fr.L - $wr.L) + ($wr.R - $fr.R); $hh = $scr.Height + ($fr.T - $wr.T) + ($wr.B - $fr.B)
    [void][TutWin]::SetWindowPos($h, [IntPtr]::Zero, $x, $y, $w, $hh, 0x0014)   # 不改前后、不抢焦点
    Start-Sleep -Milliseconds 500
  }
  $fr = Get-Frame $h
  if (($fr.R - $fr.L) -ne $scr.Width -or ($fr.B - $fr.T) -ne $scr.Height) { Write-Host "窗口没铺满：$($fr.R - $fr.L)×$($fr.B - $fr.T)" }
}

function Run-Step($win, $st, $dir, $boxes) {
  if ($st.窗口) { Set-WindowShape $win $st.窗口 }
  if ($st.开) { Start-Process $st.开 }
  if ($st.滚到) { Scroll-To $win $st.滚到 }
  if ($st.点) { Click-El $win $st.点 ([bool]$st.鼠标) }
  if ($st.焦点) { Focus-El $win $st.焦点 }   # 打字、按键前放好焦点；截图前把焦点挪走，按钮上的提示框、蓝圈就没了
  if ($st.按) { Send-Keys $win $st.按 }
  if ($st.打字) { Type-Text $win $st.打字 }
  if ($st.等到) { Wait-El $win $st.等到 ([int]$st.最多) ([bool]$st.含藏) }
  if ($st.等) { Start-Sleep -Milliseconds ([int]$st.等) }
  if ($st.核) { [void](Find-El $win $st.核); Write-Host "核对过：$($st.核)" }   # 找不到就报错停下
  if ($st.截) {
    $png = "截图_$($st.截).png"
    Save-Shot $win (Join-Path $dir $png)
    $wi = Get-WinInfo $win
    $k = $wi.宽 / 1280.0   # 跟网页截图一个规矩：位置按 1280 宽的「页面」记，图是它的 k 倍（合成视频.py 的「全」= 1280×720）
    $fr = [ordered]@{}
    if ($st.框) { foreach ($p in $st.框.PSObject.Properties) { $fr[$p.Name] = @(Box-Of $win $p.Value | ForEach-Object { [math]::Round($_ / $k, 1) }) } }
    $one = [ordered]@{}; $one['图'] = $png; $one['宽'] = 1280; $one['高'] = [math]::Round($wi.高 / $k); $one['倍数'] = [math]::Round($k, 4); $one['框'] = $fr
    $boxes[$st.截] = $one
    if ($st.树) { Dump-Tree $win (Join-Path $dir "树_$($st.截).json") }
    Write-Host "截了 $png（$($fr.Count) 个框）"
  }
}

function Dump-Tree($win, $path) {
  $r = Get-Frame ([IntPtr]$win.Current.NativeWindowHandle)
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
  $list = New-Object System.Collections.ArrayList
  function Walk($el, $d, $p) {
    if ($d -gt $Depth) { return }
    $c = $el.Current
    $b = $c.BoundingRectangle
    if (-not $b.IsEmpty -and $b.Width -gt 0) {
      $o = [ordered]@{}
      $o['层'] = $d; $o['名'] = $c.Name; $o['种'] = ($c.ControlType.ProgrammaticName -replace '^ControlType[.]', ''); $o['类'] = $c.ClassName
      $o['框'] = @([int]($b.X - $r.L), [int]($b.Y - $r.T), [int]$b.Width, [int]$b.Height); $o['藏'] = $c.IsOffscreen; $o['路'] = $p
      [void]$list.Add($o)
    }
    $k = $walker.GetFirstChild($el); $i = 0
    while ($k) { Walk $k ($d + 1) ("$p/$i"); $k = $walker.GetNextSibling($k); $i++ }
  }
  Walk $win 0 ''
  $doc = [ordered]@{}; $doc['窗口'] = (Get-WinInfo $win); $doc['元素'] = $list
  [System.IO.File]::WriteAllText($path, ($doc | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}

# 照单子一步一步做；写了「可失败」的那步没做成只记一笔、接着往下（锦上添花的步骤用，如截图前滚一下）
function Run-Steps($steps, $dir, $boxes) {
  foreach ($st in $steps) {
    $win = Find-CodexWindow
    if ($st.可失败) { try { Run-Step $win $st $dir $boxes } catch { Write-Host "这步没成，接着往下：$_" } }
    else { Run-Step $win $st $dir $boxes }
  }
}

# 框.json：先读进原来的，这回截到的图换成新的，别的图的框留着（中途停了、接着截也不丢）
function Read-Boxes($path) {
  $boxes = [ordered]@{}
  if (Test-Path $path) { foreach ($p in (Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json).PSObject.Properties) { $boxes[$p.Name] = $p.Value } }
  return $boxes
}
function Save-Boxes($boxes, $path) {
  [System.IO.File]::WriteAllText($path, ($boxes | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
}

$win = Find-CodexWindow
if ($Lesson) {
  $plan = Get-Content -Raw -Encoding UTF8 (Join-Path $Lesson '截图步骤.json') | ConvertFrom-Json
  $bf = Join-Path $Lesson '框.json'
  $boxes = Read-Boxes $bf
  $was = [TutWin]::GetForegroundWindow()   # 截完把前台还给原来那个窗口（用户正在用的）
  try {
    Run-Steps $plan.步骤 $Lesson $boxes
  } finally {
    Save-Boxes $boxes $bf
    foreach ($st in @($plan.收尾)) { if ($st) { try { $win = Find-CodexWindow; Run-Step $win $st $Lesson $null } catch { Write-Host "收尾没做成：$_" } } }
    if ($was -ne [IntPtr]::Zero) { [TutWin]::keybd_event(0x12, 0, 0, [IntPtr]::Zero); [TutWin]::keybd_event(0x12, 0, 2, [IntPtr]::Zero); [void][TutWin]::SetForegroundWindow($was) }
  }
  exit 0
}
if ($Do) { Run-Step $win ($Do | ConvertFrom-Json) $null $null; $win = Find-CodexWindow }
if ($Out) { Save-Shot $win $Out }
if ($Tree) { Dump-Tree $win $Tree }
Get-WinInfo $win | ConvertTo-Json
