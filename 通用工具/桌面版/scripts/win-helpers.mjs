/* 试升级、冒烟共用的两样 Windows 小工具。proc 都是给程序名（不带 .exe），或者进程号。
   shotWindows：这个程序开着的窗口各截一张（只画它自己的窗口，别的窗口挡着也不进图）；图放进 dir，叫 prefix_1.png、prefix_2.png……；回的是各窗口的标题。
   clickDialog：等它弹出标题是 title 的提示框，替人点第几个按钮。 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SHOT_CS = [
  'using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text;',
  'public static class TrialShot {',
  '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);',
  '  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);',
  '  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr v);',
  '  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }',
  '  public static string Shot(string proc, string dir, string prefix) {',
  '    SetProcessDpiAwarenessContext(new IntPtr(-4));',
  '    var pids = new HashSet<uint>();',
  '    uint one; if (uint.TryParse(proc, out one)) pids.Add(one); else foreach (var p in Process.GetProcessesByName(proc)) pids.Add((uint)p.Id);',
  '    var outp = new StringBuilder(); int i = 0;',
  '    EnumWindows(delegate (IntPtr h, IntPtr l) {',
  '      uint pid; GetWindowThreadProcessId(h, out pid);',
  '      if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;',
  '      var sb = new StringBuilder(256); GetWindowText(h, sb, 256);',
  '      if (sb.Length == 0) return true;',
  '      RECT r; GetWindowRect(h, out r); int w = r.R - r.L, hh = r.B - r.T;',
  '      if (w < 80 || hh < 60) return true;',
  '      var bmp = new System.Drawing.Bitmap(w, hh);',
  '      using (var g = System.Drawing.Graphics.FromImage(bmp)) { var dc = g.GetHdc(); PrintWindow(h, dc, 2); g.ReleaseHdc(dc); }',
  '      i++; bmp.Save(System.IO.Path.Combine(dir, prefix + "_" + i + ".png"), System.Drawing.Imaging.ImageFormat.Png); bmp.Dispose();',
  '      outp.AppendLine(sb.ToString());',
  '      return true;',
  '    }, IntPtr.Zero);',
  '    return outp.ToString();',
  '  }',
  '}',
].join('\n');

export function shotWindows(proc, dir, prefix) {
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (f.startsWith(prefix + '_')) fs.rmSync(path.join(dir, f), { force: true });
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition $env:ANTOU_CS; [TrialShot]::Shot($env:ANTOU_P, $env:ANTOU_D, $env:ANTOU_X)'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ANTOU_CS: SHOT_CS, ANTOU_P: String(proc), ANTOU_D: dir, ANTOU_X: prefix } });
  return (r.stdout || '').trim().split(/\r?\n/).filter(Boolean);
}

/* 等这个程序弹出标题是 title 的提示框（dialog.showMessageBox 弹的，窗口类 #32770），最多等 wait 秒；
   click 给 0、1…… 就替人点第几个按钮（-1 只看有没有）。回 clicked、seen 或 none。
   按钮不是单独的窗口，按名字找不着（头两回用辅助功能找，都没找着）：
   Electron 给自己起名的按钮编号是 100 起，给提示框发 TDM_CLICK_BUTTON 就是点它。 */
const DLG_CS = [
  'using System; using System.Collections.Generic; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text;',
  'public static class TrialDlg {',
  '  public delegate bool EnumProc(IntPtr h, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);',
  '  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
  '  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);',
  '  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, IntPtr w, IntPtr l, uint flags, uint ms, out IntPtr res);',
  '  public static string Run(string proc, string title, int click, int wait) {',
  '    var end = DateTime.Now.AddSeconds(wait);',
  '    while (DateTime.Now < end) {',
  '      var pids = new HashSet<uint>();',
  '      uint one; if (uint.TryParse(proc, out one)) pids.Add(one); else foreach (var p in Process.GetProcessesByName(proc)) pids.Add((uint)p.Id);',
  '      IntPtr hit = IntPtr.Zero;',
  '      EnumWindows(delegate (IntPtr h, IntPtr l) {',
  '        uint pid; GetWindowThreadProcessId(h, out pid);',
  '        if (!pids.Contains(pid) || !IsWindowVisible(h)) return true;',
  '        var c = new StringBuilder(64); GetClassName(h, c, 64);',
  '        var t = new StringBuilder(256); GetWindowText(h, t, 256);',
  '        if (c.ToString() != "#32770" || t.ToString() != title) return true;',
  '        hit = h; return false;',
  '      }, IntPtr.Zero);',
  '      if (hit != IntPtr.Zero) {',
  '        if (click < 0) return "seen";',
  '        IntPtr res; SendMessageTimeout(hit, 0x0466, new IntPtr(100 + click), IntPtr.Zero, 2, 3000, out res);',
  '        return "clicked";',
  '      }',
  '      System.Threading.Thread.Sleep(300);',
  '    }',
  '    return "none";',
  '  }',
  '}',
].join('\n');
export function clickDialog(proc, title, click, wait) {
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    'Add-Type -TypeDefinition $env:ANTOU_CS; [TrialDlg]::Run($env:ANTOU_P, $env:ANTOU_T, [int]$env:ANTOU_N, [int]$env:ANTOU_WAIT)'],
    { encoding: 'utf8', windowsHide: true, env: { ...process.env, ANTOU_CS: DLG_CS, ANTOU_P: String(proc), ANTOU_T: title, ANTOU_N: String(click), ANTOU_WAIT: String(wait) } });
  return (r.stdout || '').trim();
}
