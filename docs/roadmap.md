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

## Phase 2 — Project and school management UI（待辦）

加入 Toki 品牌介面、專案新增／命名／切換、學年度與學期獨立欄位、學校與 TeachingUnit 設定。

驗收：同學期可建立多專案；切換不丟失未儲存資料；各校節次與輪週設定可安全維護。

## Phase 3 — Lesson editing and versioning（待辦）

加入固定課程新增／編輯、永久修改生效日、單日異動與歷史檢視。

驗收：永久修改不改寫歷史；單日異動與固定版本獨立；跨 project / unit 引用被阻擋。

## Phase 4 — Cross-school schedule and interactions（待辦）

建立跨校實際時間總覽、衝突提示與拖曳操作；保留單校節次檢視。

驗收：不同節次制度可正確並列；邊界相接不誤判衝突；拖曳結果需經資料層驗證。

## Phase 5 — Stabilization and release acceptance（待辦）

完成 migration、LocalStorage、多分頁、日期邊界、無障礙及響應式驗收，並進行正式資料備份／復原演練。

驗收：完整 test/lint/build 通過，無 P0/P1 資料安全問題；經產品負責人確認後才可 Commit、Push、Merge 或部署。
