'use strict';
/* ============================================================
   交给 AI 写完（2026-11-21 他定：「没有 AI 铺底这一说，人写了分镜以后，剩下工作 AI 一次性完结」）。
   人在写稿页写好事件脚本（新稿是自由模式的一大段），点「交给 AI 写完」，剩下的 AI 一次写完：
     分镜：自由模式写的一大段照人写的拆成一镜一镜、扩写；分区、合并两种一起写，提示词里放分区（这一条拨成合并的照合并），另一种记进写稿资料备选（shot-styles.js）。
       已经是一镜一镜的（分镜模式，人写的或改过的），镜头一个字不动。
     生成目标（11-21 起归 AI）、素材、基础设定、主体与关系、保持一致、事件脚本最后「声音包括……」那一行。顺手登记素材、估每一镜几秒。
   写过的几块先判断要不要改：对得上一个字不动（11-14 他定的规矩）；还空着的一定要写。原来那一版先留一份进历史记录。
   素材里白模、关键帧那几句一字照抄，只有说到的第几镜可以照事件脚本的镜头号改（拆成新镜头以后号会变）。
   写稿页（通用工具/公用/写稿写完.js）点「交给 AI 写完」开；和别的 AI 任务一样复制给你自己的 AI（11-15 起流水线不直接调 AI）。
   以前分两步：「AI 铺底」（直接铺底，pe-lay.js）和「AI 整理成分镜」（整理分镜，shot-styles.js），11-21 并成这一个，那两个删了。
   测试：通用工具/测试/分镜提示词_任务测试.js（写完的几块）、分镜两种写法_任务测试.js（拆镜头）
   ============================================================ */
const path = require('path');

module.exports = function makeFinish(d) {
  const { fsp, pj, str, fail, segDir, exists, unbom, oneLine, today, TAIL, PromptDraft, Secs, Voice, BmKey, isNarr,
    readFlow, sceneOf, scriptPath, srcPath, isPF, finalOk, isPeText, vpNeed, vpPath, vpLabel, regOf, vidsOf, framesOf, frameImgs, framePart, bmPart,
    geoPart, saveGeo, lookPart, lessonsOf, pePart, PE_FORMAT, PE_DRAMA, sceneImgs, txtsOf, TxtWord, voiceAssets, voiceRule, settingText, sceneText, docText, shotsOf,
    refsIn, withFileLocks, sideOf, keepCopy, writeFile, resha, putSecs, secsSay, Styles, noFilmed = async () => {} } = d;   // noFilmed：出过片的稿不写（11-22，filmed.js）
  const Z = PromptDraft ? PromptDraft.Zoned : null;
  const PE_HEAD_SET = new Set(PromptDraft ? Object.values(PromptDraft.PE_HEADS) : []);   // sd2.5PE 的几个段名
  /* 人写的那一块：事件脚本（不含最后「声音包括」那一行），一行一项。和写稿页 公用/写稿写完.js 一个算法 */
  const humanLines = doc => PromptDraft.shotText(doc).split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l && !PromptDraft.isLook(l));
  const humanKey = doc => Z.key(humanLines(doc));
  /* 要不要拆成镜头：自由模式写的（写稿资料记着「自由」）、还没有一镜、镜头外面还有一段没分镜的字，都拆；已经一镜一镜的不动 */
  const toSplit = (doc, side) => side.写法 === '自由' || !doc.shots.length || (doc.shotsPre || []).some(l => String(l).trim() && !PromptDraft.isLook(String(l).trim()));
  const PARTS = [['event', '生成目标'], ['refs', '素材'], ['basic', '基础设定'], ['seg', '主体与关系'], ['keep', '保持一致'], ['look', '「声音包括」那一行']];
  const partsOf = doc => ({ event: str(doc.event).trim(), refs: doc.refs.join('\n'), basic: doc.basic.filter(l => !PromptDraft.isLook(l)).join('\n'), seg: doc.seg.join('\n'), keep: str(doc.keep).trim(), look: doc.basic.filter(l => PromptDraft.isLook(l)).join('\n') });
  const NEED = [['event', '生成目标'], ['basic', '基础设定'], ['keep', '保持一致']];   // 写完以后这几块一定要有字
  function aiPartsText(doc) {   // AI 写的几块现在什么样（交给 AI 看，对得上的照留）
    const p = partsOf(doc);
    return [p.event ? '【生成目标】\n' + p.event : '', p.refs ? '【素材】\n' + p.refs : '', p.basic ? '【基础设定】\n' + p.basic : '', p.seg ? '【主体与关系】\n' + p.seg : '',
      p.keep ? '【保持一致】\n' + p.keep : '', p.look ? '【声音】\n' + p.look : ''].filter(Boolean).join('\n') || '（还空着）';
  }
  /* AI 回的几块：行首的【块名】到下一个块名之前。素材里的【参考素材职责】【人物】这些不是块名，留在素材里 */
  const NAMES = ['判断', 'GEO底稿', '标题', '合并', '分区', '生成目标', '素材', '基础设定', '主体与关系', '保持一致', '声音', '素材登记', '秒数'];
  const HEAD_RE = new RegExp('^[ \\t]*【(' + NAMES.join('|') + ')】', 'gm');
  function blocksOf(text) {
    const t = String(text || '').replace(/\r\n?/g, '\n'), hits = [], got = {};
    let m;
    HEAD_RE.lastIndex = 0;
    while ((m = HEAD_RE.exec(t))) hits.push({ name: m[1], at: m.index, from: m.index + m[0].length });
    hits.forEach((x, i) => { if (!(x.name in got)) got[x.name] = t.slice(x.from, i + 1 < hits.length ? hits[i + 1].at : t.length); });
    return got;
  }
  const linesOf = t => String(t || '').split('\n').map(l => l.trim()).filter(l => l && !/^\x60\x60\x60/.test(l));
  const none = ls => ls.length === 1 && /^[（(]?(无|没有|不写|不用)[）)]?[。.]?$/.test(ls[0]);
  const clean = ls => none(ls) ? [] : ls.filter(l => !PE_HEAD_SET.has(l.replace(/\s+/g, '')) && !/^镜头\s*[0-9０-９]+\s*[：:]/.test(l));   // 段名、混进来的镜头行不要
  const isTwo = refs => refs.some(l => /^【(人物|道具|场景|动作与声音)】$/.test(l.replace(/\s+/g, '')));   // 素材写法二：不写【主体与关系】
  /* 白模、关键帧那几句：要一字不差地还在，只有说到的第几镜可以改（留着〔〕的可以填） */
  const anchorOf = doc => doc.refs.filter(l => /@视频\d+|首帧|尾帧|关键帧/.test(l) && !/〔[^〕]*〕/.test(l));
  const anchorKey = l => String(l).replace(/镜头\s*[0-9０-９]+/g, '镜头#').replace(/\s+/g, '');

  /* 能不能写：剧本定稿了（先写提示词的段：分镜定下来了，11-21）、新格式的稿、事件脚本有字。点的时候 prep 就查，当场说清 */
  async function check(j) {
    await noFilmed(j);   // 出过片的稿不能改（11-22 他定）：要写完先另存成新的一版
    const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), pf = !!isPF && isPF(s), sp = srcPath ? srcPath(j.项目, s, j.段) : scriptPath(j.项目, j.段);
    if (!s || !(await exists(sp)) || !finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs))) throw fail(pf ? '分镜定下来以后才能交给 AI 写完（初步剧本改过的，先到「提炼分镜」点「照旧」或「重新提炼」）' : '剧本定稿以后才能交给 AI 写完：先到剧本页点「剧本定稿」');
    if (pf && !s.定稿) throw fail('分镜定下来以后才能交给 AI 写完：先到「提炼分镜」那一步点「定下来」');
    const raw = unbom(await fsp.readFile(vpPath(j), 'utf8'));
    if (raw.trim() && !isPeText(raw)) throw fail('这一条是旧格式的稿，AI 写完只认新格式的：在写稿页里写批注，交给 AI 改');
    const doc = PromptDraft.parse(raw);
    if (!humanLines(doc).length) throw fail('事件脚本还空着：先写好这几镜里发生什么，再交给 AI 写完');
    return { flow, s, sp, raw, doc, side: await sideOf(j), pf };
  }

  const 写完提示词 = {
    title: j => 'AI 写完 · 第' + j.段 + '段 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
    async prep(j) { await vpNeed(j); if (!PromptDraft || !Z || !Styles) throw fail('读不了 公用/写稿状态.js'); await check(j); },
    async book(j) {
      const { flow, s, sp, raw, doc, side, pf } = await check(j), split = toSplit(doc, side), p = partsOf(doc);
      j.拆 = split;
      j.底 = humanKey(doc);   // 交出去的是哪一版：等回来的时候人又改过，就不往里写
      j.已写 = !!(p.event || p.basic || p.keep);   // 写过的：先判断要不要改，对得上就一个字不动
      j.空 = NEED.filter(([k]) => !p[k]).map(([k]) => k);
      const regs = await regOf(j), vids = vidsOf(regs), frames = framesOf(j, regs, s), shots = shotsOf(s, j.名);
      const scriptTx = await docText(sp), narr = !!Voice && (Voice.narrates(scriptTx) || (s.人物 || []).some(isNarr));   // 剧本里有旁白（11-17）
      const vo = await voiceAssets(j.项目, s, flow, narr), txts = await txtsOf(j, flow, s);
      const assets = [...sceneImgs(flow, s).map(x => ({ line: x.行, path: x.f })), ...vo.map(v => ({ line: v.line, path: v.path })),
        ...vids.map(v => ({ line: '白模视频（这一条已经挂成 ' + v.ref + '）：' + v.path, path: v.path })),
        ...frames.map(f => ({ line: '关键帧（这一条已经挂成 ' + f.ref + '）：' + f.path, path: f.path }))];
      j.assets = [...new Set(assets.map(x => x.path))];
      const perShot = !!BmKey && BmKey.isBmk(raw);   // 一镜一镜写参考哪张的老稿：关键帧照它原来的写法
      const gp = await geoPart(j, s.场景图, s), pm = await pePart(j, { voice: vo.length > 0, bm: vids.length > 0, frame: frames.length > 0 && !perShot });
      j.images = [...gp.images, ...frameImgs(j, frames)];
      j.geoMake = gp.make;
      const bm = await bmPart(j, vids) + framePart(frames, '关键帧那几句已经在素材里的照原样留着（顺序句、首帧尾帧、第几个关键帧；编号和先后都不改，只有说到的第几镜照事件脚本的镜头号改）；还留着〔〕的，照图把这一刻看得见的构图、人物位置、姿态、镜头方向填上（图已经让你看过）。', raw, s, shots);
      const look = await lookPart(j.项目, flow, s, '写', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'), lessons = await lessonsOf();
      const hasLook = !!p.look, emptyNames = j.空.map(k => NEED.find(x => x[0] === k)[1]);
      const rules = [];
      const add = t => rules.push((rules.length + 1) + '. ' + t);
      const byList = pf && split && shots && shots.length;   // 写初步剧本的段（11-21 起）：照镜头表拆，戏照初步剧本
      if (byList) add('照镜头表拆：这一条拍镜头表里的镜头 ' + shots.join('、') + '（见下面「这一段」的镜头表），镜头表的一个镜头写成一镜，镜头号从 1 连着编（镜头1 是镜头表的镜头' + shots[0] + '，依次往后），不多拆、不合并；镜头表里别的镜头的戏不写。每一镜照下面「人写的事件脚本」里写这一镜的那几句来（它是照初步剧本备的，人改过的照人改的）：人写的动作、台词原话、机位、运镜、声音都带上，先后不变；没写的事不加。错别字改掉。');
      if (split) {
        if (!byList) add('照人写的来：人写了的事都要有，先后不变；人没写的事不加。错别字改掉。一镜只讲一两件事；人写的一段里有好几件事、换了机位的，拆成几镜。');
        add('写成看得见的：「子弹打光」「耗尽」这类剧情话，写成看得见的动作和结果；照下面「写戏规矩」写。' + Styles.NAME_RULE);
        add('同一组镜头写两份：镜头数、先后、每一镜拍的东西两份都一样，只是写法不同。分区：' + Styles.how('分区') + '合并：' + Styles.how('合并') + '镜头号从 1 连着编。每一镜起个短标题（10 个字以内），只给人看，不进提示词。不写总时长。');
      } else add('人写的【事件脚本】一个字都不改，也不要抄进回复；镜头里的人物、道具、场景照他写的称谓对上素材。');
      add('【生成目标】照下面「提示词格式」写一段：这一条拍什么、谁要什么、结束时什么样，和事件脚本对得上。');
      add('素材照下面「提示词格式」第 1、2、3 条：这一条挂的素材五份以内用写法一（从【参考素材职责】起，挂了没用上的接【未采用素材】），多于五份用写法二（从【人物】起，按【人物】【道具】【场景】【动作与声音】分组，不写【主体与关系】）。只能挂下面「能用的资产」里的，镜头里看得见的人物、道具、场景都要挂；@图片 从 1 连着编。' + (txts.length ? TxtWord.PROMPT_RULE : ''));
      add('下面「已经挂好的」编号不能改，同一个文件就用这个编号。素材里已经有的白模、关键帧那几句一字照抄，留在原来的位置；只有句子里说到第几镜的，照事件脚本的镜头号改（还留着〔〕的照图、照事件脚本填上）。');
      add('【基础设定】照第 10 条写三行：影像风格、摄影、光色基调。【主体与关系】照第 4 条写（写法二回「无」）。【保持一致】照第 6 条写一句。' + (hasLook ? '' : '【声音】写一行「声音包括……。」（事件脚本最后那一行），照镜头里写到的声音写。'));
      add(gp.rule);
      if (vo.length) add(voiceRule(vo));
      if (Secs) add(Secs.ASK);
      add('回复照这个样子，块名照抄、各占一行，不写的块回「无」：');
      const eg = [...(j.已写 ? ['【判断】', '对得上（或：要改）', '一句话说为什么'] : []), ...(gp.make ? ['【GEO底稿】', '（照 scene-geo 第五节模板写的底稿）'] : []),
        ...(split ? ['【标题】', '镜头1：……', '【分区】', ...Styles.egOf('分区'), '【合并】', ...Styles.egOf('合并')] : []),
        '【生成目标】', '……', '【素材】', '（素材那几段，带段名：写法一从【参考素材职责】起，写法二从【人物】起）', '【基础设定】', '影像风格：……', '摄影：……', '光色基调：……',
        '【主体与关系】', '（几个人、各是谁，开场谁在哪、朝着谁，道具，场景空间）', '【保持一致】', '保持……稳定。', ...(hasLook ? [] : ['【声音】', '声音包括……。']),
        '【素材登记】', '[{"ref": "@图片1", "name": "称谓", "path": "资产/……png"}]', ...(Secs ? Secs.ASK_EG : [])];
      const judge = j.已写 ? ['0. 回复最前面先写【判断】：第一行只写「对得上」或「要改」，说的是下面「你写过的几块」还要不要改；第二行一句话说为什么（要改就说改哪几块）。对得上的，那几块回「无」；要改的，要改的那几块整块写全，没问题的回「无」，程序照原样留着。'
        + (emptyNames.length ? '还空着的' + emptyNames.join('、') + '不管怎么判断都要写。' : '') + (split ? '分镜是新拆的，不管怎么判断都要写。' : '')] : [];
      return ['# 任务：把人写的视频提示词写完（人只写了事件脚本，剩下的都由你写）', '',
        '今天 ' + today() + '。这是一个 AI 短视频项目。' + (pf ? '这一段的剧本是人写的初步剧本（就是下面「定稿的剧本」那一节），照它提炼了镜头表；这一条视频提示词的【事件脚本】是照初步剧本备的' : '这一段的剧本已经定稿，人照剧本写了这一条视频提示词的【事件脚本】') + (shots && shots.length ? '（这一条拍镜头表里的镜头 ' + shots.join('、') + '）' : '') + '。请照 sd25-pe 把剩下的写完：'
        + (split ? '先把人写的事件脚本拆成一镜一镜、扩写成分镜（分区、合并两种写法各写一份），再写' : '事件脚本已经是一镜一镜的，镜头一个字不改；写') + '生成目标、素材、基础设定、主体与关系、保持一致' + (hasLook ? '' : '，和事件脚本最后那一行「声音包括……」') + '。',
        ...(j.已写 ? ['', '这一条以前写过几块（见下面「你写过的几块」）。先判断它们和现在的' + (pf ? '' : '剧本、') + '资产、人写的事件脚本' + (split ? '（拆成的新镜头）' : '') + '还对不对得上：对得上就不用改，程序一个字都不动；对不上才改。' + (pf ? '初步剧本只是初稿，事件脚本和它不一样的照事件脚本，不算对不上。' : '')] : []),
        '', '## 要求', ...judge, ...rules, ...eg,
        '', pm.text,
        '', split ? (byList ? '## 人写的事件脚本（照初步剧本备的；这一条只写上面说的那几镜）' : '## 人写的事件脚本（要拆成分镜的就是它）') : '## 这一条的事件脚本（人写的，一个字都不改）', humanLines(doc).join('\n'),
        '', '## 你写过的几块（对得上的照留）', aiPartsText(doc),
        '', '## 已经挂好的', regs.map(r => r.ref + '：' + r.path + (r.from === '挂图' ? '（人在写稿页挂的）' : '')).join('\n') || '（还没有）',
        '', '## 能用的资产', assets.map(x => x.line).join('\n') || '（没有）', ...(txts.length ? ['', TxtWord.promptPart(txts)] : []), bm,
        '', '## 全片的设定', settingText(flow), look, gp.text,
        '', '## 这一段：第' + j.段 + '段｜' + str(s.名).trim(), sceneText(flow, s),
        '', '## 定稿的剧本', scriptTx, lessons ? '\n## 公用教训（写的时候记着）\n' + lessons : '', '', PE_FORMAT, ...(split ? ['', PE_DRAMA] : []), ...(gp.ref ? ['', gp.ref] : []), TAIL].join('\n');
    },
    async apply(j, text) {
      const got = blocksOf(text), blk = n => linesOf(got[n]);
      const judge = blk('判断'), same = !!j.已写 && /^对得上/.test(judge[0] || ''), why = oneLine(judge.slice(1).join(' ')).slice(0, 120);   // 写过的先判断：对得上就一个字不动
      const geoAt = j.geoMake && got.GEO底稿 != null ? await saveGeo(j, got.GEO底稿) : '';
      const geoSay = geoAt ? '；AI 看图新建了一份 GEO 底稿，等你审' : '';
      let merged = [], zoned = [], titles = {};
      if (j.拆) {   // 新拆的镜头：分区、合并两份要对得上
        merged = Styles.shotsIn(got.合并 == null ? null : got.合并); zoned = Styles.shotsIn(got.分区 == null ? null : got.分区);
        const bad = Styles.pairOk(merged, zoned);
        if (bad) throw fail('AI 没按要的格式回：' + bad);
        titles = Styles.titlesIn(got.标题);
      }
      const empty = new Set(Array.isArray(j.空) ? j.空 : []);
      const rel = ['提示词', segDir(j.段), j.名];
      /* 对得上、一字没改的，回的【秒数】也记（11-23 他要）：不记的话，人改过镜头再交给 AI 写完，出片弹窗还是旧秒数、说「估完以后改过」。
         没回秒数不动旧的；等 AI 的时候镜头又改过的不记（秒数是照交出去那一版估的） */
      const keepSecs = async () => {
        if (!Secs || !Secs.parse(text)) return '';
        if (humanKey(PromptDraft.parse(unbom(await fsp.readFile(vpPath(j), 'utf8')))) !== j.底) return '；等 AI 的时候镜头又改过，秒数没记';
        return secsSay(await putSecs(j.项目, rel, String(text || '')));
      };
      if (same && !j.拆 && !empty.size) return { 结果: '对得上，没改' + (why ? '：' + why : '') + geoSay + await keepSecs(), 产出: geoAt ? [geoAt] : [] };
      const take = k => same && !empty.has(k) ? null : k === 'event' ? clean(blk('生成目标')).join('') : clean(blk({ refs: '素材', basic: '基础设定', seg: '主体与关系', keep: '保持一致' }[k]));   // null：照原样留着
      const gave = { event: take('event'), refs: take('refs'), basic: take('basic'), seg: take('seg'), keep: take('keep') };
      if (gave.basic) gave.basic = gave.basic.filter(l => !PromptDraft.isLook(l));
      for (const k of Object.keys(gave)) if (gave[k] != null && !gave[k].length) gave[k] = null;   // 回「无」、没回的：照原样留着
      const soundL = [...clean(blk('声音')), ...clean(blk('基础设定'))].filter(l => /^声音包括/.test(l)).slice(0, 1);
      const reg = got.素材登记 == null ? '' : got.素材登记, aiRefs = await refsIn(j, reg, j.assets || []);
      const txt = vpPath(j), sidep = txt.replace(/\.txt$/, '_写稿.json');
      let changed = [], style = '', nShots = 0;
      const n = await withFileLocks([txt, sidep], async () => {   // 和写稿页存盘共用文件锁：拿到锁以后照盘上最新的那一份改
        await noFilmed(j);   // 等 AI 的时候出了片：不写进去
        const doc = PromptDraft.parse(unbom(await fsp.readFile(txt, 'utf8'))), side = await sideOf(j);
        if (humanKey(doc) !== j.底) throw fail('等 AI 的时候事件脚本又改过了，这回没写进去（AI 写的在这个任务的回复里）');
        const human = humanLines(doc), p0 = partsOf(doc);
        const lost = gave.refs ? anchorOf(doc).filter(l => !gave.refs.some(x => anchorKey(x) === anchorKey(l))) : [];
        if (lost.length) throw fail('AI 把素材里白模、关键帧那几句改了（「' + lost[0].slice(0, 40) + '」），没存。再点一次「交给 AI 写完」');
        if (gave.event != null) doc.event = gave.event;
        if (gave.refs) doc.refs = gave.refs;
        const lookNow = doc.basic.filter(l => PromptDraft.isLook(l));
        doc.basic = [...(gave.basic || doc.basic.filter(l => !PromptDraft.isLook(l))), ...(lookNow.length ? lookNow : soundL)];
        if (isTwo(doc.refs)) doc.seg = []; else if (gave.seg) doc.seg = gave.seg;
        if (gave.keep) doc.keep = gave.keep.join('');
        let chosen = [], alt = [];
        if (j.拆) {   // 换上新拆的镜头：人写的那一大段从正文里拿掉（写稿资料里留着「自由稿」）
          style = Styles.styleFor(side);
          chosen = style === '分区' ? zoned : merged; alt = style === '分区' ? merged : zoned;
          doc.shotsPre = [];
          doc.shots = chosen.map(x => ({ no: x.no, title: '', lines: [...x.lines] }));
          nShots = chosen.length;
        }
        const out = PromptDraft.serialize(doc), now = PromptDraft.parse(out), p1 = partsOf(now);
        if (!j.拆 && humanKey(now) !== j.底) throw fail('写进去会动到你写的事件脚本，没存。打开看一眼格式，再点「交给 AI 写完」');
        const lack = NEED.filter(([k]) => !p1[k]).map(([, name]) => name);
        if (lack.length) throw fail('AI 没写全（缺' + lack.join('、') + '），没存。再点一次「交给 AI 写完」');
        changed = PARTS.filter(([k]) => p0[k] !== p1[k]).map(([, name]) => name);
        if (!changed.length && !j.拆) return -1;   // 和现在一字不差：不写，也不多留一版历史记录
        await keepCopy(j.项目, rel);   // 原来那一版先留一份进历史记录
        if (Object.keys(side).length) await keepCopy(j.项目, [...rel.slice(0, -1), path.basename(sidep)]);
        await writeFile(txt, out);
        if (j.拆) {   // 写稿资料：换成分镜模式；人写的那一大段留在「自由稿」；另一种写法记进镜头信息（备选）
          const free = typeof side.自由稿 === 'string' && side.自由稿.trim() ? side.自由稿 : human.join('\n');
          await writeFile(sidep, JSON.stringify({ ...side, 写法: '分镜', 写法范围: '分镜', 分镜稿: out, 自由稿: free, 镜头信息: Styles.metaOf(chosen, alt, titles), 镜头写法: style }, null, 2) + '\n');
        } else if (typeof side.分镜稿 === 'string') await writeFile(sidep, JSON.stringify({ ...side, 分镜稿: out }, null, 2) + '\n');   // 分镜模式存的就是正文
        /* 素材登记：AI 登的（人在写稿页挂过的编号以挂图为准），加上原来登记过、正文里还在用的 */
        const hang = Object.fromEntries(Object.entries(side.挂图 && typeof side.挂图 === 'object' ? side.挂图 : {}).map(([k, v]) => [k, String(v).replace(/\\/g, '/')]));
        let map = {};
        try { map = JSON.parse(unbom(await fsp.readFile(pj(j.项目, '资产', '参考素材映射.json'), 'utf8'))); } catch (e) { /* 还没有 */ }
        const used = new Set(out.match(/@(?:图片|视频|音频)\d+/g) || []), olds = ((((map && map.prompts) || {})[rel.join('/')] || {}).references || []).filter(r => r && used.has(str(r.ref)));
        const list = [];
        for (const r of aiRefs) if ((!hang[r.ref] || hang[r.ref] === r.path) && used.has(r.ref) && !list.some(x => x.ref === r.ref)) list.push(r);
        for (const r of olds) if (!hang[r.ref] && !list.some(x => x.ref === r.ref)) list.push(r);
        await resha(j.项目, rel, list);
        return list.length;
      });
      if (n < 0) return { 结果: '对得上，没改：AI 回的和现在一样' + geoSay + await keepSecs(), 产出: geoAt ? [geoAt] : [] };
      const secs = await putSecs(j.项目, rel, String(text || ''));
      const say = j.拆 ? '写好了：拆成 ' + nShots + ' 镜（提示词里放的是' + style + '，' + (style === '分区' ? '合并' : '分区') + '的另存一份备选）' + (changed.length ? '，写了' + changed.join('、') : '') + '，你写的那一段留在自由模式里'
        : '写好了：' + (changed.length ? '写了' + changed.join('、') : '') + (same ? '（' + (why || '别的对得上') + '）' : '') + '，你写的镜头没动';
      return { 结果: say + (n ? '，登记了 ' + n + ' 个素材' : '') + '，原来那一版进了历史记录' + geoSay + secsSay(secs), 产出: [rel.join('/'), ...(geoAt ? [geoAt] : [])] };
    },
  };
  return { KINDS: { 写完提示词 } };
};
