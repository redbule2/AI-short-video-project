/* 写稿页写「自由稿」（2026-11-21 他定：先写提示词的段没有剧本，第一步在这里写一段自由模式的提示词，存成 提示词/第N段/自由稿.txt）。
   整页一大块自由写，别的都不摆（素材这些分区、右栏、请 AI 批、交给 AI 写完）；标题下面一个「提炼分镜」：先存好，再叫流水线那头
   （流水线/剧本.html 的 wfFreeExtract）记下时间、交给 AI 照它提炼分镜。写稿页过了 1500 行，这些放这里；写稿页里调的是 window.FreeDraft 的几样 */
(function () {
  'use strict';
  const is = () => typeof STEM === 'string' && STEM + '.txt' === Core.PF_FILE;
  const HINT = '把这一段的戏写成一大段：谁在哪、做什么、说什么，先后照你想的来。想好的机位、声音、台词原话也写上。\n\n写好点上面「提炼分镜」：AI 照它分镜头、列出场的人物场景道具；资产找好以后，再照分镜交给 AI 写完。';
  function init() {   // 打开的是自由稿：右栏收起，用不上的按钮、说明藏起来
    document.body.classList.add('free-draft', 'norail');
    if (document.getElementById('free-draft-css')) return;
    const css = document.createElement('style');
    css.id = 'free-draft-css';
    css.textContent = '.free-draft #askAll, .free-draft #previewBtn, .free-draft #refBtn, .free-draft #railBtn, .free-draft #sendNotes, .free-draft #rail, .free-draft .editor-side, .free-draft .free-footer, .free-draft .whole-note, .free-draft #tip { display: none !important; } .pf-nav { display: flex; justify-content: flex-end; padding: 4px 0 2px; }';
    document.head.append(css);
  }
  function nav() {   // 标题下面那一行：只有「提炼分镜」
    return h('nav', { class: 'pf-nav' }, h('button', { id: 'pfBtn', class: 'btn sm fin-b dian', type: 'button', title: '先存好，再交给 AI 照它分镜头、列出场的人物场景道具', onclick: extract }, '提炼分镜'));
  }
  async function extract() {
    if (!READY) return;
    if (CONFLICT) return toast('这份稿有修改冲突：先在上面处理好');
    if (!String(freeText()).trim()) return toast('自由稿还空着：先写好这一段的戏');
    clearTimeout(ST);
    if (!await save()) return toast('还没存上，先存好再提炼');
    const go = window.parent !== window && typeof window.parent.wfFreeExtract === 'function' ? window.parent.wfFreeExtract : null;
    if (!go) return toast('存好了。回流水线，在这一段的「自由稿」那一步点「提炼分镜」');
    go();
  }
  window.FreeDraft = Object.freeze({ is, init, nav, HINT });
})();
