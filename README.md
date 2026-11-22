# Rollout Lab｜功能發布預演

發布新版結帳頁前，先試算擴大開放、調整 A/B 配比或回退版本會影響哪些人。工具使用 1,000 個固定合成帳號，列出新加入、退出、切換版本與維持原狀的人數；也能直接查詢某個帳號的前後版本。運算均在瀏覽器本機完成。

![從 10% 開放至 25% 的受眾變化](docs/preview.png)

## 三分鐘展示

使用 Python 3.10 以上，從儲存庫根目錄啟動：

```sh
python -m http.server 4177 --bind 127.0.0.1 --directory web
```

在現代瀏覽器開啟 [本機預演頁](http://127.0.0.1:4177)。示範本身使用標準瀏覽器 API，無須建置。

1. 預設將開放比例從 10% 擴至 25%，兩邊的 A/B 配比皆為 50/50。固定樣本中，開放帳號由 96 個增加到 249 個，新增 **153 個**，退出及版本切換皆為 0。門檻作用在一萬個雜湊桶上，有限樣本的實際人數會有抽樣差異。
2. 把目前與預計開放比例都調到 100%，再把新版設定的 A 版比例調為 0%。原本拿到 A 的帳號會切到 B，原本拿到 B 的人維持原狀。
3. 展開變動名單查看前 20 筆，或輸入編號 1 至 1000，核對單一帳號。將預計開放比例降到 0% 可展示回退後的退出人數。

## 可重現的分組協定

[共用 JavaScript 模組](web/rollout.js)提供三個函式。單一帳號的判定方式如下，權重與門檻都以整數基點指定，10,000 基點等於 100%。

```js
import { subjectBuckets, compilePolicy } from "./web/rollout.js";

const buckets = await subjectBuckets("checkout-layout", "demo-0001");
const assign = compilePolicy({
  rollout: 2500,
  variants: [{name: "A", weight: 5000}, {name: "B", weight: 5000}]
});
console.log(assign(buckets)); // A、B 或 null（未開放）
```

1. 將功能鍵與帳號識別字正規化為 Unicode NFC，保留大小寫。將 `[1, domain, flag, subject]` 以緊密 JSON 序列化為 UTF-8。
2. 使用 SHA-256 雜湊，取前四個位元組組成無號大端整數 `n`。桶號為 `floor(n × 10000 / 2³²)`。
3. `domain` 使用 `exposure` 決定是否開放，使用 `variant` 決定開放後取得的版本。開放條件為桶號小於門檻，版本依清單順序與累積權重分配。提高門檻時，原本已加入的帳號仍在開放區間。若變更版本順序或權重，則可能切換版本。

功能鍵、帳號與協定版本固定時，跨執行環境可重建相同的分組。更換功能鍵等同重新分組，適合另一個獨立實驗。

## 工程驗證

```sh
npm ci
npm test
python reference.py
npx playwright install chromium
npm run test:e2e
```

需要 Node.js 22 以上。JavaScript 與獨立的 [Python 參考實作](reference.py)各自核對 [8 組固定測試向量](vectors.json)，包含組合字元、引號、換行、中文與 emoji。單元測試驗證門檻邊界、擴量穩定性、反向回退及版本權重變動。Playwright 在桌面及手機寬度驗證鍵盤操作、名單、單一帳號查詢與輸入錯誤。[CI 工作流程](.github/workflows/ci.yml)

**履歷用語**　實作可跨 JavaScript 與 Python 重現的功能分組協定及發布預演介面，以固定受眾驗證漸進式開放、版本切換與回退行為。

本專案為 AI 輔助開發的作品集示範。
