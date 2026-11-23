"""教程工具的测试：
① 配音.py 的 series_file：这套教程（课的上一层）自己有 声音参考.wav、配音设置.json 就用自己的，没有就用 流水线教程 的；
② 截窗口.ps1 能被 PowerShell 5.1 读通（带 BOM、没有语法错），「打字」（剪贴板被别的程序抢着读也贴得对）「等到」（含藏）「可失败」「窗口：最小化」做得对；
③ 配音设置里的「情绪」（八个数传给 IndexTTS2.5）、「语气参考」（一段录音只借语气，和情绪只能写一个）和「美化」（ffmpeg 声音滤镜，用 IndexTTS 的 Python 跑）；
④ 「起伏让分」「毛刺容差」：先看像不像，差不多像的几遍里去掉毛刺多的，再挑音高起伏最大的；「压毛刺」只压元音里的高频。
跑法：python -I -X utf8 教程配音套_测试.py（本机用 Codex 自带的 python）"""

import importlib.util
import os
import subprocess
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent / "流水线教程"
spec = importlib.util.spec_from_file_location("peiyin", TOOLS / "配音.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

fails = 0


def check(ok, what):
    global fails
    print(("通过  " if ok else "没过  ") + what)
    if not ok:
        fails += 1


root = Path(tempfile.mkdtemp())
own = root / "Codex教程"
(own / "第1课_界面和模型").mkdir(parents=True)
(own / "声音参考.wav").write_bytes(b"RIFF")
bare = root / "别的教程"
(bare / "第1课").mkdir(parents=True)

check(mod.series_file(str(own / "第1课_界面和模型"), "声音参考.wav") == str(own / "声音参考.wav"), "自己有音色，用自己的")
check(mod.series_file(str(own / "第1课_界面和模型"), "配音设置.json") == os.path.join(mod.ROOT, "配音设置.json"), "自己没设置，用流水线教程的")
check(mod.series_file(str(bare / "第1课"), "声音参考.wav") == os.path.join(mod.ROOT, "声音参考.wav"), "什么都没有，全用流水线教程的")
check(mod.series_file(str(TOOLS / "第1课_打开流水线"), "声音参考.wav") == os.path.join(mod.ROOT, "声音参考.wav"), "流水线教程自己的课照旧")

ps1 = TOOLS / "截窗口.ps1"
check(ps1.read_bytes()[:3] == b"\xef\xbb\xbf", "截窗口.ps1 带 BOM")
cmd = ("$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('%s', [ref]$null, [ref]$e); "
       "if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }" % str(ps1).replace("'", "''"))
r = subprocess.run(["powershell.exe", "-NoProfile", "-Command", cmd], capture_output=True)
check(r.returncode == 0, "截窗口.ps1 没有语法错" + ("" if r.returncode == 0 else "：" + r.stdout.decode("gbk", "replace")))

# 「打字」「等到」两步：从 截窗口.ps1 里只取这两个函数，找界面、按键换成假的，看它们自己的做法对不对
probe = root / "打字等到.ps1"
probe.write_text(r"""
Add-Type -AssemblyName System.Windows.Forms
$ast = [System.Management.Automation.Language.Parser]::ParseFile('%s', [ref]$null, [ref]$null)
foreach ($f in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and @('Type-Text', 'Wait-El', 'Get-Clip', 'Set-Clip') -contains $a.Name }, $true)) { . ([scriptblock]::Create($f.Extent.Text)) }
function Find-CodexWindow { 'win' }
$script:tries = 0
function Find-El($win, $spec) { $script:tries++; if ($spec -eq '第三回才有' -and $script:tries -ge 3) { return 'el' }; throw 'no' }
Wait-El 'win' '第三回才有' 5000 | Out-Null
$a = $script:tries -eq 3
$t0 = Get-Date; $b = $false
try { Wait-El 'win' '一直没有' 1200 } catch { $b = $_.Exception.Message.Contains('还没有：一直没有') }
$b = $b -and ((Get-Date) - $t0).TotalSeconds -lt 4
$keep = Get-Clip
$c = $true
for ($i = 0; $i -lt 5; $i++) {   # 连贴几回：剪贴板被别的程序抢着读时也要贴对、放回
  Set-Clip '原来的字'
  $script:keys = $null; $script:seen = $null
  function Send-Keys($win, $keys) { $script:keys = $keys; $script:seen = Get-Clip }
  Type-Text 'win' 'Token 是什么？'
  $c = $c -and ($script:keys -eq '^v') -and ($script:seen -eq 'Token 是什么？') -and ((Get-Clip) -eq '原来的字')
}
if ($null -ne $keep) { Set-Clip $keep } else { [System.Windows.Forms.Clipboard]::Clear() }
Write-Output "$a $b $c"
""" % str(ps1).replace("'", "''"), encoding="utf-8-sig")
r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(probe)], capture_output=True)
got = r.stdout.decode("gbk", "replace").strip().splitlines()
got = got[-1] if got else r.stderr.decode("gbk", "replace")
check(got == "True True True", "截窗口.ps1「等到」找到就往下、等不到按时报错；「打字」走剪贴板贴、贴完放回原来的字（%s）" % got)

# 「含藏」「可失败」「最小化」：取出 Wait-El、Run-Step、Run-Steps、Set-WindowShape，窗口操作换成假的 TutWin 记账
probe = root / "含藏可失败窗口.ps1"
probe.write_text(r"""
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @"
using System;
public static class TutWin {
  public struct RECT { public int L, T, R, B; }
  public static bool Iconic = true;
  public static string Log = "";
  public static bool IsIconic(IntPtr h) { return Iconic; }
  public static bool ShowWindow(IntPtr h, int c) { Log += "S" + c + " "; if (c == 9) Iconic = false; if (c == 6) Iconic = true; return true; }
  public static bool IsZoomed(IntPtr h) { return false; }
  public static bool GetWindowRect(IntPtr h, out RECT r) { r = new RECT(); r.R = 1920; r.B = 1080; return true; }
  public static bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f) { Log += "P "; return true; }
}
"@
$ast = [System.Management.Automation.Language.Parser]::ParseFile('%s', [ref]$null, [ref]$null)
function Load($names) { foreach ($f in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $a.Name }, $true)) { . ([scriptblock]::Create($f.Extent.Text)) } }
function Find-CodexWindow { 'win' }
function Get-Frame($h) { $r = New-Object TutWin+RECT; $r.R = 1920; $r.B = 1080; return $r }

. Load @('Wait-El')
function Find-El($win, $spec, $off) { if ($off) { return 'el' }; throw 'no' }
Wait-El 'win' '滚上去的按钮' 3000 $true | Out-Null
$a = $true
$b = $false
try { Wait-El 'win' '滚上去的按钮' 1000 } catch { $b = $_.Exception.Message.Contains('还没有') }

. Load @('Run-Step')
function Wait-El($win, $spec, $ms, $off) { $script:got = "$spec|$ms|$off" }
Run-Step 'win' ([pscustomobject]@{ '等到' = '评价回复@Button#2'; '最多' = 1000; '含藏' = $true }) $null $null
$c = $script:got -eq '评价回复@Button#2|1000|True'
Run-Step 'win' ([pscustomobject]@{ '等到' = '评价回复@Button'; '最多' = 1000 }) $null $null
$c = $c -and ($script:got -eq '评价回复@Button|1000|False')

. Load @('Run-Steps')
$script:done = ''
function Run-Step($win, $st, $dir, $boxes) { $script:done += $st.n; if ($st.bad) { throw 'bad' } }
Run-Steps @([pscustomobject]@{ n = '一' }, [pscustomobject]@{ n = '二'; bad = $true; '可失败' = $true }, [pscustomobject]@{ n = '三' }) $null $null
$d = $script:done -eq '一二三'
$e = $false
try { Run-Steps @([pscustomobject]@{ n = '四'; bad = $true }, [pscustomobject]@{ n = '五' }) $null $null } catch { $e = $script:done -eq '一二三四' }

. Load @('Set-WindowShape')
$w = [pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = 1 } }
Set-WindowShape $w '铺满'
$f = [TutWin]::Log.StartsWith('S9 P ')
[TutWin]::Log = ''; Set-WindowShape $w '最小化'
$g = ([TutWin]::Log -eq 'S6 ') -and [TutWin]::Iconic
[TutWin]::Log = ''; Set-WindowShape $w '最大化'
$h = [TutWin]::Log -eq 'S9 S3 '
Write-Output "$a $b $c $d $e $f $g $h"
""" % str(ps1).replace("'", "''"), encoding="utf-8-sig")
r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(probe)], capture_output=True)
got = r.stdout.decode("gbk", "replace").strip().splitlines()
got = got[-1] if got else r.stderr.decode("gbk", "replace")
check(got == "True True True True True True True True",
      "截窗口.ps1「等到」含藏时滚出屏幕的也算、Run-Step 照传；「可失败」的步骤没成接着往下、别的步骤没成就停；"
      "最小化着的窗口先还原再铺满或最大化，「最小化」收回去（%s）" % got)

# 切前台、「焦点」、框.json 接着记：假的 TutWin 记下切前台怎么切的；焦点核对用真的无障碍树（桌面和它的第一个孩子）
probe = root / "前台焦点框.ps1"
probe.write_text(r"""
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type @"
using System;
public static class TutWin {
  public static long Fg = 5; public static bool Obey = true; public static bool ObeyAfterAlt = true; public static bool Alt = false;
  public static string Log = "";
  public static IntPtr GetForegroundWindow() { return new IntPtr(Fg); }
  public static uint GetWindowThreadProcessId(IntPtr h, IntPtr p) { return 77; }
  public static uint GetCurrentThreadId() { return 11; }
  public static bool AttachThreadInput(uint a, uint b, bool f) { Log += f ? "A+ " : "A- "; return true; }
  public static bool BringWindowToTop(IntPtr h) { return true; }
  public static bool SetForegroundWindow(IntPtr h) { Log += "F "; if (Obey || (Alt && ObeyAfterAlt)) { Fg = h.ToInt64(); } return true; }
  public static void keybd_event(byte k, byte s, uint f, IntPtr e) { if (k == 0x12) { Alt = true; Log += "Alt "; } }
}
"@
$ast = [System.Management.Automation.Language.Parser]::ParseFile('%s', [ref]$null, [ref]$null)
function Load($names) { foreach ($f in $ast.FindAll({ param($a) $a -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $a.Name }, $true)) { . ([scriptblock]::Create($f.Extent.Text)) } }
. Load @('Bring-Front', 'Test-Inside', 'Read-Boxes', 'Save-Boxes', 'Run-Step')
$w = [pscustomobject]@{ Current = [pscustomobject]@{ NativeWindowHandle = 1 } }

[TutWin]::Fg = 1; Bring-Front $w
$a = [TutWin]::Log -eq ''
[TutWin]::Fg = 5; Bring-Front $w
$b = ([TutWin]::Log -eq 'A+ F A- ') -and ([TutWin]::Fg -eq 1)
[TutWin]::Log = ''; [TutWin]::Fg = 5; [TutWin]::Obey = $false; Bring-Front $w
$c = ([TutWin]::Log -eq 'A+ F A- Alt Alt F ') -and ([TutWin]::Fg -eq 1)
[TutWin]::Log = ''; [TutWin]::Fg = 5; [TutWin]::Alt = $false; [TutWin]::ObeyAfterAlt = $false; $d = $false
try { Bring-Front $w } catch { $d = $_.Exception.Message.Contains('前台') }

$root = [System.Windows.Automation.AutomationElement]::RootElement
$kid = [System.Windows.Automation.TreeWalker]::RawViewWalker.GetFirstChild($root)
$e = (Test-Inside $kid $root) -and -not (Test-Inside $root $kid)

$bf = Join-Path $env:TEMP ('框测试_' + [guid]::NewGuid().ToString('N') + '.json')
[System.IO.File]::WriteAllText($bf, '{"甲": {"图": "截图_甲.png", "框": {"x": [1, 2, 3, 4]}}}', (New-Object System.Text.UTF8Encoding($false)))
$bx = Read-Boxes $bf
$bx['乙'] = [ordered]@{ '图' = '截图_乙.png' }
Save-Boxes $bx $bf
$again = Get-Content -Raw -Encoding UTF8 $bf | ConvertFrom-Json
$f = ($again.甲.框.x[2] -eq 3) -and ($again.乙.图 -eq '截图_乙.png') -and ((Read-Boxes (Join-Path $env:TEMP '没有这个文件.json')).Count -eq 0)
Remove-Item $bf

function Focus-El($win, $spec) { $script:fo = $spec }
Run-Step 'win' ([pscustomobject]@{ '焦点' = '随心输入@Edit' }) $null $null
$g = $script:fo -eq '随心输入@Edit'
Write-Output "$a $b $c $d $e $f $g"
""" % str(ps1).replace("'", "''"), encoding="utf-8-sig")
r = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(probe)], capture_output=True)
got = r.stdout.decode("gbk", "replace").strip().splitlines()
got = got[-1] if got else r.stderr.decode("gbk", "replace")
check(got == "True True True True True True True",
      "截窗口.ps1 切前台先借输入队列、不行才按 Alt、都不行就停；焦点核对认得出落在里面；"
      "框.json 读进原来的、加上新的一起存；「焦点」交给 Focus-El（%s）" % got)

check(mod.emo_args({}) == {}, "没写情绪：不传")
check(mod.emo_args({"情绪": [0.3, 0, 0, 0, 0, 0, 0, 0]}) == {"emo_vector": [0.3, 0, 0, 0, 0, 0, 0, 0]}, "写了情绪：照传八个数")
check(mod.emo_args({"情绪": [1, 0, 0, 0, 0, 0, 0, 0]}, lambda v: [a / 2 for a in v])["emo_vector"][0] == 0.5, "情绪过一遍模型自带的校正")
try:
    mod.emo_args({"情绪": [0.3]})
    bad = False
except SystemExit:
    bad = True
check(bad, "情绪不是八个数：报错")

(own / "语气参考.wav").write_bytes(b"RIFF")
lesson = str(own / "第1课_界面和模型")
check(mod.emo_args({"语气参考": "语气参考.wav"}, folder=lesson) == {"emo_audio_prompt": str(own / "语气参考.wav"), "emo_alpha": 0.6},
      "语气参考：在这套教程里找到，强度默认 0.6")
check(mod.emo_args({"语气参考": str(own / "语气参考.wav"), "语气参考强度": 0.8}, folder=lesson)["emo_alpha"] == 0.8, "语气参考：写完整路径、强度照写")
for bad_cfg, what in [({"语气参考": "语气参考.wav", "情绪": [0.3, 0, 0, 0, 0, 0, 0, 0]}, "情绪和语气参考都写：报错"),
                      ({"语气参考": "没有这个.wav"}, "语气参考找不到：报错"),
                      ({"语气参考": "语气参考.wav", "语气参考强度": 1.5}, "语气参考强度超过 1：报错")]:
    try:
        mod.emo_args(bad_cfg, folder=lesson)
        bad = False
    except SystemExit:
        bad = True
    check(bad, what)

code = r"""
import sys, tempfile, numpy as np
sys.path.insert(0, r"%s")
import 配音 as P
d = tempfile.mkdtemp()
sr = 48000
x = (0.4 * np.sin(np.arange(sr) * 2 * np.pi * 440 / sr)).astype(np.float32)
y = P.polish(x, sr, "volume=0.5", d)
print("美化", P.polish(x, sr, "", d) is x, round(float(np.abs(y).max() / np.abs(x).max()), 2), len(y) == len(x))
t = np.arange(sr * 2) / sr
flat = (0.3 * np.sin(2 * np.pi * 150 * t)).astype(np.float32)
f = 150 * 2 ** (4 * np.sin(2 * np.pi * 0.7 * t) / 12)
wavy = (0.3 * np.sin(2 * np.pi * np.cumsum(f) / sr)).astype(np.float32)
print("起伏", P.liveliness(flat, sr) < 0.5, P.liveliness(wavy, sr) > 2)
rng = np.random.default_rng(0)
def band(a, b):
    X = np.fft.rfft(rng.standard_normal(len(t)))
    fr = np.fft.rfftfreq(len(t), 1 / sr)
    X[(fr < a) | (fr > b)] = 0
    y = np.fft.irfft(X, len(t))
    return y / np.abs(y).max()
def hf(x):
    X = np.abs(np.fft.rfft(x)) ** 2
    fr = np.fft.rfftfreq(len(x), 1 / sr)
    return 10 * np.log10(X[(fr >= 4000) & (fr < 10000)].sum())
vowel = (sum((0.3 / k) * np.sin(2 * np.pi * 150 * k * t) for k in range(1, 26)) + 0.02 * band(5000, 10000)).astype(np.float32)
fric = (0.3 * band(4000, 10000)).astype(np.float32)
drop = P.fizz(vowel, sr) - P.fizz(P.defizz(vowel, sr, 6), sr)
print("毛刺", drop >= 4, abs(hf(P.defizz(fric, sr, 6)) - hf(fric)) < 1, P.defizz(vowel, sr, 0) is vowel, len(P.defizz(vowel, sr, 6)) == len(vowel))
""" % TOOLS
r = subprocess.run([mod.PY["IndexTTS2.5"], "-X", "utf8", "-c", code], capture_output=True)
got = {l.split(" ", 1)[0]: l.split(" ", 1)[1] for l in r.stdout.decode("utf-8", "replace").splitlines() if " " in l}
err = r.stderr.decode("utf-8", "replace")[-300:]
check(got.get("美化") == "True 0.5 True", "美化：不写不动，写了照滤镜走（%s）" % got.get("美化", err))
check(got.get("起伏") == "True True", "起伏：平的音高近 0，上下摆四个半音的明显大（%s）" % got.get("起伏", err))
check(got.get("毛刺") == "True True True True", "压毛刺：元音里的高频沙沙声压下去 4 dB 以上，嘶嘶的辅音不动，不写不动，长短不变（%s）" % got.get("毛刺", err))

# 每遍：(声音, 像, 字每秒, 用得上, 起伏, 毛刺)
takes = [("甲", 0.90, 5, True, 3.0, -25), ("乙", 0.89, 5, True, 4.5, -22), ("丙", 0.85, 5, True, 6.0, -26)]
check(mod.pick_take(takes, 0)[0] == "甲", "不让分：挑最像的")
check(mod.pick_take(takes, 0.02)[0] == "乙", "让 0.02：差不多像的里挑起伏大的")
check(mod.pick_take(takes, 0.02, 2)[0] == "甲", "毛刺容差 2：毛刺比最干净那遍多 3 dB 的不要")
check(mod.pick_take(takes, 0.1)[0] == "丙", "让得多：起伏最大的也算进来")
check(mod.pick_take([("甲", 0.9, 5, True, 4.0, -25), ("乙", 0.89, 5, True, 4.0, -25)], 0.02)[0] == "甲", "起伏一样：还是挑更像的")

print("全部通过" if not fails else "没过 %d 条" % fails)
raise SystemExit(1 if fails else 0)
