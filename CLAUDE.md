@AGENTS.md

## Claude Code 專用

`.claude/settings.json` 有兩個 hook，由程式執行，不靠你記得：

- **guard-tests**：用檔案編輯工具改既有測試（`tests`、`i18n/check.mjs`）時，只允許插入新行（套到整個檔案後比對）；改寫、刪除會被擋。harness 檔案不能改。用 shell 等其他方式的修改，由 GitHub 的 `test-guard` 檢查提交結果。
- **tests-must-pass**：你要結束時，只要程式有變動就自動跑 `node --test && node i18n/check.mjs && npx playwright test`（最多 14 分鐘）。沒過就不能結束，失敗輸出會變成你的下一步指示。還沒裝 Playwright 會先叫你跑 `npm i --no-save @playwright/test@1.56.1`。連續 3 次沒過，就改成停損診斷：不要再猜，照指示逐層查。

使用者真的要讓 Claude 改既有測試時，在啟動 Claude Code 前設定環境變數 `OHL_ALLOW_TEST_EDIT=1`（PowerShell：`$env:OHL_ALLOW_TEST_EDIT=1; claude`）。
