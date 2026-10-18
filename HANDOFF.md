# Toki 開發交接（2026-10-18）

## 目前狀態

- 分支：`dev/toki-4c-one-off-lessons-v7`。
- HEAD：`c307620 wip(toki): checkpoint one-off lessons v7 development`；前一個 Commit 為 `b798997 fix(toki): improve lesson occurrence safety and weekend schedule`。
- 建立本文件前工作樹乾淨；HEAD 的 v7 checkpoint 含 29 個程式／測試檔變更。本文件是本次唯一新增檔案，尚未 Commit 或 Push。
- 階段：**Phase 4C-3D-2C-2B-1 資料基礎已實作**；下一階段為 2C-2B-2 的單日課程資料操作與排程整合。`docs/roadmap.md` 尚未記載此 v7 階段，接續時應以本交接與已確認的產品決策核對範圍。

## 已完成且驗證通過

- `AppDataV7` 增加獨立的 `oneOffLessons` 集合；`OneOffLesson` 不借用 `RecurringLesson` 或缺少原課的 override。
- v7 validator 驗證 one-off 欄位、真實日期、時間 union、ID 與 Project／Timetable／TeachingUnit／Class／Subject／SchoolPeriod 參照；`isSafeAppDataV7Update` 保留既有節次安全規則，並禁止改動封存 Project 的 one-off。
- v6→v7 純遷移只加入空集合，原有 Project、Timetable、School、TeachingUnit、Subject、固定課程及 override 保留；不轉換 legacy overrides。
- runtime 改用 `aster-timetable-data-v7`。讀取優先 v7；v7 損壞時保留原始內容並停寫，不回退覆蓋。v6 與更舊的 key 保留原樣。首次遷移與延遲寫入會檢查 v6 是否被舊版分頁改動；偵測到時暫停 v7 寫入並提示衝突。
- 既有 Timetable、固定課程與設定資料操作做了必要的 v7 相容判斷；課表複製不複製 one-off。既有 occurrence 自我衝堂修復、週末七天顯示及星期日首欄的回歸測試仍通過。

## 尚未完成

- **沒有** one-off 建立／編輯／確認後刪除的 CRUD API、ID 產生流程、schedule resolver、衝堂查詢、拖曳整合或 LessonEditor／週課表入口。不要因 `oneOffLessons` 已存在就認為單日新增、補課、代課已可供使用。
- 尚未有 one-off 與固定課程、單日異動之間的實際衝堂及雙卡呈現測試；未進行瀏覽器人工驗收。
- 刪除後「ID 永不重用」無法單靠目前集合 validator 證明歷史唯一性；2C-2B-2 需確定 ID 產生與刪除策略，不能重用現存 ID，也不能悄悄引入不必要的 schema 欄位。

## 已確定產品規格

- 單日新增、補課、代課使用獨立 `OneOffLesson`，`purpose` 分別為 `extra`、`make-up`、`substitute`。補課可選填 `relatedRecurringLessonId`，只作來源資訊；原固定課程日後刪除不使 one-off 無效。
- one-off 有自己的 `id`、`projectId`、`timetableId`、`teachingUnitId`、`classId`、`subjectId`、`date`；可發生於週一至週日，不擴充 recurring `DayOfWeek`。所選日期須落在所屬 TeachingUnit 的學期範圍。
- `time` 為明確 discriminated union：`{ mode: 'period', periodId }` 引用該學制的既有 SchoolPeriod，**不**另存自訂起訖；`{ mode: 'custom', startTime, endTime }` **不**使用 periodId。
- 自訂時間使用 **24 小時制 `HH:mm`**，小時 `00–23`，分鐘只能是 `00、05、10、15、20、25、30、35、40、45、50、55`；結束必須晚於開始，不支援跨午夜。`09:30–11:00` 合法，`09:32`、`24:00`、欄位混用均不合法。既有 SchoolPeriod 的 legacy 時間相容規則不變。
- one-off 不參與課表複製；封存 Project 唯讀，Project／Timetable／TeachingUnit／Class／Subject 歸屬與跨校衝堂語意不得退化。A/B anchor 仍依星期一週次計算；七天畫面星期日為目前顯示週之星期一前一天。
- v7 使用新 LocalStorage key；v6 與更舊 key 不刪除、不自動覆寫。遷移只處理已驗證 v6，不自動解讀 legacy overrides。

## 主要檔案

- 型別：[src/types/v4.ts](src/types/v4.ts)、[src/types/index.ts](src/types/index.ts)。
- 驗證與遷移：[src/data/validators/v7.ts](src/data/validators/v7.ts)、[src/data/validators/current.ts](src/data/validators/current.ts)、[src/data/migrationsV7.ts](src/data/migrationsV7.ts)。
- 儲存與分頁防護：[src/data/storageV7.ts](src/data/storageV7.ts)、[src/hooks/useAppDataV4.ts](src/hooks/useAppDataV4.ts)、[src/hooks/useLocalStorage.ts](src/hooks/useLocalStorage.ts)、[src/App.tsx](src/App.tsx) 的儲存提示。
- 既有操作相容：[src/data/timetablesV6.ts](src/data/timetablesV6.ts)、[src/data/schoolUnitCreation.ts](src/data/schoolUnitCreation.ts)、[src/data/subjectsV5.ts](src/data/subjectsV5.ts)、[src/data/projectRuntime.ts](src/data/projectRuntime.ts)、[src/lib/scheduleV4.ts](src/lib/scheduleV4.ts) 等；LessonEditor 與 MultiSchoolSchedule 只有 v7 判斷相容調整，沒有 one-off UI。
- 新增測試：[src/data/validators/v7.test.ts](src/data/validators/v7.test.ts)、[src/data/storageV7.test.ts](src/data/storageV7.test.ts)、[src/hooks/useAppDataV7.integration.test.tsx](src/hooks/useAppDataV7.integration.test.tsx)；既有 App、設定及 hook 整合測試改以 v7 runtime 驗收。

## 驗證紀錄

在目前 HEAD、建立本文件前重新執行：

| 指令 | 結果 |
| --- | --- |
| `npm run test -- --run` | 38 個測試檔、368 項測試通過 |
| `npm run lint` | 通過 |
| `npm run build` | TypeScript 與 Vite build 通過 |

本次未執行瀏覽器人工驗收或正式 LocalStorage 備份／還原演練；不可宣稱已通過。文件新增後應執行 `git diff --check`，並重新確認 Git 狀態。

## 未解決風險與下一步

1. 先確認分支、工作樹及本文件，再閱讀 v7 types／validator／storage 與既有 resolver／lessonChanges 實作和測試；不要假設 one-off 已能解析或寫入。
2. 為 2C-2B-2 先定義純資料 CRUD 與 occurrence identity／衝堂測試，再接入既有單次 safe-update；每次寫入以最新 AppData 重新驗證，封存 Project 拒絕寫入，不能把單日新增偽裝成 move 或 legacy override。
3. 之後才整合 resolver 與 UI；補上平日／週末、period／custom、補課來源被刪除、跨 Project／Timetable 隔離、課表複製排除、寫入失敗與跨分頁衝突測試。不要在此階段擅自改 A/B 週、recurring DayOfWeek 或舊資料 ID。
4. **跨版本分頁限制：**v7 開啟期間可偵測 v6 後續寫入並停寫，但舊版程式本身不會被 v7 阻止；若舊 v6 分頁在 v7 未開啟時寫入，兩個 key 沒有共同修訂號，無法可靠自動偵測或合併。要求使用者關閉舊分頁、匯出並人工核對；不可宣稱已完全解決跨版本同步。
