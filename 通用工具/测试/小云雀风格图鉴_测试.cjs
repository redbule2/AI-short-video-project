'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir = path.join(__dirname, '..', '小云雀风格图鉴');
const html = fs.readFileSync(path.join(dir, '小云雀官方风格图鉴.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

test('153 个风格均有本地示例图和提示词', () => {
  const imgs = [...html.matchAll(/data-local-src="(media\/[^"]+)"/g)].map(x => x[1]);
  assert.equal((html.match(/<article class="card"/g) || []).length, 153);
  assert.equal((html.match(/class="prompt-text" readonly aria-label=/g) || []).length, 154);
  assert.equal(imgs.length, 153);
  assert.equal(new Set(imgs).size, 153);
  for (const img of imgs) assert.ok(fs.statSync(path.join(dir, img)).size > 0, img);
  assert.doesNotThrow(() => new vm.Script(script));
});

test('分类和搜索过滤卡片，点击示例图加载图片及对应提示词', async () => {
  const events = () => ({ handlers: {}, addEventListener(k, fn) { this.handlers[k] = fn; } });
  const img = { dataset: { localSrc: 'media/drama-001.jpg' }, src: '', alt: '' };
  const button = Object.assign(events(), { dataset: { src: 'media/drama-001.jpg', title: '测试风格', promptId: 'prompt-one' }, querySelector: () => img });
  const cards = [ { dataset: { category: '真人', search: '宫廷 风格' }, hidden: false }, { dataset: { category: '营销', search: '阳光 风格' }, hidden: false } ];
  const filters = ['全部', '真人', '营销'].map(name => Object.assign(events(), { dataset: { filter: name }, setAttribute() {} }));
  const search = Object.assign(events(), { value: '' });
  const modal = Object.assign(events(), { open: false, showModal() { this.open = true; }, close() { this.open = false; } });
  const big = { src: '' }, title = { textContent: '' }, prompt = { value: '' }, count = { textContent: '' }, back = { href: '../流水线/风格.html' };
  const elements = { '#search': search, '#preview': modal, '#large-image': big, '#large-title': title, '#large-prompt': prompt, '#result-count': count, '#close-preview': events() };
  const fetches = [];
  const document = { querySelector: key => elements[key], querySelectorAll: key => ({ '.card': cards, '[data-filter]': filters, '.image-button': [button], '[data-copy-from]': [], 'img[data-local-src]': [img] })[key], getElementById: key => key === 'back-to-style' ? back : { value: '可复制的风格提示词' } };
  const window = { IntersectionObserver: class { observe() {} }, addEventListener() {} };
  const mock = { document, window, location: { search: '?p=测' }, navigator: {}, Blob, encodeURIComponent, URL: { createObjectURL: b => { assert.equal(b.type, 'image/jpeg'); return 'blob:local'; }, revokeObjectURL() {} }, fetch: async (url, options) => { fetches.push({ url, options }); return { ok: true, blob: async () => new Blob(['image']) }; }, IntersectionObserver: class { observe() {} }, setTimeout };
  vm.runInNewContext(script, mock);
  assert.equal(back.href, '../流水线/风格.html?p=测');
  filters[1].handlers.click(); assert.equal(cards[0].hidden, false); assert.equal(cards[1].hidden, true);
  filters[0].handlers.click(); search.value = '阳光'; search.handlers.input(); assert.equal(cards[0].hidden, true); assert.equal(cards[1].hidden, false);
  await button.handlers.click();
  assert.equal(fetches.length, 1); assert.equal(fetches[0].options.headers['X-Antou'], '1');
  assert.match(fetches[0].url, /media\/drama-001\.jpg$/); assert.equal(img.src, 'blob:local'); assert.equal(big.src, 'blob:local');
  assert.equal(title.textContent, '测试风格'); assert.equal(prompt.value, '可复制的风格提示词'); assert.equal(modal.open, true);
});

test('风格页面保留公共入口和项目上下文', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', '流水线/风格.html'), 'utf8');
  assert.match(page, /小云雀风格图鉴\/小云雀官方风格图鉴\.html' \+ location\.search/);
});
