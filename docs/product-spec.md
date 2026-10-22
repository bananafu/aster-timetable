# Toki v0.3.2 product specification

## Phase 4D S1-A — TeachingUnit 科目配置

- 科目定義屬於目前 Project 的 catalog；科目是否可在某個學校與學制使用，由獨立 `TeachingUnitSubject` 配置決定。
- 同一 Subject 可分別配置到同 Project 的多個 TeachingUnit。其他學校或其他學制啟用同名科目，不會自動影響目前 TeachingUnit，也不構成名稱衝突。
- `applicableSchoolLevels` 只代表科目適用學制，不代表已配置到每個相符 TeachingUnit。
- 移除配置時必須保護該 TeachingUnit 的課程、單日異動與進度引用；永久刪除 Subject 前必須確認所有配置及引用都已安全解除。
- 複製為新學期會複製 catalog 與既有配置並建立全新的 ID mapping；一般新增 Project 不建立科目或配置。
- 本階段只建立 V8 資料層契約；正式 V7 Runtime、storage 與科目管理 UI 留待後續整合。

## Phase 4D A1 — V8 Event ownership

- 每筆 V8 Event 只屬於一份 Timetable；查詢範圍必須同時包含 Project 與 Timetable，不能因同屬 Project 而顯示在其他教師課表。
- 舊 Event 只有在 `teachingUnitId` 有效且所屬 Project 恰有一份 Timetable 時，才能自動建立 resolved ownership。
- 無 Project、無有效 TeachingUnit、沒有 Timetable 或有多份候選 Timetable 時，Event 原始 ID、內容與引用必須完整保留為 unresolved，等待後續修復；不得猜測、複製或顯示於任一教師的正常課表。
- 本階段只建立 V8 型別、遷移、驗證與 selector；V7 的 Project 共用 Event 行為及正式 Runtime 維持不變。

## 同專案多教師課表資料基礎

一個 Project 表示學期，可包含多份有獨立 ID、課表名稱與授課教師姓名的 Timetable；學校、學制、節次、班級與全域科目沿用 Project／全域設定。固定課程與單日異動歸屬 Timetable。舊資料遷移成每專案一份預設課表；缺少的真實教師姓名標為待補，不猜測或虛構。新建空白專案時的預設課表須輸入教師姓名。多課表切換、新增與教師姓名展示不屬於 4C-3C-2B。

## 同專案 Timetable 複製

- 使用者可在未封存 Project 內複製教師資料完整的 Timetable，並指定基準日期；介面預設使用本地今天。
- 副本只包含基準日期有效的完整固定週課表，保留所有上課星期、EVERY／A／B 週型與來源 `origin`；各課程自基準日期延續至所屬 TeachingUnit 的學期結束日。
- 歷史與未來固定課程版本不會跟隨至副本；所有單日取消、替代、移動、交換與未歸屬異動都不複製。Project 共用的學校、TeachingUnit、班級、科目、節次及事件只沿用原有資料與引用。
- 新 Timetable 名稱預填為來源名稱加上「（副本）」，教師姓名沿用來源，兩者皆可在建立前修改。來源與副本的 timetable、lesson 與 series ID 完全隔離。
- 介面只在 LocalStorage 寫入成功後切換至新 Timetable 並顯示成功；來源資料或相關 TeachingUnit 設定在表單開啟後變更時，必須拒絕過期操作。
- 個別 Timetable 刪除、個別 Timetable 封存、多 Timetable Project 的跨學期複製，以及上次選取 Timetable 的持久化不在本階段範圍。

## 品牌與命名

- App 正式品牌為 `Toki`，意象為日文「とき／時」。Logo、網站標題、側邊欄品牌區及相關介面統一使用 Toki。
- 延續 Japanese Architectural Minimalism，不加入早安、歡迎回來等問候語。
- 課表專案名稱不是 App 品牌。每位教師可建立、命名及修改多份課表專案。
- `project name`、`academic year`、`semester` 是獨立欄位；同一學年度與學期可有多份不同名稱的專案。
- `Shibanana Fuの課表` 只可能是既有使用者資料。若已儲存，遷移必須原樣保留，不得成為全體使用者預設值。
- Repository 名稱、部署 base path 與既有 LocalStorage key 不因品牌更名而立即改名。

## 多專案與跨校課表

- 使用者可切換多個 `TimetableProject`，每個專案對應一個學年度與學期。
- 一個專案可包含多所學校；每所學校可有不同顏色、班級及教學單位。
- 教學單位具有獨立起訖日期、A/B 週基準與節次快照；不同學校的 period ID、數量、順序與時間不必一致。
- 全域科目可跨專案與學校重用，班級及課程歸屬必須明確。
- 科目可適用國中、高中、其他或多種學制；任教科目設定與課程編輯依目前任教單位學制顯示適用科目。舊科目預設適用所有既有學制；既有課程與歷史不因篩選消失。
- 科目名稱、簡稱及顏色屬全域屬性；修改須提示跨專案影響。縮減適用學制時保護既有課程與異動引用；有任何引用的科目不可刪除。
- 跨校總覽以實際時間顯示與檢查衝突；單校檢視可保留節次操作效率。

## 課程與異動

- 固定課程支援 EVERY / A / B 週型與有效日期版本。
- 永久修改只影響指定生效日以後的版本，歷史課表不得被改寫。
- 單日取消、替代、移動或交換是獨立異動，不覆蓋固定課程。
- 一般會議與活動以實際日期查詢；分類欄位缺失時仍須保留及可見。
- 所有刪除、重設與 migration 必須遵循既有資料安全與確認規則。

## v0.3.2 範圍

包含 AppData v4 基礎、多專案、多學校、跨校時間課表與課程編輯基礎。Phase 1A 僅完成 TypeScript schema、validator 與測試，不包含 UI、拖曳操作或正式 v3→v4 寫入。

本版本不因品牌變更重命名 repository、部署路徑或舊 storage key，也不擴充雲端帳號、Calendar 同步或多使用者協作。
