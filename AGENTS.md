# 開發規則（Claude Code 與 Codex 共用）

## 規格先行（SDD）

規格＝本檔的規則、README，加上測試（`tests`、`i18n/check.mjs`）。改行為一律照這個順序：

1. 先把要的行為寫成一句規格（寫進 PR 描述，長期規則寫進本檔）。
2. 再寫測試：新增測試檔（邏輯用 `tests/<主題>.test.mjs`，畫面與操作用 `tests/<主題>.spec.cjs`），或在既有測試檔裡「只新增」。先跑一次，確認新測試失敗。
3. 最後改程式，直到 `node --test && node i18n/check.mjs && npx playwright test` 全部通過。

## 測試只能新增

- 既有測試不能改寫或刪除。測試沒過要修的是程式碼，不是測試。
- 如果認為測試本身寫錯了，停下來說明是哪一條、為什麼錯、規格該怎麼改，由使用者決定。
- CI 的 test-guard 會擋：PR 改寫、刪除或搬移既有測試，或新增、修改 harness 檔案（`.claude/hooks/`、`.claude/settings.json`、`.github/workflows/`、`.github/scripts/`、`playwright.config.cjs`、`tests/server.cjs`），都要使用者在 PR 加上 `harness-reviewed` 標籤才會通過。
- 要檢查的頁面清單與 inapp-lock 規則在 `.claude/hooks/config.json` 的 `site`（harness 檔案）。新增頁面時請使用者加進去。

## 自動檢查（harness）

- 每個 PR 都會在 GitHub Actions 跑 `test`：harness 自我測試 → 靜態規則（`tests/site-rules.test.mjs`：本機檔案不 404、不用 100vh、og:image 絕對網址、inapp-lock）→ 既有測試 → Playwright 煙霧測試（每頁手機與桌面寬度都能開、沒有 JS 錯誤）。
- `test-guard` 要等它合併進 `main` 之後，才會檢查之後送往 `main` 的 PR。有紅叉就不要合併；要讓紅叉真的擋住合併，需在 GitHub 另設分支保護。
- 本機第一次跑：在專案資料夾執行 `npm i --no-save @playwright/test@1.56.1`，之後 `node --test && node i18n/check.mjs && npx playwright test`。需要電腦上有 Google Chrome。

## 長任務的 context

- 進度寫在 PR 描述的待辦清單：做了什麼、下一步、卡在哪。
- 換新對話時先讀 PR 描述，再跑一次測試看現況，不靠對話記憶接續。
