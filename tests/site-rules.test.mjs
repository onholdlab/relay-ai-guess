// 網頁作品的靜態規則測試（node --test）。把 AGENTS.md 的 Review guidelines 變成程式檢查。
// 來源：onholdlab/rules 的 templates/harness-web（2026-11-14）。要檢查哪些頁面、要不要 inapp-lock，
// 設定在 .claude/hooks/config.json 的 site（那是 harness 檔案，AI 不能改）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const site = JSON.parse(readFileSync(join(root, '.claude/hooks/config.json'), 'utf8')).site || {};
const pages = site.pages || ['index.html'];

const read = p => readFileSync(join(root, p), 'utf8');
// 頁面裡引用的本機檔案（src / href），略過外部網址、錨點、data: 等
function localRefs(page, html) {
  const refs = [];
  for (const m of html.matchAll(/\s(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const raw = m[1].trim();
    if (!raw || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\$\{|\{\{)/i.test(raw)) continue;
    const clean = decodeURI(raw.split(/[?#]/)[0]);
    if (!clean) continue;
    let path = clean.startsWith('/') ? join(root, clean) : join(root, dirname(page), clean);
    if (clean.endsWith('/') || (existsSync(path) && statSync(path).isDirectory())) path = join(path, 'index.html');
    refs.push({ raw, path });
  }
  return refs;
}

// 同一個 { } 區塊裡，用 100vh 的屬性後面若緊接著同屬性的 dvh／svh／lvh 寫法，是給舊瀏覽器的退路，允許；
// 其他 100vh 都算違規。回傳違規的宣告。
function bare100vh(text) {
  const bad = [];
  for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
    const decls = block[1].split(';').map(d => d.trim()).filter(Boolean).map(d => {
      const i = d.indexOf(':');
      return { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1), raw: d };
    });
    decls.forEach((d, i) => {
      if (!/\b100vh\b/.test(d.value)) return;
      const next = decls.slice(i + 1).find(e => e.prop === d.prop);
      if (!next || !/\d+(?:d|s|l)vh\b/.test(next.value)) bad.push(d.raw.slice(0, 120));
    });
  }
  return bad;
}

for (const page of pages) {
  test(`${page}：頁面存在`, () => assert.ok(existsSync(join(root, page)), `${page} 不存在`));
  if (!existsSync(join(root, page))) continue;
  const html = read(page);

  test(`${page}：引用的本機檔案都存在（避免 404）`, () => {
    const missing = localRefs(page, html).filter(r => !existsSync(r.path)).map(r => r.raw);
    assert.deepEqual(missing, []);
  });

  test(`${page}：不用 100vh 排版（用 100% 或 100dvh）`, () => {
    const css = [html, ...localRefs(page, html).filter(r => r.path.endsWith('.css') && existsSync(r.path)).map(r => readFileSync(r.path, 'utf8'))];
    assert.deepEqual(css.flatMap(bare100vh), [], '找到沒有 dvh 接手的 100vh');
  });

  test(`${page}：og:image 是絕對網址`, () => {
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
    if (!m) return;
    const content = (m[0].match(/content=["']([^"']+)["']/i) || [])[1] || '';
    assert.match(content, /^https:\/\//, `og:image 是「${content}」`);
  });

  if (site.inappLock === 'full') {
    test(`${page}：保留 inapp-lock（CSS 與 JS）`, () => {
      assert.match(html, /<style[^>]*id=["']inapp-lock["']/i);
      assert.match(html, /id=["']inapp-lock-js["']/i);
    });
  } else if (site.inappLock === 'css') {
    test(`${page}：只用 CSS 的 inapp-lock，不加攔截觸控的 inapp-lock-js`, () => {
      assert.match(html, /<style[^>]*id=["']inapp-lock["']/i);
      assert.doesNotMatch(html, /id=["']inapp-lock-js["']/i);
    });
  }
}
