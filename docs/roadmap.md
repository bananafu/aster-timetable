# Toki v0.3.2 roadmap

## Phase 0 — Architecture review（完成）

已確認品牌／專案命名分離、AppData v4 關係、每個 v3 term 遷移為獨立 project、全域 Subject、effective-dated lesson versioning、跨校實際時間及新舊 storage key 安全策略。

驗收：架構、產品需求、遷移策略與主要風險已記錄於 `docs/`。

## Phase 1A — Schema, types and validator（完成）

已建立 v4 TypeScript types、完整結構與引用 validator、自動測試；保持 v0.3.1 runtime 與既有測試相容，未接上 UI 或 LocalStorage。

驗收：有效資料通過；重複 ID、錯誤引用、無效日期／時間、跨 project 引用、週型設定與版本區間錯誤會被拒絕；完整 test/lint/build 通過。

## Phase 1B — Safe v3 → v4 migration（完成）

已建立新的 v4 key routing、確定性遷移、原始 v3/v1 保留、原始資料回傳與遷移前後完整性測試。v4 runtime UI 啟用前不會自動執行 cutover，避免目前 v3 操作後造成 v4 副本過期；正式接線留在採用 v4 runtime 的後續 Phase。

驗收：成功遷移不遺失 ID 或內容；失敗不寫入 v4、不修改舊 key；既有 v4 優先且不 fallback。

## Phase 2 — Project and school management UI（進行中）

### Phase 2A — v4 runtime 與專案切換（完成）

已完成 v4 runtime 單一寫入接入、首次安全 migration、專案新增／重新命名／切換、基本資料隔離及 Toki 品牌介面。

### Phase 2B — 多學校與任教單位設定（完成）

已完成 project-scoped School、識別色、多 TeachingUnit、獨立日期／節次／A/B 週設定，以及班級新增、編輯、歸屬與引用安全保護。

### Phase 2C — 跨校課表總覽（完成）

已完成總課表／各校課表切換、任教單位篩選、逐單位日期與 A/B 週解析、實際時間排序、半開區間衝堂提示，以及取消／替換異動呈現。不同單位的 period ID 不會強制對齊；未歸屬異動不參與排課。

驗收：不同節次制度可同週並列；日期範圍、輪週、override、project isolation 與時間邊界均有自動測試；桌面與手機可讀。

### Phase 2D — 專案生命週期與首次使用流程（完成）

已完成無專案首次使用入口、唯讀範例、明確預設的空白專案、跨學期專案複製、project-scoped ID 重建、封存／歷史查看／重新啟用，以及具有影響範圍提示的專案刪除。範例不寫入正式資料；複製不包含事件或 override，且多版本課程在尚未能安全確認時會阻止操作。

驗收：首次使用不自動建立範例；空白建立不沿用目前專案；新學期日期與 A/B anchor 必須重新確認；封存專案可唯讀查看並重新啟用；刪除不影響其他專案或全域科目庫；完整 test/lint/build 通過。

## Phase 3 — Lesson editing and versioning（進行中）

### Phase 3A — 統一 v4 固定課程編輯（完成）

已完成直接寫入 AppData v4 的 LessonEditor、固定課程新增／基本編輯／安全刪除、Project／School／TeachingUnit／Class／period 引用驗證、A/B 週衝突檢查，以及 Dashboard 與跨校課表的統一顯示及編輯入口。舊版 adapter 不再參與固定課程寫入。

### Phase 3B — 單日異動與永久版本切分（完成）

已完成單日取消、移動、內容替換與交換，以及自指定日期起永久修改／交換及安全結束。單日移動以原 TeachingUnit 的 period 與實際時間驗證，目標占用時必須選擇交換、明確保留衝堂或取消；所有異動先預覽確認才寫入。固定課程採 effective-dated versioning，生效日前歷史與既有 override 引用均受保護。

驗收：永久修改不改寫歷史；單日異動與固定版本獨立；跨 project / unit 引用被阻擋；封存專案唯讀；重新載入後解析一致；完整 test/lint/build 通過。

### Phase 3C — 編輯體驗整合與歷史版本管理（完成）

已將固定資料、僅此日期與永久變更整合至單一 LessonEditor，點擊課程後顯示完整 project／學校／任教單位／日期／節次／實際時間與異動狀態。高風險操作提供原位置、目標位置、衝堂及版本影響預覽；版本歷史依 series 呈現有效範圍且維持唯讀。桌面與手機沿用既有設計 token，並支援 Escape 取消及可辨識的對話框關閉控制。

驗收：Dashboard、總課表與各校課表共用相同日期脈絡；異動確認前不寫入；歷史版本不可直接回寫；A/B 週、跨校、封存、project isolation、重新載入與多分頁安全測試保持通過。

### Phase 3D — 單日異動管理與安全撤銷（完成）

已在統一 LessonEditor 顯示指定日期的取消、移動、替換或交換狀態，並提供預覽後撤銷及原子改寫。交換以 `groupId` 一次移除雙方紀錄；移動撤銷會恢復原位置並移除目標卡片。改寫流程先在記憶體完整撤銷舊異動，再建立新異動，最後只寫入一次 v4 state，避免重複或殘留 override。

驗收：取消／移動／替換／交換均可安全恢復；交換不會單邊撤銷；版本切分後重新指向的 override 仍可撤銷；封存、project isolation、重新載入與既有 storage／多分頁保護測試通過。

## Phase 4 — Schedule interactions（進行中）

在既有跨校實際時間總覽上加入拖曳與進階互動；保留單校節次檢視。

驗收：不同節次制度可正確並列；邊界相接不誤判衝突；拖曳結果需經資料層驗證。

### Phase 4A — 桌面拖曳調課（完成）

已在總課表與各校課表加入桌面滑鼠拖曳。拖曳只產生經原 TeachingUnit 實際時間映射的操作意圖，drop 後開啟既有 LessonEditor，預設為「僅此日期／移動」，經預覽與確認才寫入 v4。目標占用會導向既有交換／保留衝堂／取消流程；已有 override、封存專案、學期外日期及無法安全映射的跨校時段均不會直接寫入。Escape 可取消拖曳，手機觸控拖曳留待 Phase 4B。

驗收：drop 前資料不變；原課程歸屬與 periodId 規則不變；有效／無效目標、衝堂、既有 override、唯讀、取消及重新載入均有自動測試；完整 test/lint/build 通過。

### Phase 4C-1 — 班級名單與新增固定課程流程（完成）

沿用 School → TeachingUnit → ProjectClass 關係，班級可選用年級與正整數班號並以三位以上代碼顯示；舊 name-only 班級保持相容。LessonEditor 依學校篩選國中部／高中部學制，班級與節次只取自所選 TeachingUnit，切換歸屬後會清除失效選擇；缺少學制、班級或節次時提供明確空狀態與專案設定入口，不會繞過 v4 validator 或自動建立班級。

驗收：一校多學制、班級代碼、重複防護、舊資料相容、表單切換、空狀態、固定課程持久化與 Phase 4A 拖曳回歸測試通過。

## Phase 5 — Stabilization and release acceptance（待辦）

完成 migration、LocalStorage、多分頁、日期邊界、無障礙及響應式驗收，並進行正式資料備份／復原演練。

驗收：完整 test/lint/build 通過，無 P0/P1 資料安全問題；經產品負責人確認後才可 Commit、Push、Merge 或部署。
