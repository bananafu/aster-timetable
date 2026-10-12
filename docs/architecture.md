# Toki v0.3.2 architecture

## Phase 0 決策摘要

v0.3.2 採用 AppData v4 與 Single-user / Multi-school architecture。App 品牌與課表專案分離；每份 `TimetableProject` 代表一個可獨立命名的學年度／學期課表，並可包含多所學校及各校不同的節次制度。

`Subject` 為全域共用資料。`School`、`TeachingUnit`、`Class`、固定課程、事件與單日異動皆具有明確的 project scope。`activeProjectId` 是目前操作專案的唯一來源，但按日期查詢課程時仍以資料本身的日期範圍為準。

主要關係：

- `AppDataV4` → 多個 `TimetableProject`、全域 `Subject`
- `TimetableProject` → 獨立的 `AcademicTermDescriptor`、多個 `School`
- `School` → 多個 `TeachingUnit`
- `TeachingUnit` → 獨立日期範圍、A/B 週設定、`SchoolPeriod` 快照、班級與固定課程
- 事件以實際日期為主要依據，project / teaching unit 僅作分類
- 無法安全歸屬的資料必須保留並產生 migration warning

`SchoolPeriod.id` 與 `order` 分離；重新排序不得改變 ID。相同 TeachingUnit 內 ID 與 order 皆須唯一，且引用中的節次不得無提示刪除。

## v3 → v4 遷移策略

正式遷移將使用新的 `aster-timetable-data-v4` key，既有 v3 與 v1 key 原樣保留。若 v4 已存在，無論有效或損壞，都不得以 v3/v1 靜默回退並覆寫；損壞資料須保留原始 JSON 並要求使用者明確處理。

每個 v3 `AcademicTerm` 確定性地轉為一個獨立 `TimetableProject`、一所預設 `School` 與一個預設 `TeachingUnit`。`activeTermId` 映射為 `activeProjectId`；封存狀態映射至專案。課程、班級、事件與異動依原 term 關係映射，無法安全歸屬者保留並警告，不得刪除。

若既有資料有已儲存的 project name，必須保留；否則使用 `原有課表・{舊學期名稱}`。遷移必須在寫入前後完成驗證、可重複執行且結果可預測；失敗時不得寫入部分 v4 資料或改動任何舊 key。

## 永久調課版本化

永久修改固定課程採 effective-dated versioning，而非覆寫歷史紀錄。固定課程具有穩定 `seriesId`、`effectiveStart` 與選用的 `effectiveEnd`。自指定日期修改時，舊版本在前一日結束並建立新版本；歷史日期仍解析舊版本。單日取消、代課或移動仍是獨立 override，不得改寫固定課程版本。

## 跨校時間處理

各 `TeachingUnit` 保有自己的節次 ID、順序與實際時間。單校課表可用「星期 × 節次」呈現；跨校總覽必須將節次轉成實際時間區間，不能用不同學校的 period ID 強制對齊。

時間衝突採半開區間判定：`a.start < b.end && b.start < a.end`；一堂課結束時間等於另一堂開始時間不構成衝突。A/B 週仍依各 TeachingUnit 的 anchorDate 與 anchorPattern 計算，不因跨校或假日自動停週。

## 技術風險

- v3 的全域 classes 拆分至 project / teaching unit 時可能缺乏可靠歸屬，必須用課程引用建立映射並保留警告。
- v3 `termId: null` 的事件與異動不可遺失；未修復前不得錯誤參與排課。
- 多學校重疊日期下，事件分類、跨校時間衝突與時區邊界需以純日期及 `Asia/Taipei` 規則一致處理。
- effective-dated versions 必須防止同一 series 日期區間重疊或出現缺口。
- 新舊 schema 並存時，選 key、驗證、匯出原始資料及多分頁衝突保護都需有整合測試。
- Phase 1A 只建立 schema/types/validator；正式 migration 寫入與 UI 在後續階段完成。
