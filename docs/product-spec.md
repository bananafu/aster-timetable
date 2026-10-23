# Toki v0.3.2 product specification

## Phase 4D R2-C2b-3 — V8 教師課表管理（尚未正式啟用）

- 每位教師一份獨立 Timetable，Timetable 直接歸屬 Project，不強制歸屬單一 TeachingUnit；同一份課表可包含多任教單位的合法內容。不同 Project／教師的課程、活動與進度必須依 Timetable ID 隔離，不以名稱辨識。
- 一般新增課表只建立名稱、教師名稱及獨立 ID；無 TeachingUnit 也可建立，不自動建立 Lesson、OneOff、Change、Event 或 Progress。編輯只變更目標課表設定；明確複製只複製設定至指定 Project 並重建 ID，不複製課程或活動。
- 刪除前顯示固定課程、單日課程、異動、已解析事件及進度引用摘要；任何有效引用皆阻擋，不級聯刪除。無引用時仍需明確確認。正式高影響刪除備份 UI 仍待接線。
- 獨立 V8 UI 的唯讀／衝突狀態禁止寫入並提供 JSON 匯出及恢復接線；草稿捨棄需確認，成功提示需精確 raw 與對應 revision 的 Host receipt。正式 App 與 OverviewCalendar 尚未切換至 V8。

## Phase 4D R2-C2b-2 — V8 科目、班級與任教配置（尚未正式啟用）

- 科目屬於個別 Project；相同名稱不代表同一筆科目，Project 內重複名稱／簡稱依現有 V8 validator。任教配置只連結同 Project 的 Subject 與 TeachingUnit；刪除前須解除配置與課程／進度引用。
- 班級屬於個別 Project 的 TeachingUnit；年級、班號、名稱、教室沿用現有規則，刪除與跨任教單位移動不得留下課程、異動或進度的失效引用。空白 Project 可以沒有科目、班級或教師課表；新增 Subject／Class 不會自動產生 Timetable／Lesson。
- 獨立 V8 UI 的唯讀或 conflict 狀態禁止寫入並保留 JSON 匯出／恢復接線；未儲存草稿需確認捨棄，成功提示須等待與文件一致的 persistence receipt。正式 App 尚未切換至 V8。

## Phase 4D R2-C2b-1 — V8 Project 管理（尚未正式啟用）

- 「新增空白專案」只建立新 Project 及預設學校、任教單位，不建立教師課表，也不繼承任何其他 Project 的科目、班級、課程、事件、異動或進度。學校／任教單位是可編輯的既有預設，並非 schema 必要結構。
- 「複製為新學期」是獨立操作，必須選來源 Project，並為每個任教單位明確選來源有效日期、新起訖日期與 A/B anchor。依既有 V8 policy 複製學校、任教單位、教師課表、科目、關聯、班級及來源日期有效固定課程；新 ID 與引用獨立，事件、單日課程、異動及進度不複製。
- 專案切換只變更 active ID。刪除先展示引用影響、提醒保存額外備份並再次確認。唯讀／衝突時禁止寫入；成功僅以 V8 persistence receipt 認定，不把 React state 更新當成持久化。

## Phase 4D R2-C2a — 開發階段空白 V8 初始化

- 未來正式 App 以 V8 為唯一 Runtime；新環境直接使用完全空白的 V8 文件，不要求匯入 V7 測試資料。C2a 僅建立底層契約，**正式 App 尚未切換**。
- 空白 bootstrap 只能由明確呼叫啟動。Web Locks 不支援或取得失敗、V7 或其他已知舊 data key 存在、既有／損壞 V8、既有 V1／V2 activation、未知或中斷 bootstrap 都必須阻擋；不得自動遷移、清除、接管或覆寫。
- Bootstrap metadata 記錄空白來源、嘗試 ID、初始與目前 SHA-256 digest、document revision、狀態及時間。preparing、V8 document、active 分步寫入讀回；中斷與部分完成保持唯讀，不自動恢復。有效 V8 文件本身不賦予寫入資格，只有驗證通過的 active bootstrap 或原有 V2 active cutover 證據可寫。
- 開發清理只可在明確開發模式對選取的舊測試 data key 操作；先列出 exact raw 供外部 JSON 保存，顯示精確清單並取得使用者確認。不得在 mount 自動清理，不得用 `localStorage.clear()` 或前綴模糊刪除，也不刪 V8、activation、備份或 rollback archive。本階段沒有正式清理 UI，沒有實際執行清理。
- 正常 V8 更新維持完整 validator、stale snapshot／V7 guard、Web Lock、digest／revision 與讀回 receipt。LocalStorage 跨 key 非原子；不遵守協定的舊頁面仍可能造成衝突，不能以測試假設絕對互斥。正式發布前仍需驗收 JSON 匯出、匯入與恢復。

## Phase 4D R2-B2c — Conflict, recovery & rollback archive foundation

- 正式 cutover 前要求其他 Toki 分頁關閉或重新整理；新版 session 協調只能識別及請求可回覆的新版分頁，無回覆不代表無分頁。舊版分頁目前無可驗證的停止寫入證據，故正式啟用一律 blocked；使用者勾選不能取代技術證據。
- Web Locks 缺失、request 失敗或協調能力不足時阻擋 cutover；唯讀 preflight 與原始 JSON 匯出仍可用。不得建立 localStorage 假鎖或強制啟用。
- V7 baseline 變動、空白來源後新建 V7 key、V8 digest 改變或 transaction 損壞皆維持唯讀衝突恢復；不自動合併、更新 fingerprint 或改寫任一側原始資料。
- Recovery inspection 使用固定分類優先順序，回傳結構化 blocking issue、source／transaction identity、原始資料、匯出／人工重試資格與下一步；檢視本身不寫入、不自動續行。
- Rollback 前先建立獨立 V8 archive：exact raw、SHA-256、revision、activation lineage 與讀回驗證缺一不可。Archive 失敗不得標示 verified；損壞 V8 只提供救援匯出。Rollback planning 唯讀，V8-only change 無法判定時標記 unknown；本階段不重啟 V7 或執行正式 rollback。
- 正式 App 仍使用 V7。B3／B4 的 cutover UI、正式 Runtime 接管與真實瀏覽器多分頁驗收尚未完成。

## Phase 4D R2-B2b — Activation transaction protocol

- 正式 cutover 只能在使用者明確操作、已驗證內部 backup receipt、已準備外部 JSON 且使用者確認保存、source identity 完全一致、唯讀 preflight 通過時啟動。沒有 V7 key 時使用 `empty` source 與空白 V8 candidate，不偽造 V7 指紋。
- V2 transaction 使用獨立 key，依 `preparing → prepared → active` 寫入；`active` 必須最後建立。每步重查並讀回 V7 raw、V8 candidate、backup 和 transaction ownership。相同 ID 的有效 active 重複呼叫只回傳已驗證的 `replayed` receipt，不重寫；中途失敗保留已寫入狀態與所有原始資料，不自動清除、覆寫或升級。`interrupted` 與 `rolled-back` 不會自動轉 active。
- 新版 V8 Host 僅在有效 V8 + 已驗證 V2 `active` metadata + 目前 raw digest／合法 document revision + 未改變的 V7 baseline + 無 conflict 時寫入；metadata 移除或改變立即撤銷資格，實際寫入前再次驗證。candidate digest 作為固定 baseline，正常編輯以 `currentDigest`／`documentRevision` 前進。沒有 metadata 的有效 V8 改為唯讀（與原 R2-A 測試預期不同）。
- 同版本分頁使用 Web Locks 協調；不支援或 lock 失敗時停止寫入。這不能阻止已載入的舊版 Host 或 V7 分頁，也不使 LocalStorage 多 key 寫入具原子性。錯誤時保留結構化狀態與本頁 JSON 匯出；不能把 mock 測試當作瀏覽器互斥證明。
- 本階段只提供明確呼叫的底層 service 與唯讀 inspection，未接入 `App.tsx`、未正式啟用 V8、未提供 rollback UI。B2c 仍需人工恢復／archive 流程；B3／B4 仍需正式接入與真實多分頁驗收。

## Phase 4D R2-B2a — Backup & preflight foundation

- 正式切換前必須保存精確 V7 raw、SHA-256 digest 並讀回驗證；每次嘗試使用獨立 backup ID 與 key，既有備份不可覆寫。沒有 V7 key 時使用明確的 empty-source marker，不虛構 V7 raw 或 fingerprint。
- Cutover preflight 只讀取來源並產生 V8 candidate；blocking migration、損壞／既有 V8、未知 activation 與來源 fingerprint 不符均阻擋。Review issue 保留結構化資訊，供後續確認。
- 外部 JSON 匯出準備與使用者確認已保存是兩個獨立狀態，確認必須綁定特定 source digest；來源變更即失效。
- Rollback archive 契約保留 V8 原始 raw 與 digest，恢復狀態固定為唯讀；本階段不執行 rollback 或刪除 V8 key。
- B2b 已實作底層 transaction 與同版本 Web Lock 協調；B2c 人工恢復與正式 App cutover 尚未實作。LocalStorage 跨 key 寫入與不遵守協定的舊頁面仍不具原子互斥保證。

## Phase 4D R2-A — V8 Runtime Host foundation

- `useAppDataV8` 是獨立且未接入正式 App 的 V8 runtime host；正式 V7 runtime、storage key 與使用者流程維持不變。
- 原 R2-A 的有效 V8 即可寫入資格，已由 R2-B2b 收緊為必須具備有效 V2 active transaction；單一 `setData` 入口仍驗證 current／next、V8 snapshot、V7 guard，並在 V8 與 transaction 讀回確認後才發出 revision receipt。
- V8 不存在時只建立空白狀態或執行 V7 migration preflight／reconciliation。migration candidate 保持唯讀，不自動寫入 V8，也不自動啟用 migration。
- 損壞的 V8、被阻擋的 V7 migration、寫入失敗及跨分頁衝突均保留原始資料或本頁草稿，並提供 V7／V8／本頁 JSON 匯出；stale write 不得覆蓋外部分頁版本。
- Activation metadata 僅定義不可變的 V7 source fingerprint、source key、V8 activation revision、timestamp 與 status 契約；本階段不建立、不更新也不啟用該紀錄。

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
