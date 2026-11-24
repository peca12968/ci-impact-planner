# Wheel Witness｜找出 Python 套件重建後的差異

同一版程式連續打包兩次，最後的 wheel 雜湊不同。發布人員可以用這個工具先核對兩份檔案自己的 RECORD 清單，再查差異落在哪個模組、清單或 ZIP 欄位。比對器使用 Python 3.12 標準函式庫。

## 用真實建置重現

```sh
python -m pip install -r requirements-test.txt
python demo.py demo-builds
python compare.py demo-builds/baseline/parcel_count-1.0-py2.py3-none-any.whl demo-builds/new-clock/parcel_count-1.0-py2.py3-none-any.whl
```

程式在新目錄中用同一個 Flit 版本建置四份 wheel。將上面命令的第二個目錄替換成下表中的名稱即可比較。

| 和 baseline 比對 | 改動 | 預期結果 |
| --- | --- | --- |
| repeat | 相同原始碼與 SOURCE_DATE_EPOCH | 整個 wheel 逐位元組一致，結束碼 0 |
| new-clock | 建置時間往後 600 秒 | 檔案內容相同，ZIP 時間戳變動，結束碼 1 |
| new-code | 每箱裝量由 12 改為 24 | parcel_count.py 與 RECORD 內容變動，結束碼 1 |

報告提供兩份 wheel 的 SHA-256、檔案增刪與內容差異、共有成員的排列順序變動，以及逐檔 ZIP 屬性的前後值。若只有 RECORD 重新排列，結果是 `record_only`。若所有成員檔案的位元組相同、整個封裝仍有差異，結果是 `archive_only`。封裝屬性可能影響安裝，例如外部屬性包含 Unix 執行權限。欄位報告涵蓋常見差異，原始壓縮串流與 ZIP 本機標頭也可能使整檔雜湊不同。[Flit 可重現建置說明](https://flit.pypa.io/en/stable/reproducible.html)

## 清單核對與測試

工具從 ZIP 內串流讀取成員，核對 RECORD 的 URL-safe Base64 雜湊及有填寫的大小，另對每個檔案計算 SHA-256 以比較內容。接受 SHA-256/384/512、相應長度的 SHA-3，以及 BLAKE2b/s。舊格式的 RECORD.jws 與 RECORD.p7s 依規格排除於清單核對之外，其檔案變動仍會列入報告。這項檢查衡量清單與內容的一致性，發行者身分需透過其他證據確認。[Wheel 格式規格](https://packaging.python.org/en/latest/specifications/binary-distribution-format/)

RECORD 遺漏檔案、大小或雜湊錯誤、清單不唯一，或 ZIP 讀取失敗時，程式以結束碼 2 回報並保持標準輸出為空。執行 `python -m unittest -v` 會實際建置四份套件，也會重排清單、改動 ZIP 權限與順序，並放入內容與清單不一致的測試檔。專案以 AI 輔助開發。
