// CI 的 test-guard：不分 Claude、Codex 或人，PR 只要改寫／刪除既有測試，或改了 harness 本身，
// 就必須由使用者加上 harness-reviewed 標籤才會通過。新增測試檔、在測試檔裡只新增內容都直接通過。
// 來源：onholdlab/rules 的 templates/harness（2026-11-14）。設定讀 .claude/hooks/config.json。
// 這支腳本和它讀的設定都來自 main（workflow 用 pull_request_target，只 checkout main、不執行 PR 的程式），
// 所以 PR 裡改這支腳本或設定，改不到這次的檢查。
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const cfg = JSON.parse(readFileSync('.claude/hooks/config.json', 'utf8'));
const { BASE_SHA, HEAD_SHA } = process.env;
const labels = JSON.parse(process.env.PR_LABELS || '[]');
const LABEL = 'harness-reviewed';

const git = (...args) => execFileSync('git', ['--literal-pathspecs', ...args], { encoding: 'utf8' });
const under = (p, dir) => p === dir.replace(/\/$/, '') || p.startsWith(dir.replace(/\/$/, '') + '/');
const base = git('merge-base', BASE_SHA, HEAD_SHA).trim();
const diff = ['diff', '--no-renames', '--no-ext-diff', '--no-textconv'];

const problems = [];
// NUL delimiters preserve literal paths. Moves are reported as a deletion and an addition.
const changes = git(...diff, '--name-status', '-z', base, HEAD_SHA).split('\0');
for (let i = 0; i < changes.length - 1; i += 2) {
  const status = changes[i];
  const path = changes[i + 1];
  const isTest = (cfg.testDirs || []).some(d => under(path, d));
  const isHarness = (cfg.harnessPaths || []).some(d => under(path, d));
  if (!isTest && !isHarness) continue;
  const displayPath = JSON.stringify(path);
  if (isHarness) {
    problems.push(`改了 harness：${status} ${displayPath}`);
    continue;
  }
  if (status === 'A') continue;
  if (status !== 'M') {
    problems.push(`刪除、搬移或更換既有測試的檔案類型：${status} ${displayPath}`);
    continue;
  }
  // Force text comparison so a PR's .gitattributes cannot hide removed lines.
  const [, deleted] = git(...diff, '--text', '--diff-algorithm=minimal', '--numstat', '-z', base, HEAD_SHA, '--', path).split('\t', 2);
  if (deleted !== '0') problems.push(`改寫既有測試：${displayPath}`);
}

if (!problems.length) { console.log('test-guard：沒有改寫或刪除既有測試，也沒有改 harness。'); process.exit(0); }
console.log(problems.map(p => '- ' + p).join('\n'));
if (labels.includes(LABEL)) { console.log(`\n已有 ${LABEL} 標籤（使用者確認過），放行。`); process.exit(0); }
console.log(`\n測試是規格，harness 是檢查本身，都不能由 AI 自己改。` +
  `若這些改動是你（使用者）確認過的，在 PR 右側 Labels 加上「${LABEL}」，這個檢查會自動重跑。`);
process.exit(1);
