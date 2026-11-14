// harness 檔案：AI 不能改。來源：onholdlab/rules 的 templates/harness-web（2026-11-14）。
// 只跑 *.spec.cjs（node --test 的 *.test.* 不歸 Playwright）；語系固定 zh-TW，結果在任何電腦上一致。
// 不沿用已在跑的伺服器：各 repo 共用 4174 埠，沿用的話可能測到別的作品而假通過；埠被占用時直接報錯。
module.exports = {
  testDir: 'tests',
  testMatch: '**/*.spec.cjs',
  timeout: 60000,
  workers: 1,
  use: { channel: 'chrome', baseURL: 'http://127.0.0.1:4174', locale: 'zh-TW', screenshot: 'only-on-failure' },
  webServer: { command: 'node tests/server.cjs', url: 'http://127.0.0.1:4174/', reuseExistingServer: false }
};
