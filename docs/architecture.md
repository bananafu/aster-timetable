# Toki v0.3.2 architecture

## Phase 4D A1 — V8 Event ownership foundation

`CalendarEventV8` 使用 `ownershipStatus` discriminated union。`resolved` Event 必須保存單一 `timetableId`，且 Project、Timetable 與 TeachingUnit 引用一致；`unresolved` Event 不得保存 `timetableId`，並以 `ownershipIssue.reason` 與確定性排序的 `candidateTimetableIds` 保留未來修復所需脈絡。

V7 → V8 遷移只在 Event 有有效且同 Project 的 TeachingUnit，且該 Project 恰有一份 Timetable 時自動 resolved。Project 未歸屬、TeachingUnit 缺失、Project 沒有 Timetable 或存在多份 Timetable 分別標記為 `unassigned-project`、`missing-teaching-unit`、`missing-timetable` 或 `ambiguous-timetable`。遷移保留 Event ID 與全部既有內容，不複製 Event，也不修改來源文件。

V8 Event selector 以 Project + Timetable 查詢 resolved Event；unresolved Event 由獨立 selector 提供修復流程使用。既有缺少 ownership 欄位的 V8 文件在讀取時以相同規則純轉換，通過完整 V8 validator 後才可用既有 CAS 契約寫回；原始 V8 與 V7 key 在確認寫入前不變。

## Phase 4C-3C-2B 多教師資料基礎與 v6 儲存

`AppDataV6` 新增 project-scoped `Timetable`；固定課程與已歸屬單日異動保存 `timetableId`，未歸屬舊異動保留 `null` 並繼續不參與排課。每個 v5 Project（含封存）確定性地轉成一份預設課表，既有課程、版本、異動及科目 ID 不變。舊資料沒有授課教師姓名，預設課表以 `teacherName: null` 與 `teacherNamePending: true` 明確標記待補；新建空白專案的預設課表要求輸入真實教師姓名。

新 key 為 `aster-timetable-data-v6`。讀取優先 v6；損壞時保留原始內容並停止，不回退覆寫。v6 不存在時沿用 v5→v4→v3→v1 安全載入，通過 v6 validator 後才寫新 key，所有舊 key 原樣保留。非 5 分鐘節次可原值保留，多分頁衝突保護沿用現有 hook。

此階段沒有多課表 UI；舊固定課程、異動、專案複製與 legacy project view 寫入只在 Project 恰有一份課表時執行，避免任意選第一份。多教師解析、衝堂、拖曳、交換、複製學期及課表切換留待 4C-3C-2C。畫面選取狀態不進入 `AppDataV6`，切換不得產生資料寫入。

## Phase 4C-3A-1 科目適用學制與 v5 儲存

Subject 仍為單一全域資料，保留既有 ID、名稱、簡稱與顏色；`applicableSchoolLevels` 是非空、無重複的 `SchoolLevel[]`，涵蓋 `junior-high`、`senior-high`、`other`。任教科目設定與 LessonEditor 共用同一適用性判斷，依所選 TeachingUnit 的 `schoolLevel` 篩選可選科目。已排課程、封存專案與歷史版本仍依穩定 subjectId 解析，不因篩選而隱藏。

新增 `aster-timetable-data-v5` 與 `schemaVersion: 5`。首次載入優先讀取 v5；v5 存在但損壞時保留原始內容並停止，不回退。v5 不存在時沿用既有 v4／v3／v1 安全讀取路徑，再將缺少適用學制的舊科目確定性地標記為適用所有既有學制。所有舊 key 原樣保留。遷移寫入前會再次檢查 v5 key 是否已由其他分頁建立；舊有非 5 分鐘節次可原值遷移，但不得新增或修改成非 5 分鐘時間。

## Phase 4C-3A-2 科目安全管理

共用科目資料操作提供新增、編輯、刪除、搜尋與全域引用分析。固定課程的所有版本和單日替換的 replacement 引用都參與檢查，包含複製、封存與未歸屬資料。縮減適用學制時，只要被移除的學制仍有引用，或引用無法可靠判定學制，就拒絕變更；刪除要求零引用與明確確認。全域名稱、簡稱和顏色修改也要求呼叫端明確確認，並提供受影響專案及引用紀錄。

對既有不一致課程，資料層允許同一任教單位保留原 subjectId 並修改其他欄位；新指定或改選不適用科目一律拒絕。舊 SubjectPanel 的顏色更新改走共用操作，legacy project view 不再回寫 Subject。此階段不變更 v5 schema 或 storage key。
複製專案若會建立學制不適用的新課程引用，會先阻止複製；legacy project view 合併時也會檢查固定課程與 replacement 的科目選擇。

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
