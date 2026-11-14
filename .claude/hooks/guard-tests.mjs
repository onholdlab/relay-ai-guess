// PreToolUse hook：測試只能「新增」，不能改寫或刪除；harness 本身（hooks、CI）AI 不能改。
// 來源：onholdlab/rules 的 templates/harness（2026-11-14）。各 repo 的差異只放在 config.json。
//
// 允許：新建測試檔、在既有測試檔「純插入」內容（原本每一行都還在、順序不變）。
// 擋下：改寫或刪掉既有測試內容、改 harness 檔案。
// 真的要改：由使用者在啟動 Claude Code 前設定環境變數 OHL_ALLOW_TEST_EDIT=1，
// 或自己改；CI 的 test-guard 仍會要求 PR 加上 harness-reviewed 標籤。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const cfg = JSON.parse(readFileSync(resolve(root, '.claude/hooks/config.json'), 'utf8'));

if (process.env.OHL_ALLOW_TEST_EDIT === '1') process.exit(0);

const tool = input.tool_name || '';
const ti = input.tool_input || {};
const target = ti.file_path || ti.notebook_path;
if (!target || !['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) process.exit(0);

const abs = resolve(root, String(target).replace(/\\/g, '/'));
const rel = relative(root, abs).split(sep).join('/');
const caseKey = p => process.platform === 'win32' ? p.toLowerCase() : p;
const under = (p, dir) => {
  const prefix = caseKey(dir.replace(/\/$/, ''));
  const path = caseKey(p);
  return path === prefix || path.startsWith(prefix + '/');
};

function deny(reason) {
  writeFileSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
  }));
}

if ((cfg.harnessPaths || []).some(p => under(rel, p))) {
  deny(`「${rel}」是 harness（自動檢查本身），AI 不能修改。若真的需要改，停下來告訴使用者原因，由使用者決定。`);
} else if ((cfg.testDirs || []).some(d => under(rel, d)) && existsSync(abs)) {
  const original = normalize(readFileSync(abs, 'utf8'));
  const changed = proposedText(original);
  if (changed === null || !isPureInsertion(original, changed)) {
    deny(`測試是規格，只能新增、不能改寫或刪除（${rel}）。` +
      '測試沒過時要修的是程式碼。若你認為測試本身寫錯了，停下來告訴使用者：哪一條、為什麼錯、規格該怎麼改，由使用者決定。');
  }
}

function normalize(text) {
  return text.replace(/\r\n/g, '\n');
}

function isPureInsertion(oldText, newText) {
  // 舊內容的每一行都依原順序出現在新內容裡 → 只有新增，沒有改寫或刪除
  // 檔尾沒有換行時補一個，否則在這種檔案尾端新增內容會被誤判成改寫最後一行
  const lines = text => (text && !text.endsWith('\n') ? text + '\n' : text).match(/[^\n]*\n/g) || [];
  const original = lines(oldText);
  let i = 0;
  for (const line of lines(newText)) {
    if (line === original[i]) i++;
  }
  return i === original.length;
}

function proposedText(original) {
  if (tool === 'Write') return typeof ti.content === 'string' ? normalize(ti.content) : null;
  const edits = tool === 'Edit' ? [ti] : ti.edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  let text = original;
  for (const { old_string, new_string, replace_all } of edits) {
    if (!old_string || typeof old_string !== 'string' || typeof new_string !== 'string') return null;
    const before = normalize(old_string);
    const after = normalize(new_string);
    if (!text.includes(before)) return null;
    text = replace_all ? text.replaceAll(before, () => after) : text.replace(before, () => after);
  }
  return text;
}
