# Catalog Merge｜逐詞條合併 Git 翻譯檔

結帳頁和門市自取功能同時修改繁中翻譯檔。Git 把整行標成衝突，其中「電子發票」與「自取」分屬不同詞條，可以一起保留。Catalog Merge 從 Git 索引讀取共同祖先、目前分支與合入分支的版本，找出真正需要翻譯者決定的詞條。

## 重現結帳頁合併

安裝 Git 和 Python 3.12，在專案根目錄執行。示範會在暫存目錄建立兩條分支並實際執行 Git merge。

```sh
python demo.py
python -m unittest -v
```

| 詞條 | 兩條分支的修改 | 示範結果 |
| --- | --- | --- |
| `/checkout/invoice`、`/nav/pickup` | 各自新增「電子發票」和「自取」 | 自動保留兩項 |
| `/checkout/hint` | 一方刪除，另一方修改提示文字 | 覆核後採用刪除 |
| `/checkout/pay` | 一方改成「立即付款」，另一方改成「前往付款」 | 覆核後填入「確認並付款」 |

示範最後產生四個詞條，包含兩個新增項目與雙方沿用的「返回」。[可執行示範](demo.py)

## 用在自己的合併衝突

在含有未解決衝突的 Git 工作目錄執行下列指令，將工具路徑換為實際位置。翻譯檔的根層必須是 JSON 物件，內部可用物件分組，末端值使用字串。

```sh
python /path/to/catalog_merge.py locales/zh-TW.json --save-review review.json --output merged.json
```

若詞條可自動合併，指令會建立 `merged.json`。需要覆核時會建立 UTF-8 的 `review.json`，結束碼為 1。每項記錄都包含詞條路徑與三份來源值，`present: false` 表示該版本沒有這個詞條。將 `take` 填為 `ours`、`theirs` 或 `base`，也可以選 `custom` 並在同項加入字串欄位 `text`。尚待決定的項目可保留 null。

```sh
python /path/to/catalog_merge.py locales/zh-TW.json --review review.json --output merged.json
```

所有決定都有效後才寫出完整翻譯檔。使用者可先檢查輸出，再將它放回原路徑並執行 git add。若選擇刪除整檔，指令會回傳 `deleted`，由使用者確認後執行 git rm。工具只讀取索引，輸出路徑需為新檔名，發布使用同目錄暫存檔與硬連結，需使用支援硬連結的檔案系統。輸入或覆核檔無效時結束碼為 2。

## 合併規則與驗證

同一詞條只有一方改動時採用該改動。雙方改成相同值時直接採用。雙方在同一命名空間新增不同子鍵時逐鍵合併。刪除與修改相撞，或雙方把原字串改成不同結構時，交由人工決定。每項決定以 SHA-256 綁定詞條路徑、三個版本的值與存在狀態。重新執行時會回到 Git 索引核對，仍有衝突的部分覆核報告也保留已選項目。[實作](catalog_merge.py)

測試走過缺鍵、空字串與兩種翻譯文字的 64 種三方組合，在 32 份混合詞條的字典上比對預期結果。另以真實 Git 合併驗證雙方同時新增檔案、整檔刪除與修改衝突、覆核過期，以及保留既有輸出。[測試](test_merge.py)

本作品使用 AI 輔助開發，所有示範翻譯均為合成資料。
