'use strict';
/* ============================================================
   AI 铺底（直接铺底）：人写好的提示词，AI 只写它那几块。
   2026-11-19 他要回人写提示词（分镜模式、自由模式都要）：人写【生成目标】【事件脚本】，AI 照定稿的剧本和这一段的资产，
   把素材、基础设定、主体与关系、保持一致、事件脚本最后「声音包括……」那一行写进正文。人写的两块一个字不动，原来那一版先留一份进历史记录。
   铺过的先判断要不要改：对得上一个字不动（11-14 他定的规矩）。事件脚本一镜一行写的，顺手估每一镜几秒（11-15 他定），记进参考素材映射这一条的「秒数」。
   写稿页（通用工具/公用/写稿铺底.js）点「AI 铺底」开；和别的 AI 任务一样复制给你自己的 AI（11-15 起流水线不直接调 AI）。
   11-15 晚撤过一回（那时定提示词一律 AI 写），照撤之前那一版搬回来，任务书换成现在的写法（sd25-pe 只给地图和路径，11-18）。
   测试：通用工具/测试/分镜提示词_任务测试.js
   ============================================================ */
module.exports = function makeLay(d) {
  const { fsp, pj, str, fail, segDir, exists, unbom, oneLine, today, TAIL, PromptDraft, Secs, Voice, BmKey, isNarr,
    readFlow, sceneOf, scriptPath, finalOk, isPeText, vpNeed, vpPath, vpLabel, regOf, vidsOf, framesOf, frameImgs, framePart, bmPart,
    geoPart, saveGeo, lookPart, lessonsOf, pePart, PE_FORMAT, sceneImgs, txtsOf, TxtWord, voiceAssets, voiceRule, settingText, sceneText, docText, shotsOf,
    refsIn, withFileLocks, sideOf, keepCopy, writeFile, resha, putSecs, secsSay } = d;

  const PE_HEAD_SET = new Set(PromptDraft ? Object.values(PromptDraft.PE_HEADS) : []);   // sd2.5PE 的几个段名
  const humanOf = doc => ({ event: str(doc.event).trim(), shots: PromptDraft.shotText(doc).split(/\r\n|\n|\r/).map(l => l.trim()).filter(l => l && !PromptDraft.isLook(l)).join('\n') });   // 人写的两块
  const sameHuman = (a, b) => a.event === b.event && a.shots === b.shots;
  const laidOf = doc => !!str(doc.keep).trim() || doc.basic.some(l => !PromptDraft.isLook(l));   // 铺过了：基础设定、保持一致有字（和写稿页一个算法）
  const LAY_PARTS = [['refs', '素材'], ['basic', '基础设定'], ['seg', '主体与关系'], ['keep', '保持一致'], ['look', '「声音包括」那一行']];
  const layParts = doc => ({ refs: doc.refs.join('\n'), basic: doc.basic.filter(l => !PromptDraft.isLook(l)).join('\n'), seg: doc.seg.join('\n'), keep: str(doc.keep), look: doc.basic.filter(l => PromptDraft.isLook(l)).join('\n') });
  function aiPartsText(doc) {   // AI 写的几块现在什么样（重铺的时候给 AI 看）
    const basic = doc.basic.filter(l => !PromptDraft.isLook(l)), look = doc.basic.filter(l => PromptDraft.isLook(l));
    return [doc.refs.length ? '【素材】\n' + doc.refs.join('\n') : '', basic.length ? '【基础设定】\n' + basic.join('\n') : '', doc.seg.length ? '【主体与关系】\n' + doc.seg.join('\n') : '',
      doc.keep ? '【保持一致】\n' + doc.keep : '', look.length ? '【声音】\n' + look.join('\n') : ''].filter(Boolean).join('\n') || '（还空着）';
  }
  /* AI 回的一块：【块名】到下一个块名之前 */
  const blockOf = (t, name, next) => { const a = t.indexOf('【' + name + '】'); if (a < 0) return null; const rest = t.slice(a + name.length + 2); let z = rest.length; for (const n of next) { const i = rest.indexOf('【' + n + '】'); if (i >= 0 && i < z) z = i; } return rest.slice(0, z); };
  const linesOf = t => (t || '').split('\n').map(l => l.trim()).filter(l => l && !/^\x60\x60\x60/.test(l));
  const NAMES = ['判断', 'GEO底稿', '素材', '基础设定', '主体与关系', '保持一致', '声音', '素材登记', '秒数'];

  /* 能不能铺：剧本定稿了、新格式的稿、人写的两块不全空。点的时候 prep 就查，当场说清 */
  async function layCheck(j) {
    const flow = await readFlow(j.项目), s = sceneOf(flow, j.段), sp = scriptPath(j.项目, j.段);
    if (!s || !(await exists(sp)) || !finalOk(s, Math.floor((await fsp.stat(sp)).mtimeMs))) throw fail('剧本定稿以后才铺底：先到剧本页点「剧本定稿」');
    const raw = unbom(await fsp.readFile(vpPath(j), 'utf8'));
    if (raw.trim() && !isPeText(raw)) throw fail('这一条是旧格式的稿，AI 铺底只铺新格式的：在写稿页里写批注，交给 AI 改');
    const doc = PromptDraft.parse(raw), hm = humanOf(doc);
    if (!hm.event && !hm.shots) throw fail('这一条的生成目标、事件脚本都还空着：先写好再铺底');
    return { flow, s, sp, raw, doc, hm };
  }

  const 直接铺底 = {
    title: j => 'AI 铺底 · 第' + j.段 + '段 ' + vpLabel(j), need: ['段'], key: j => j.段 + '/' + j.名, file: j => j.段 + '/' + j.名,
    async prep(j) { await vpNeed(j); if (!PromptDraft) throw fail('读不了 公用/写稿状态.js'); await layCheck(j); },
    async book(j) {
      const { flow, s, sp, raw, doc, hm } = await layCheck(j);
      j.已铺 = laidOf(doc);   // 铺过的：先判断要不要改，对得上就一个字不动
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
      const bm = await bmPart(j, vids) + framePart(frames, '关键帧那几句已经在素材里的照原样留着（顺序句、首帧尾帧、第几个关键帧；编号和先后都不改）；还留着〔〕的，照图把这一刻看得见的构图、人物位置、姿态、镜头方向填上（图已经让你看过）。', raw, s, shots);
      const look = await lookPart(j.项目, flow, s, '写', '全片的光影总基调（【基础设定】的影像风格、光色基调照它写）'), lessons = await lessonsOf();
      const hasLook = doc.basic.some(l => PromptDraft.isLook(l)), askSecs = !!Secs && Secs.shotsOf(raw).length > 0;   // 事件脚本一镜一行写的才估秒数（自由模式写成一整段的不估）
      j.估秒 = askSecs;
      const rules = ['1. 人写的【生成目标】【事件脚本】一个字都不改，也不要抄进回复；镜头里的人物、道具、场景照他写的称谓对上素材。',
        '2. 素材照下面「提示词格式」第 1、2、3 条：这一条挂的素材五份以内用写法一（从【参考素材职责】起，挂了没用上的接【未采用素材】），多于五份用写法二（从【人物】起，按【人物】【道具】【场景】【动作与声音】分组，不写【主体与关系】）。只能挂下面「能用的资产」里的，镜头里看得见的人物、道具、场景都要挂；@图片 从 1 连着编。' + (txts.length ? TxtWord.PROMPT_RULE : ''),
        '3. 下面「已经挂好的」编号不能改，同一个文件就用这个编号。素材里已经有的白模、关键帧那几句一字照抄，留在原来的位置（还留着〔〕的照图、照人写的事件脚本填上）。',
        '4. 【基础设定】照第 10 条写三行：影像风格、摄影、光色基调。【主体与关系】照第 4 条写（写法二回「无」）。【保持一致】照第 6 条写一句。' + (hasLook ? '' : '【声音】写一行「声音包括……。」（事件脚本最后那一行），照镜头里写到的声音写。'),
        '5. ' + gp.rule, ...(vo.length ? ['6. ' + voiceRule(vo)] : [])];
      if (askSecs) rules.push((rules.length + 1) + '. ' + Secs.ASK);
      rules.push((rules.length + 1) + '. 回复照这个样子，段名照抄，不写的块回「无」：', ...(j.已铺 ? ['【判断】', '对得上（或：要改）', '一句话说为什么'] : []), ...(gp.make ? ['【GEO底稿】', '（照 scene-geo 第五节模板写的底稿）'] : []),
        '【素材】', '（素材那几段，带段名：写法一从【参考素材职责】起，写法二从【人物】起）', '【基础设定】', '影像风格：……', '摄影：……', '光色基调：……', '【主体与关系】', '（几个人、各是谁，开场谁在哪、朝着谁，道具，场景空间）', '【保持一致】', '保持……稳定。',
        ...(hasLook ? [] : ['【声音】', '声音包括……。']), '【素材登记】', '[{"ref": "@图片1", "name": "称谓", "path": "资产/……png"}]', ...(askSecs ? Secs.ASK_EG : []));
      return ['# 任务：给人写好的提示词铺底（只写 AI 写的那几块）', '', '今天 ' + today() + '。这是一个 AI 短视频项目。这一段的剧本已经定稿，人照剧本写了视频提示词里的【生成目标】和【事件脚本】'
        + (shots && shots.length ? '（这一条拍镜头表里的镜头 ' + shots.join('、') + '）' : '') + '。请照 sd25-pe，把这一条提示词里 AI 写的几块写出来：素材、基础设定、主体与关系、保持一致' + (hasLook ? '' : '，和事件脚本最后那一行「声音包括……」') + '。',
        ...(j.已铺 ? ['', '这一条以前铺过（见下面「AI 写的几块现在的样子」）。先判断它们和现在的剧本、资产、人写的两块还对不对得上：对得上就不用改，程序一个字都不动；对不上才改，没问题的那几块照原样留着。'] : []),
        '', '## 要求', ...(j.已铺 ? ['0. 回复最前面先写【判断】：第一行只写「对得上」或「要改」，第二行一句话说为什么（要改就说改哪几块）。对得上的，后面几块都不用写；要改的，要改的那几块整块写全，没问题的那几块回「无」，程序照原样留着。'] : []), ...rules,
        '', pm.text,
        '', '## 这一条提示词（文件：' + j.名 + '）', '【生成目标】', hm.event || '（空）', '【事件脚本】', hm.shots || '（空）',
        '', '## AI 写的几块现在的样子（没问题的照留）', aiPartsText(doc),
        '', '## 已经挂好的', regs.map(r => r.ref + '：' + r.path + (r.from === '挂图' ? '（人在写稿页挂的）' : '')).join('\n') || '（还没有）',
        '', '## 能用的资产', assets.map(x => x.line).join('\n') || '（没有）', ...(txts.length ? ['', TxtWord.promptPart(txts)] : []), bm,
        '', '## 全片的设定', settingText(flow), look, gp.text,
        '', '## 这一段：第' + j.段 + '段｜' + str(s.名).trim(), sceneText(flow, s),
        '', '## 定稿的剧本', scriptTx, lessons ? '\n## 公用教训（写的时候记着）\n' + lessons : '', '', PE_FORMAT, ...(gp.ref ? ['', gp.ref] : []), TAIL].join('\n');
    },
    async apply(j, text) {
      const t = text.replace(/\r\n/g, '\n');
      const blk = n => { const b = blockOf(t, n, NAMES.filter(x => x !== n)); return b == null ? [] : linesOf(b); };
      const none = ls => ls.length === 1 && /^[（(]?(无|没有|不写|不用)[）)]?[。.]?$/.test(ls[0]);
      const clean = ls => none(ls) ? [] : ls.filter(l => !PE_HEAD_SET.has(l.replace(/\s+/g, '')) && !/^镜头\s*[0-9０-９]+\s*[：:]/.test(l));   // 人写的两块的段名、镜头行混进来的不要
      const judge = blk('判断'), same = !!j.已铺 && /^对得上/.test(judge[0] || ''), why = oneLine(judge.slice(1).join(' ')).slice(0, 120);   // 铺过的先判断：对得上就一个字不动
      const geoAt = j.geoMake && t.indexOf('【GEO底稿】') >= 0 ? await saveGeo(j, blockOf(t, 'GEO底稿', NAMES.filter(x => x !== 'GEO底稿'))) : '';
      const geoSay = geoAt ? '；AI 看图新建了一份 GEO 底稿，等你审' : '';
      if (same) return { 结果: '对得上，没改' + (why ? '：' + why : '') + geoSay, 产出: geoAt ? [geoAt] : [] };
      const refsL = clean(blk('素材')), basicL = clean(blk('基础设定')).filter(l => !PromptDraft.isLook(l)), segL = clean(blk('主体与关系')), keepL = clean(blk('保持一致'));
      const soundL = [...clean(blk('声音')), ...clean(blk('基础设定'))].filter(l => /^声音包括/.test(l)).slice(0, 1);
      if (!j.已铺 && (!basicL.length || !keepL.length)) throw fail('AI 没按要的格式回（要【基础设定】【保持一致】这几块）');
      const keepOld = !!j.已铺, gaveRefs = !keepOld || refsL.length > 0, gaveBasic = !keepOld || basicL.length > 0, gaveSeg = !keepOld || segL.length > 0, gaveKeep = !keepOld || keepL.length > 0;   // 铺过的：AI 回「无」、没回的那几块照原样留着
      const isTwo = refs => refs.some(l => /^【(人物|道具|场景|动作与声音)】$/.test(l.replace(/\s+/g, '')));   // 写法二：不写【主体与关系】
      let two = false, changed = [];
      const reg = blockOf(t, '素材登记', ['秒数']);
      const aiRefs = await refsIn(j, reg || '', j.assets || []);
      const txt = vpPath(j), sidep = txt.replace(/\.txt$/, '_写稿.json'), rel = ['提示词', segDir(j.段), j.名];
      const n = await withFileLocks([txt, sidep], async () => {   // 和写稿页存盘共用文件锁：拿到锁以后照盘上最新的那一份改
        const doc = PromptDraft.parse(await fsp.readFile(txt, 'utf8')), before = humanOf(doc), side = await sideOf(j);
        const kept = doc.refs.filter(l => /@视频\d+|首帧|尾帧|关键帧/.test(l) && !/〔[^〕]*〕/.test(l));   // 白模、关键帧那几句：要一字不差地还在（留着〔〕的可以填）
        const lost = gaveRefs ? kept.filter(l => !refsL.includes(l)) : [];
        if (lost.length) throw fail('AI 把素材里白模、关键帧那几句改了（「' + lost[0].slice(0, 40) + '」），没存。再点一次「AI 铺底」');
        const put = (x, lk) => {
          if (gaveRefs) x.refs = refsL;
          x.basic = [...(gaveBasic ? basicL : x.basic.filter(l => !PromptDraft.isLook(l))), ...lk];
          if (isTwo(x.refs)) x.seg = []; else if (gaveSeg) x.seg = segL;
          if (gaveKeep) x.keep = keepL.join('');
        };
        const look = doc.basic.filter(l => PromptDraft.isLook(l)), p0 = layParts(doc);
        put(doc, look.length ? look : soundL);
        two = isTwo(doc.refs);
        const p1 = layParts(doc);
        changed = LAY_PARTS.filter(([k]) => p0[k] !== p1[k]).map(([, name]) => name);
        if (!changed.length) return -1;   // 和现在一字不差：不写，也不多留一版历史记录
        if (!p1.basic || !p1.keep) throw fail('AI 没按要的格式回（要【基础设定】【保持一致】这几块）');
        const out = PromptDraft.serialize(doc);
        if (!sameHuman(humanOf(PromptDraft.parse(out)), before)) throw fail('铺进去会动到你写的两块，没存。打开看一眼格式，再点「AI 铺底」');
        let sideOut = false;
        if (typeof side.分镜稿 === 'string') {   // 写稿页的过程文件：分镜模式存的就是正文；自由模式存结构化的那一份，页面照它和自由稿拼正文，AI 写的几块也要在里面
          if (side.写法 === '自由') {
            const ds = PromptDraft.parse(side.分镜稿 || PromptDraft.skeleton(doc.eol)), lookS = ds.basic.filter(l => PromptDraft.isLook(l)), free = str(side.自由稿);
            put(ds, lookS.length ? lookS : doc.basic.filter(l => PromptDraft.isLook(l) && !free.includes(l)));
            side.分镜稿 = PromptDraft.serialize(ds);
          } else side.分镜稿 = out;
          sideOut = true;
        }
        await keepCopy(j.项目, rel);   // 原来那一版先留一份进历史记录
        await writeFile(txt, out);
        if (sideOut) await writeFile(sidep, JSON.stringify(side, null, 2) + '\n');
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
      if (n < 0) return { 结果: '对得上，没改：AI 回的和现在一样' + geoSay, 产出: geoAt ? [geoAt] : [] };
      const secs = j.估秒 ? await putSecs(j.项目, rel, t) : null;   // 叫它估了才记（自由模式写成一整段的没叫）
      return { 结果: (keepOld ? '重新铺了：改了' + changed.join('、') + (why ? '（' + why + '）' : '') + '，原来那一版进了历史记录' : '铺好了：素材、基础设定、' + (two ? '' : '主体与关系、') + '保持一致写进了' + vpLabel(j))
        + '，你写的两块没动' + (n ? '，登记了 ' + n + ' 个素材' : '') + geoSay + secsSay(secs), 产出: [rel.join('/'), ...(geoAt ? [geoAt] : [])] };
    },
  };
  return { KINDS: { 直接铺底 } };
};
