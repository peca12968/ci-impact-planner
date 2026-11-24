# Exposure Audit｜A/B 實驗分流稽核

結帳頁實驗預計將每位使用者以 50% 機率分到新版。32 位使用者中，整體剛好各有 16 人看到兩個版本。按平台拆開後，App 有 15 人看到控制版、1 人看到新版，網頁卻剛好相反。這個命令列工具接受實驗計畫與曝光紀錄，輸出可供發版流程判讀的 JSON 報告。

## 重跑範例

使用 Python 3.12，在儲存庫根目錄執行以下命令。

```sh
python -m pip install -r requirements.txt
python examples/make_exposures.py exposures.jsonl
python audit.py examples/plan.json exposures.jsonl
```

範例有 34 列，其中一列是事件重送，另一列是同一人回訪。報告保留 33 筆相異事件，分流檢定使用 32 位使用者。預期結束碼為 1，`findings` 包含 `sample_ratio_mismatch`。

| 分組 | 控制版 | 新版 | 雙尾 p 值 | Holm 校正後 p 值 |
| --- | ---: | ---: | ---: | ---: |
| 整體 | 16 | 16 | 1 | 1 |
| App | 15 | 1 | 0.000519 | 0.001556 |
| 網頁 | 1 | 15 | 0.000519 | 0.001556 |

## 輸入與判讀

### 安裝成命令列工具

在 Python 3.12 虛擬環境裡，於儲存庫根目錄執行：

```sh
python -m pip install -c requirements.txt .
python examples/make_exposures.py - | exposure-audit examples/plan.json -
```

最後的 `-` 表示從標準輸入逐行讀取 UTF-8 JSON Lines，可直接銜接曝光資料匯出程序。檔案與管線輸出相同的 JSON，沿用結束碼 0、1、2。工具將事件識別碼及使用者分組保存在記憶體，以處理重送與回訪。原有的 `python audit.py` 入口仍可使用。

CI 使用固定建置時間產生兩份 wheel，逐檔驗證 RECORD 並比對整個封裝的 SHA-256。接著在全新的虛擬環境安裝其中一份，從儲存庫外呼叫 `exposure-audit`，驗證檔案、管線、UTF-8 BOM、中文與錯誤輸入。[安裝演練](verify_install.py) · [封裝比對器](https://github.com/peca12968/wheel-witness)

### 實驗計畫與資料格式

計畫以 `strata` 列出事先定義的分組，以 `treatment_probability` 指定所有組共同的新版機率，`alpha` 預設為 0.05。曝光檔案每行一個 JSON 物件，包含 `event_id`、`user`、`variant`（control 或 treatment）與 `stratum`。分流單位為使用者，假設每人獨立分派且分組在觀察期間固定。檢查適用於預先決定的單次分析，同一份報告可重跑。

- 相同事件識別碼和分流欄位只計一次。若同一識別碼有兩份矛盾紀錄，輸入無效。
- 同一人回訪只計一票。跨版本或跨分組的人從所有檢定排除，報告會分別計數，並標記 `inconsistent_assignment`。
- 對整體與每個宣告分組做雙尾精確二項檢定，再以 Holm 法校正整個檢定家族。空分組在報告中保留空值，也計入校正的家族大小。所有人都被排除或整個檔案為空時，報告標記 `no_eligible_users`。
- 結束碼 0 表示本次未發現上述問題，1 表示報告有發現，2 表示輸入或讀檔錯誤。分流異常可作為檢查指派邏輯或曝光遺漏的起點，轉換率與實驗效果需另行分析。

## 驗證

`python -m unittest -v` 執行命令列整合測試及數值核對。60 組固定種子的案例涵蓋 25%、50%、75% 分配機率，以精確分數枚舉二項分布機率，並逐一枚舉交集檢定核對多重比較結果。每次推送在 Ubuntu 和 Windows 執行。
