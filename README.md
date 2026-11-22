# CI Impact Planner｜Monorepo 變更影響分析

在同一個儲存庫開發 API、前端與共用套件時，修改共用資料結構可能需要三個團隊一起重測。這個 Node.js CLI 讀取專案相依圖及 Git 的變更路徑，輸出需要重測的專案，並分組列出可以平行執行的測試。

## 一分鐘示範

使用 Node.js 22 或更新版本，零第三方依賴。

```sh
npm test
npm run demo
node cli.js examples/projects.json apps/web/button.ts
node cli.js examples/projects.json package-lock.json
```

範例包含五個專案。修改共用的 `contracts` 時，第一階段測 contracts，第二階段平行測 api 與 web，第三階段測 checkout-e2e。這次選中 4 個專案，獨立的 docs 可以略過。只改 web 時選中 2 個。變更根目錄鎖檔時，5 個全部重測。

## 從 Git 提供輸入

在具有 Git 歷史的 Bash 環境中執行下列命令。用實際基準與目標提交取代 BASE 和 HEAD。關閉 rename 偵測可同時保留舊路徑及新路徑，跨專案移動時會把兩側都納入。NUL 分隔可保留檔名內的空格與換行。

```bash
set -o pipefail
git diff --no-renames --name-only -z BASE HEAD | node cli.js examples/projects.json --stdin0
```

成功時 stdout 為 JSON。辨識到無歸屬路徑時，`mode` 是 `full`，並在 `unowned` 列出原因。空差異回傳空的 `stages`。輸入格式錯誤、相依循環或專案目錄重疊時，CLI 回傳結束碼 2，避免產生不完整計畫。

## 設計與範圍

- 以反向相依圖沿途展開受影響的專案，再以拓撲排序建立測試階段。同階段使用穩定的名稱順序，輸入檔案順序不影響結果。
- 清單是專案相依關係的來源。請在共用設定或產生器影響下游時同步更新清單。工具規劃測試範圍，實際測試命令及測試環境由使用此工具的 CI 提供。
- 僅支援 UTF-8 Git 相對路徑，專案目錄須互不重疊。適合已能獨立執行各套件測試的 monorepo。若測試前必須先編譯未變更的上游，應另外安排建置或還原其快取。

[測試](test/planner.test.js)涵蓋菱形相依、循環、無歸屬路徑、穩定排序、CLI 輸入及失敗處理。[GitHub Actions](.github/workflows/ci.yml)在 Node.js 22 與 24 執行測試與 Git 串接示範。

**履歷用語**　以 Node.js 實作 monorepo 測試範圍規劃工具，透過反向相依圖與拓撲排序決定受影響專案及平行測試順序，並驗證跨套件變更與全量回退行為。

本專案為 AI 輔助開發的作品集示範。範例數字代表測試計畫選中的專案數。
