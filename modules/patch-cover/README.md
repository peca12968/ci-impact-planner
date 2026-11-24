# Patch Cover｜找出這次 Git 修改漏測的 Python 程式行

購物車新增「滿 100 免運」。既有的小額訂單測試通過了，卻沒有讓免運的 `return 0` 執行過。Patch Cover 取出待審提交，在暫存 Git worktree 中執行該版測試，列出本次修改涉及的可執行行及漏測行號。

## 重現免運門檻

使用 Git 與 Python 3.12，在專案根目錄執行。示範會在暫存目錄建立真正的 Git 分支與兩個待審提交。

```sh
python -m pip install -r requirements.txt
python demo.py
python -m unittest -v
```

| 待審版本 | 通過的測試數 | 已執行／改動程式行 | 門檻 100% 的結果 |
| --- | ---: | ---: | --- |
| 新增免運，測試只買 50 元 | 1 | 2／3 | 未達標，列出 `shop/shipping.py` 第 7 行 |
| 加入剛好買滿 100 元的測試 | 2 | 3／3 | 通過 |

兩次都以同一個共同祖先為比較基準。補測後執行到原本漏掉的免運回傳行，商業邏輯沿用第一次提交的版本。[可執行示範](demo.py)

## 用在自己的分支

```sh
python /path/to/patch_cover.py main --repo . --head HEAD --source shop --tests tests --minimum 90
```

執行環境需已安裝待測專案的 Python 相依套件。將 `--source` 與 `--tests` 換為相對於專案根目錄的原始碼與 unittest 測試目錄。Git 本機需有兩個參照及可推導共同祖先的歷史。CI 的淺層 checkout 可用完整歷史取得比較基準。

報告列出共同祖先與受測提交的 SHA、測試數、分母、命中數及每個檔案的行號。stdout 是 JSON，測試輸出送往 stderr。結束碼 0 表示達標，1 表示測試通過但差異覆蓋率未達門檻，2 表示比較或測量失敗，例如測試未通過、沒有發現測試或找不到參照。沒有新增或修改可執行行時，通過並回傳 `percent: null`。門檻以精確分數比較，2／3 可以通過 66.66%，在 66.67% 則會失敗。

## 行號如何對應

工具從兩個提交的 merge base 取差異，讀取 Git 的檔名與 blob 識別碼；重新命名檔案使用 Git 的 50% 相似度判定。新增模組即使完全未被測試匯入，可執行行仍會列入。純重新命名與刪除不會產生新的可執行行。[Git 比較實作](patch_cover.py)

量測使用 coverage.py 的預設排除規則，收集 unittest 所在 Python 程序的行覆蓋率。若改動落在多行呼叫的參數，工具沿 Python 語法 token 找回所屬敘述，再核對 coverage.py 記錄的可執行行；僅修改註解時可略過。這項門檻量測程式是否執行到，測試中的斷言負責檢查行為是否正確。[行號對應實作](measure.py) · [Coverage.py 分析 API](https://coverage.readthedocs.io/en/latest/api_coverage.html#coverage.Coverage.analysis2)

整合測試涵蓋主分支另外有提交、工作目錄有草稿、檔名含空格、改名後修改、未匯入模組、跨行運算式，以及失敗後清理暫存 worktree。[整合測試](test_patch.py)

本專案使用 AI 輔助開發，購物車範例只使用合成資料。
