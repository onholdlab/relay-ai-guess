// harness 本身的測試（CI 的 test 會先跑它）。來源：onholdlab/rules 的 templates/harness。
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const config = new URL('../../.claude/hooks/config.json', import.meta.url);
const testDir = JSON.parse(readFileSync(config, 'utf8')).testDirs[0];
const ciGuard = fileURLToPath(new URL('./test-guard.mjs', import.meta.url));
const localGuard = fileURLToPath(new URL('../../.claude/hooks/guard-tests.mjs', import.meta.url));
const testPath = `${testDir}/範例.test.mjs`;
const original = 'first\nsecond\n';

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'ohl-harness-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const write = (path, content) => writeFileSync(join(cwd, path), content);
  mkdirSync(join(cwd, testDir));
  mkdirSync(join(cwd, '.claude', 'hooks'), { recursive: true });
  mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
  write('.claude/hooks/config.json', readFileSync(config));
  write(testPath, original);
  return { cwd, write };
}

for (const [name, change, status, labels = []] of [
  ['allows insertion in an existing test', ({ write }) => write(testPath, 'first\nnew\nsecond\n'), 0],
  ['allows a new test', ({ write }) => write(`${testDir}/new.test.mjs`, original), 0],
  ['rejects rewriting a Unicode test path', ({ write }) => write(testPath, 'first\nchanged\n'), 1],
  ['rejects moving a test out of the test folder', ({ cwd }) => renameSync(join(cwd, testPath), join(cwd, 'other.mjs')), 1],
  ['rejects a new harness file', ({ write }) => write('.github/workflows/new.yml', 'name: new\n'), 1],
  ['allows a reviewed harness change', ({ write }) => write('.github/workflows/new.yml', 'name: new\n'), 0, ['harness-reviewed']]
]) {
  test(`CI guard ${name}`, (t) => {
    const repo = fixture(t);
    const git = (...args) => execFileSync('git', args, { cwd: repo.cwd, encoding: 'utf8' }).trim();
    const commit = () => {
      git('add', '-A');
      git('-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
      return git('rev-parse', 'HEAD');
    };
    git('init', '-q');
    git('config', 'core.autocrlf', 'false');
    git('config', 'core.quotePath', 'true');
    const BASE_SHA = commit();
    change(repo);
    const HEAD_SHA = commit();
    const result = spawnSync(process.execPath, [ciGuard], {
      cwd: repo.cwd,
      env: { ...process.env, BASE_SHA, HEAD_SHA, PR_LABELS: JSON.stringify(labels) },
      encoding: 'utf8'
    });
    assert.equal(result.status, status, result.stdout + result.stderr);
  });
}

for (const [name, old_string, new_string, decision] of [
  ['rejects splitting an existing line', 'irs', 'irs\nnew', 'deny'],
  ['allows inserting a whole line', 'irst', 'irst\nnew', undefined]
]) {
  test(`local guard ${name}`, (t) => {
    const { cwd } = fixture(t);
    const result = spawnSync(process.execPath, [localGuard], {
      cwd,
      env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, OHL_ALLOW_TEST_EDIT: '0' },
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: testPath, old_string, new_string } }),
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const response = JSON.parse(result.stdout || '{}');
    assert.equal(response.hookSpecificOutput?.permissionDecision, decision);
  });
}

test('local guard allows appending to a test file without a trailing newline', (t) => {
  const { cwd, write } = fixture(t);
  write(testPath, 'first\nsecond');
  const run = content => JSON.parse(spawnSync(process.execPath, [localGuard], {
    cwd,
    env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, OHL_ALLOW_TEST_EDIT: '0' },
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: testPath, content } }),
    encoding: 'utf8'
  }).stdout || '{}').hookSpecificOutput?.permissionDecision;
  assert.equal(run('first\nsecond\nthird\n'), undefined);
  assert.equal(run('first\nsecondX\n'), 'deny');
});
