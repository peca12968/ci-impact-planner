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

支援 Draft 2020-12 的一個明確子集，每個節點有單一型別。物件可巢狀，必須宣告 `additionalProperties: false`，支援 `properties` 與 `required`。純量支援字串及字串列舉、整數及整數字面值上下界、布林與 null。每個支援的節點都須至少容許一個值。陣列、開放物件、跨欄位條件、引用與其他未實作的關鍵字都會回報輸入錯誤。適用範圍為 JSON 內容，HTTP 狀態碼、授權及業務副作用需另外測試。[JSON Schema 物件規則](https://json-schema.org/understanding-json-schema/reference/object) · [數字範圍](https://json-schema.org/understanding-json-schema/reference/numeric)

## 驗證

```sh
python -m pip install -r requirements-test.txt
python -m unittest -v
```

測試從有界整數、字串列舉、布林與兩層可選欄位組出 16 份契約。對全部 256 種有方向的配對，以獨立套件 `jsonschema` 枚舉其有限資料域，核對相容判定，並逐筆確認工具提供的反例在來源合法、在接收端失敗。另測試無界整數、超大界線、JSON Pointer 跳脫、重複鍵及 CLI 結束碼。[測試程式](test_contract.py)

**履歷用語**　以 Python 實作 API 請求與回應的契約相容性分析，為破壞性改版生成可重現的 JSON 資料，並以獨立驗證器核對 256 組有方向的契約配對。

本專案使用 AI 輔助開發，訂單資料為合成範例。
