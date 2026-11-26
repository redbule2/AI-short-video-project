/* ============================================================
   流水线 · 初步剧本（写初步剧本的段：2026-11-21 起先写提示词，11-26 他定改回先写剧本、叫初步剧本）
   「初步剧本」那一步（剧本.html）和「提炼分镜」那一步（分场.html）都用这几样（11-26 他要提炼那一步也能直接点「提炼分镜」，不用退回初步剧本那一步）：
     pfName、pfParts：这一段的初步剧本叫什么、放在哪（提示词/第N段/初步剧本.txt；老段叫 自由稿.txt）
     pfOld：本机服务太旧，写不了、提炼不了，说一声
     pfExtract：提炼分镜。写稿页盖着的先存上；初步剧本有字才交；记下时间（当剧本定稿用），交给 AI 照它提炼，去「提炼分镜」那一步看
   写稿页顶上的「提炼分镜」（公用/写稿自由稿.js）叫外面这一页的 window.wfFreeExtract。
   在 流水线.js 后面引：用的 F、C、FS、startJob、styleDlg 这些都在那里。
   ============================================================ */
'use strict';
const pfName = seg => C.pfFileIn((F.names.get(seg) || {}).set || []);   // 这一段的初步剧本叫什么：老段叫 自由稿.txt（11-26）
const pfParts = seg => [F.name, '提示词', segName(seg), pfName(seg)];
const pfOld = name => !(LINK.v >= (name === C.PF_FILE ? 29 : 21)) && (toast('本机服务是旧的：重开一次才能写初步剧本', 'err'), true);   // 第 21 版起存得了自由稿、照它提炼；第 29 版起认 初步剧本.txt（11-26）

async function pfExtract(s) {   // 提炼分镜：写稿页盖着的先存上；初步剧本有字才交。提炼过的，AI 在现在的分镜上面改，号不变（本机服务照旧走 redoBook）
  if (SHELL && SHELL.leave && !(await SHELL.leave())) return;
  let text = '';
  try { text = C.decodeText((await FS.read(at(pfParts(s.段)))).buf).text; } catch (e) { /* 还没有 */ }
  if (!text.trim()) { toast('初步剧本还空着：先写好这一段的戏', 'err'); return; }
  if (pfOld(pfName(s.段))) return;
  if (jobLive(jobOf('提炼', s.段))) { go('分场', { s: s.段 }); return; }
  if (hasParas(s) && !(await confirmDlg({ title: '照新的初步剧本重新提炼', body: 'AI 在现在的分镜上面改：没变的照抄，改了的只改那几镜，镜头号留着（提示词、关键帧都认号）。换之前流水线留一版在历史记录。', ok: '重新提炼' }))) return;
  const now = nowText();
  if (!s.头回定稿) s.头回定稿 = now;
  s.剧本定稿 = now; s.定稿 = ''; touch();
  if (!(await startJob({ 事: '提炼', 段: s.段 }))) return;
  if (!filmStyle()) await styleDlg(null, { first: true, lead: '分镜在提炼了，接着定这部片子的拍摄风格（以后能换）。' });
  go('分场', { s: s.段 });
}
window.wfFreeExtract = () => { const s = sceneNow(); if (s && C.isPF(s)) pfExtract(s); };   // 写稿页顶上的「提炼分镜」（公用/写稿自由稿.js：写初步剧本的那一页）
