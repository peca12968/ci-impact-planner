# 工程發布與測試工具

從變更影響、契約與測試分組，一路核對套件、翻譯、介面、功能分流與上線曝光。[工具入口與各模組的重跑方式](modules/README.md)。

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

## 按相依順序分配測試檔

加上 `--suites` 可把受影響專案展開成測試檔。每個 `suiteStages` 元素保留同一階段的專案名稱，並附上一份可以直接交給 Suite Balance 的 `manifest`。實際執行時，同階段內的工作者可以平行跑，全部通過後再啟動下一階段。清單需在每個專案的 `tests` 列出該目錄下的測試檔、使用的環境及預估毫秒數，並在最外層的 `setup_ms` 設定各環境的啟動成本。CI 應隨測試檔增刪更新清單。

```sh
node cli.js --suites examples/projects.json packages/contracts/schema.json
node cli.js --suites examples/projects.json --git origin/main HEAD
```

共用契約改動會選取 4 個專案的 6 個檔案，略過獨立的 docs。將範例交給兩個工作者，契約、API 與網頁、結帳端對端測試三個階段的預估工時依序為 5、44、39 毫秒。逐檔輪流分配的總預估工時為 119 毫秒，計入共用環境啟動成本後選出的分配為 88 毫秒。這些數字來自範例設定。可用下列指令重現，最後一行會呼叫兩套 CLI 並核對所有選中檔案的分配。

```sh
git worktree add --detach ../suite-balance-verified 995bdcef3dbfdba4d2db23e2b65d5e7e514fcd0d
python examples/balance_stages.py ../suite-balance-verified/suite_balance.py
```

## 先建置測試所需的上游

在清單路徑前加 `--build-plan`，可取得測試所需的建置順序。它也能搭配 `--suites`、`--why` 或任一 Git 輸入方式。下例即使只改網頁，結帳測試仍需 API 已完成建置。

```sh
node cli.js --build-plan --suites examples/projects.json apps/web/button.ts
node cli.js --build-plan examples/projects.json --push BEFORE AFTER
```

| 階段 | 建置或還原產物 | 執行測試 |
| --- | --- | --- |
| 第 1 階段 | contracts | web |
| 第 2 階段 | api、web | checkout-e2e |
| 第 3 階段 | checkout-e2e | — |

兩欄各自按順序執行。先完成左側全部建置階段，再依右側階段執行測試。`buildPlan.stages` 含所有要測的專案及其遞迴上游。`buildPlan.buildOnly` 列出只需建置的專案及直接使用其產物的 `requiredBy`，讓維護者追查前置依賴。本例 `api` 被 `checkout-e2e` 使用，`contracts` 同時被 `api` 和 `web` 使用。`stages`、`selected` 與 `suiteStages` 沿用原先的測試選擇。建置、快取還原與測試命令各由 CI 提供。

無變更時，兩套階段皆為空。遇到全量測試時，每個專案都包含在建置與測試內。以 64 張四專案相依圖和每張圖的 16 種變更組合，核對測試集合、前置建置與階段順序。Git 整合測試另驗證採用推送後的清單，即使工作目錄中的清單已經改動。[範例輸出](examples/build-plan-demo.json) · [依賴閉包驗證](test/build-plan.test.js)

## 為什麼會跑這個測試？

在清單路徑前加上 `--why 專案名稱`，可追查某項測試與本次變更的關係。下例同時修改共用契約、API 稅額計算與操作手冊。五個專案都會被選中，其中有兩個變更來源會觸發結帳測試。

```sh
node cli.js --why checkout-e2e examples/projects.json packages/contracts/schema.json apps/api/tax.js apps/docs/guide.md
```

| 變更檔案 | 通往 checkout-e2e 的相依路徑 |
| --- | --- |
| `apps/api/tax.js` | api → checkout-e2e |
| `packages/contracts/schema.json` | contracts → api → checkout-e2e |

手冊變更只影響 docs。共用契約另有一條經 web 的等長路徑，工具會選出名稱順序較前的 api。每個有關的變更專案各列一條最短路徑，並列出屬於該專案的所有變更檔案。變更直接落在待查專案時，路徑只含該專案。

`why.selected` 表示該測試是否列入計畫。`why.causes` 保存檔案與相依路徑，`why.fullReasons` 則列出觸發全量測試的規則。舉例來說，只改根目錄鎖檔時，docs 仍會被選中，路徑清單為空，原因是 `unowned_paths`，檔名可在報告的 `unowned` 欄位找到。只改 web 時，查詢 docs 會得到 `selected: false`。

同一個查詢也能搭配 `--stdin0` 或 `--git BASE HEAD`。一般呼叫保留原有 JSON 格式，指定未知專案會以結束碼 2 回報。

## 從 Git 提供輸入

### 規劃 PR 的測試範圍

在本機 Git 儲存庫內執行下列命令。第一個版本是目標分支，第二個是待合併分支，兩者都可以是確切的 commit SHA：

```sh
node cli.js examples/projects.json --git origin/main HEAD
```

工具先找最佳共同祖先，再從共同祖先比較到待合併提交。若 PR 建立後 main 改了共用契約，而 PR 只把檔案從 docs 搬到 web，這份五專案範例會選到 docs、web、checkout-e2e，共 **3 個專案**。第一階段可平行測 docs 與 web，第二階段測 checkout-e2e。[實際建立分岔歷史的測試](test/git-input.test.js)

JSON 的 `comparison` 記錄兩個輸入版本、共同祖先 SHA 與清單路徑。工具從待合併提交讀取清單，在有未提交修改的工作目錄也能重現同一份計畫。清單本身有變更會選取新版清單內的所有專案，並提供 `fullReason: manifest_changed`。交錯合併若有多個最佳共同祖先，則選取所有專案並記錄 `multiple_merge_bases`。

在 GitHub Actions 的 pull_request 事件中，可將 `github.event.pull_request.base.sha` 和 `github.event.pull_request.head.sha` 經環境變數傳給 CLI。checkout 使用 `fetch-depth: 0` 可取得提交歷史。找不到版本、缺少清單或沒有共同祖先時，命令會輸出診斷到 stderr 並以 2 結束，stdout 保持空白。

### 比較兩個指定快照或傳入檔案清單

`--push BEFORE AFTER` 適用於分支更新後的 CI，直接比較推送事件提供的兩個完整 commit SHA。即使強制推送改寫歷史，舊提交獨有的檔案被移除時，也會納入對應的專案與下游測試。清單固定讀自 `AFTER`，報告的 `comparison` 記錄實際使用的兩個 SHA。

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0
- name: Plan tests after a push
  if: github.event_name == 'push' && !github.event.deleted
  shell: bash
  env:
    BEFORE: ${{ github.event.before }}
    AFTER: ${{ github.event.after }}
  run: node cli.js --suites examples/projects.json --push "$BEFORE" "$AFTER"
```

首次建立分支時，事件的 `BEFORE` 為全零，工具會以 `new_ref` 選取全部專案。改寫歷史後，若本機已找不到 `BEFORE`，工具也會以 `before_unavailable` 選取全部專案。若不存在 `AFTER` 提交、推送刪除分支或清單無法解析，結束碼為 2，stdout 保持空白。

[可重跑的 Git 測試](test/git-input.test.js)會建立兩條分岔歷史。新版本把文件從 docs 搬到 web，PR 模式選取 3 個專案。當新版本取代舊分支，舊分支獨有的契約檔案也隨之移除，推送模式將 contracts 與 api 納入，合計 5 個專案。[範例結果](examples/push-demo.json)

在具有 Git 歷史的 Bash 環境中執行下列命令。用實際基準與目標提交取代 BASE 和 HEAD。關閉 rename 偵測可同時保留舊路徑及新路徑，跨專案移動時會把兩側都納入。NUL 分隔可保留檔名內的空格與換行。

```bash
set -o pipefail
git diff --no-renames --name-only -z BASE HEAD | node cli.js examples/projects.json --stdin0
```

成功時 stdout 為 JSON。辨識到無歸屬路徑時，`mode` 是 `full`，並在 `unowned` 列出原因。空差異回傳空的 `stages`。輸入格式錯誤、相依循環或專案目錄重疊時，CLI 回傳結束碼 2，避免產生不完整計畫。

### 提交前先規劃測試

```sh
node cli.js --why checkout-e2e examples/projects.json --worktree
```

`--worktree` 使用目前工作目錄裡的專案清單，並從 Git 取得已暫存、未暫存、新增和衝突檔案。報告的 `comparison.changes` 分別列出 `staged`、`unstaged`、`untracked` 和 `conflicted`。同檔案可同時出現在暫存與未暫存欄位，計畫只計一次。搬移會把舊路徑及新路徑一起納入，Git 忽略的檔案則不參與規劃。指令只讀取 Git 狀態與清單，也可搭配 `--suites`。

若把文件從 docs 搬到 web，搬完又編輯它，再新增一個 API 路由，計畫第一階段會平行測 api、docs 和 web，第二階段測 checkout-e2e。編輯了專案清單時，工具會以 `manifest_changed` 選取全部專案。指定未被 Git 追蹤且被忽略的另一份清單時，會以 `manifest_untracked` 保守地選取全部。規劃使用當下的工作目錄，請在同一次讀取期間維持檔案內容穩定。[Git 整合測試](test/git-input.test.js) · [作品站共用的範例結果](examples/worktree-demo.json)

## 設計與範圍

- 以反向相依圖沿途展開受影響的專案，再以拓撲排序建立測試階段。同階段使用穩定的名稱順序，輸入檔案順序不影響結果。
- 清單是專案相依關係的來源。請在共用設定或產生器影響下游時同步更新清單。工具規劃測試範圍，實際測試命令及測試環境由使用此工具的 CI 提供。
- 僅支援 UTF-8 Git 相對路徑，專案目錄須互不重疊。適合已能獨立執行各套件測試的 monorepo。測試需要未變更的上游產物時，可用 `--build-plan` 安排建置或還原快取。

[測試](test/planner.test.js)涵蓋菱形相依、循環、無歸屬路徑、穩定排序、CLI 輸入及失敗處理。[GitHub Actions](.github/workflows/system.yml)在 Linux 與 Windows 的 Node.js 22、24 執行測試與 Git 串接示範。

**履歷用語**　以 Node.js 與 Git 實作 monorepo 測試規劃器，從 PR 檔案變更追蹤至下游測試，列出每個變更來源的最短相依路徑，並以 64 張四專案有向無環圖逐一核對路徑選擇。

本專案為 AI 輔助開發的作品集示範。範例數字代表測試計畫選中的專案數。

[同庫模組與整合測試](modules/README.md)
