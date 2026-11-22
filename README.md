# Theme Contrast｜主題換色的文字對比回歸檢查

把配送與取貨提示共用的文字色改成半透明後，兩處說明文字的對比都會下降。同一版也可能修好另一則警示，或繼續保留待處理的舊問題。這個 Node.js CLI 以穩定的文字識別碼比對兩版主題，指出哪一項是新增失敗、哪一項已修復，並列出實際採用的色票及背景疊放順序。

## 重現一次主題改版

Node.js 22 以上即可執行 CLI。下列範例預期以結束碼 1 回報兩個新增失敗，完整報告輸出至 stdout。

```sh
node audit.mjs examples/before.json examples/after.json
```

| 文字 | 原對比 | 新對比 | 判定 |
| --- | ---: | ---: | --- |
| 配送提示 `delivery-hint` | 7.39 | 2.03 | 新增失敗 |
| 取貨提示 `pickup-hint` | 8.07 | 2.09 | 新增失敗 |
| 大字標題 `section-title` | 4.48 | 4.48 | 通過 |
| 逾時警示 `late-notice` | 3.25 | 10.22 | 已修復 |
| 歷史紀錄說明 `archive-note` | 2.85 | 2.85 | 既有失敗 |

舊版另有一個已移除的標籤，報告在 `removed` 列出它的識別碼。表格為方便閱讀取兩位小數。程式使用完整精度判定，例如白底搭配 `#707972` 得到約 4.499795，一般大小的文字仍低於門檻。

## 在 CI 使用

- `node audit.mjs CURRENT.json` 檢查所有列出的文字，只要一項低於門檻就回傳 1。
- `node audit.mjs BASE.json CURRENT.json` 僅在曾通過的文字改為失敗、或新增的文字未達門檻時回傳 1。兩版都低於門檻的項目標為 `existing_failure`，調整幅度可由兩個對比值比較。
- 檢查通過回傳 0。輸入檔案無法讀取、格式不符、識別碼重複或參照不存在的色票時回傳 2，錯誤訊息寫入 stderr。

清單內的 `backgrounds` 由底向上排列，第一層須完全不透明。支援 sRGB 十六進位色碼的三、四、六、八位形式。工具先合成背景，再將前景覆在其上，依相對亮度求對比值。使用者依實際字級和字重指定 `normal` 或 `large`。本工具檢查清單內的純色文字情境，漸層、圖片、混合模式及整個群組的 CSS opacity 需要另外檢視。[W3C 文字對比準則](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## 驗證

```sh
npm ci
npm test
npx playwright install --with-deps chromium firefox
npm run test:browsers
```

瀏覽器測試把同一份主題轉成實際 HTML 文字和巢狀背景，透過 axe-core 的 `color-contrast` 規則檢查每個元素，再逐項比對 CLI。Chromium 與 Firefox 各核對舊版 6 項、新版 5 項，涵蓋半透明前景、半透明背景和大字。任何元素被略過、無法判定或兩套工具結論不同，都會使測試失敗。[瀏覽器驗證](browser-check.mjs)

本專案為 AI 輔助開發的工程作品集示範，使用合成的配送介面主題。
