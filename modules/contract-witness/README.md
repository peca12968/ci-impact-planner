# Contract Witness｜用一筆訂單重現 API 改版的影響

訂單 API 把購買上限從 10 件調為 5 件。舊版用戶端仍能送出 6 件的訂單。Contract Witness 比較兩版 JSON Schema，產生一份舊版接受、新版拒絕的完整訂單，並標出欄位與原因。反過來也能檢查新版服務的回應是否符合舊版用戶端的契約。

## 重現訂單改版

使用 Python 3.12 或 3.13，在專案根目錄執行。CLI 只需 Python 標準函式庫。

```sh
python contract_witness.py examples/order-v1.json examples/order-v2.json
python contract_witness.py examples/order-v1.json examples/order-v2.json --direction response
```

| 方向 | 欄位 | 能重現差異的資料 |
| --- | --- | --- |
| 舊請求送到新服務 | `/quantity` | 舊版接受購買 6 件，新版上限為 5 件 |
| 舊請求送到新服務 | `/delivery/speed` | 舊版可指定 `standard`，新版只接受 `express` |
| 舊請求送到新服務 | `/delivery/giftMessage` | 舊版允許附上禮物留言，新版拒絕這個欄位 |
| 新回應交給舊用戶端 | `/delivery/tracking` | 新版可傳送 `false`，舊版嚴格契約會拒絕此欄位 |

例如購買數量的反例可直接存成回歸測試資料。

```json
{"delivery": {"speed": "express"}, "quantity": 6}
```

工具將 JSON 報告寫到標準輸出。結束碼 `0` 表示此方向相容，`1` 表示找到反例，`2` 表示輸入無效或使用了未支援的契約規則。上面兩條示範命令都會回傳 `1`。實際用於 CI 時，請分別傳入同一端點的兩版請求契約和兩版回應契約。

## 判定方式與範圍

請求模式檢查舊契約所接受的每一筆資料是否也符合新契約。回應模式交換兩者，以舊用戶端的契約檢查新服務可產生的資料。若數量上限收緊，就選取仍在來源範圍內且超過接收端上限的值；若必要欄位增加，就構造一份可以合法省略該欄位的來源物件。巢狀欄位的反例會連同外層必要資料一起輸出。一筆反例可能同時觸犯數項限制。

支援 Draft 2020-12 的一個明確子集，每個節點有單一型別。物件可巢狀，必須宣告 `additionalProperties: false`，支援 `properties` 與 `required`。純量支援字串及字串列舉、整數及整數字面值上下界、布林與 null。陣列支援單一 `items` 契約及非負整數字面值 `minItems`、`maxItems`，可以巢狀使用。每個支援的節點都須至少容許一個值。元組、唯一性限制、開放物件、跨欄位條件及引用等未支援規則會回報輸入錯誤。[物件規則](https://json-schema.org/understanding-json-schema/reference/object) · [陣列規則](https://json-schema.org/understanding-json-schema/reference/array)

## 批次訂單明細

舊 API 接受 1 到 3 筆明細，每筆最多 10 件。改版後固定收 2 筆，每筆最多 5 件。執行下列指令可得到三份舊版接受、新版拒絕的訂單。

```sh
python contract_witness.py examples/batch-v1.json examples/batch-v2.json
```

| 路徑 | 反例 |
| --- | --- |
| `/lines` | 只送 1 筆，低於新版下限 |
| `/lines` | 送 3 筆，高於新版上限 |
| `/lines/0/qty` | 送 2 筆，數量為 6 和 1。長度合法，第一筆超出新版數量上限 |

加上 `--direction response` 則相容。工具只在兩版都容許的正長度上產生元素反例。若來源只接受空陣列，改動元素型別仍可相容。長度界線可用任意大小的整數比較，輸出具體反例時預設整份報告最多展開 10,000 個陣列元素，含巢狀明細。需要更大的 JSON 可調整 `--max-array-items`，超過預算時結束碼為 2，stdout 保持空白。[批次舊版](examples/batch-v1.json) · [批次新版](examples/batch-v2.json)

## 驗證

```sh
python -m pip install -r requirements-test.txt
python -m unittest -v
```

測試從有界整數、字串列舉、布林與兩層可選欄位組出 16 份契約。對全部 256 種有方向的配對，以獨立套件 `jsonschema` 枚舉其有限資料域，核對相容判定，並逐筆確認工具提供的反例在來源合法、在接收端失敗。另測試無界整數、超大界線、JSON Pointer 跳脫、重複鍵及 CLI 結束碼。[測試程式](test_contract.py)

另以 27 份有限陣列契約組成 729 組有方向的配對，讓獨立驗證器列出每份契約接受的全部資料，逐組核對相容性與產生的反例。命令列測試也檢查完整批次訂單、反向相容及巢狀輸出預算。

**履歷用語**　以 Python 實作 API 請求與回應的契約相容性分析，為破壞性改版產生含明細路徑的 JSON 反例，並以獨立驗證器核對 256 組物件與 729 組陣列契約配對。

本專案使用 AI 輔助開發，訂單資料為合成範例。
