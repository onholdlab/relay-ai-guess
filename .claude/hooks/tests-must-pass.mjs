// Stop hook：程式有變動時，測試沒全過就不准結束（verify loop）。
// 來源：onholdlab/rules 的 templates/harness（2026-11-14）。各 repo 的差異只放在 config.json。
//
// - 工作區和上次「測試全過」時完全一樣 → 不跑，直接放行（純聊天、純問答不會被拖慢）。
// - 測試失敗 → 擋下結束，把失敗輸出交給 Claude 當下一步指示。
// - 連續失敗 stopLossAfter 次（預設 3）→ 指示改為「停損：停止猜測，改做診斷」。
// - 測試環境沒裝好（例如沒跑 npm ci）→ 先叫 Claude 裝；裝了還是不行就放行並提醒使用者。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const cfg = JSON.parse(readFileSync(resolve(root, '.claude/hooks/config.json'), 'utf8'));
const stateDir = resolve(root, '.claude/state');
const stateFile = resolve(stateDir, 'tests.json');
const state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { passed: '', fails: 0 };
const save = () => { mkdirSync(stateDir, { recursive: true }); writeFileSync(stateFile, JSON.stringify(state, null, 2)); };

const out = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const block = reason => out({ decision: 'block', reason });
const tell = msg => out({ systemMessage: msg });

const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout || '';
// 工作區指紋：HEAD + 未提交的改動 + 未追蹤檔名（.claude/state 自己除外）
const hash = createHash('sha1')
  .update(git(['rev-parse', 'HEAD']))
  .update(git(['diff', 'HEAD', '--', '.', ':(exclude).claude/state']));
for (const f of git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean).sort()) {
  hash.update(f);
  try { hash.update(readFileSync(resolve(root, f))); } catch {}
}
const fingerprint = hash.digest('hex');
if (fingerprint === state.passed) { // 回到上次全過的狀態（例如改回去了）：連續失敗歸零
  if (state.fails) { state.fails = 0; save(); }
  process.exit(0);
}

const missing = (cfg.setupCheck || []).filter(p => !existsSync(resolve(root, p)));
if (missing.length) {
  if (input.stop_hook_active) tell(`測試環境還沒裝好（缺 ${missing.join('、')}），這次沒有跑測試。請在專案資料夾執行：${cfg.setupCommand}`);
  block(`測試環境還沒裝好（缺 ${missing.join('、')}）。先執行 \`${cfg.setupCommand}\`，再跑 \`${cfg.testCommand}\`。`);
}

const run = spawnSync(cfg.testCommand, { cwd: root, shell: true, encoding: 'utf8', timeout: (cfg.testTimeoutSec || 540) * 1000, maxBuffer: 64 * 1024 * 1024 });
const log = ((run.stdout || '') + '\n' + (run.stderr || '')).trim().split('\n').slice(-(cfg.tailLines || 60)).join('\n');

if (run.status === 0) {
  state.passed = fingerprint; state.fails = 0; save();
  tell(`自動測試全部通過（${cfg.testCommand}）。`);
}

state.fails = (state.fails || 0) + 1; save();
const timedOut = run.error && run.error.code === 'ETIMEDOUT' ? `（超過 ${cfg.testTimeoutSec || 540} 秒被中止）` : '';
const head = state.fails >= (cfg.stopLossAfter || 3)
  ? `測試已連續 ${state.fails} 次沒過${timedOut}。停損：不要再猜著改。改做診斷：` +
    '一次取得完整狀態（完整測試輸出、版本、設定檔）；和已知可用的版本比對（git diff 上一個測試全過的 commit）；' +
    '由底層往上逐層驗證；列出假設，每個假設配一個能分辨真假的測試；一次只改一處，改之前先寫出預期結果。' +
    '若判斷是測試或規格本身有問題，停下來向使用者說明，不要改測試。'
  : `程式碼有變動，但自動測試沒過${timedOut}（${cfg.testCommand}）。修程式碼直到全部通過再結束；不要修改或刪除既有測試。`;
block(`${head}\n\n測試輸出最後 ${cfg.tailLines || 60} 行：\n${log}`);
