# Toki v0.3.2 architecture

## Phase 4D R2-C2b-4 — V8 資源整合與回歸（未接入正式 App）

跨資源整合測試以同一份 V8 document 連續建立 Project、Subject、Class、TeachingUnitSubject 與教師 Timetable，每步通過完整 validator，並以 V8 storage 的 snapshot／revision 契約寫入及重新載入。另以空白 bootstrap 下的共用 V8 Host 串接 Class 與 Timetable 管理元件，驗證連續寫入及 receipt。測試亦涵蓋跨 TeachingUnit 的同一教師內容、不同教師／Project 隔離、複製新學期的暫態資料排除，以及 Subject／Class／Timetable 引用保護。

Project、Class、Timetable 管理元件以非 pending、目前文件 raw、receipt raw 與 receipt revision 同時相符才顯示成功；科目 Host 路徑同樣比對 raw／revision，保留舊版測試 harness 無 receipt 的相容輸入。Class 草稿在 Project 切換後不會寫入新 Project。這些為 mock storage／React 整合驗證，不是瀏覽器真實多分頁互斥證明；正式 App、V7 Runtime、schema 與 bootstrap／activation protocol 均未修改。

## Phase 4D R2-C2b-3 — V8 教師課表管理（獨立元件，未接入正式 App）

Timetable 直接屬於 Project，以 `teacherName` 表達教師，不具 TeachingUnit 外鍵；同一教師課表可包含多個任教單位的 Lesson、OneOff、Change、Event 與 Progress。`timetablesV8` 重用 `eventTopologyV8` 的建立／刪除安全操作，新增僅更新目標名稱／教師名稱，以及僅複製 Timetable 設定的明確複製操作。跨 Project 複製建立新 ID，不攜帶課程、活動或進度。刪除先計算目標課表各類引用；有引用即拒絕，不級聯刪除，也不因其他教師有引用而錯誤阻擋。

`timetableSelectionV8` 以 Project + Timetable ID 選取並重新校驗，依兩者篩選教師可見的課程、異動、已解析事件與進度；不以同名或單一 TeachingUnit 限制。獨立 `TimetableManagerV8` 提供列表、建立、編輯、設定複製、刪除及選取，唯讀／衝突時保留匯出與恢復接線。表單綁定開啟時的 Project、目標 Timetable ID 與文件快照，範圍變更時阻擋舊草稿寫入。資料寫入僅交給 V8 Host，精確 raw 與對應 revision 的 receipt 確認後才回報成功；正式高影響刪除備份 UI、Lesson／Event 編輯器及 `App.tsx` 接線尚未完成。

## Phase 4D R2-C2b-2 — V8 Subject、Class 與任教配置（獨立元件）

Subject 以 Project ID 隔離；TeachingUnitSubject 連結同一 Project 的 Subject 與 TeachingUnit，不是 Class 或 Timetable。既有 `subjectsV8` 負責建立、編輯、配置、引用檢查與刪除；`TeachingUnitSubjectManagerV8` 新增目前 Project 科目庫及未引用科目刪除入口，仍保留各任教單位啟用／移除操作。重名政策沿用 V8 validator 的 Project 內正規化名稱／簡稱唯一規則；不同 Project 可同名但 ID 獨立。

`classesV8` 是 V8 專用班級操作：Class 指向一個 Project 與該 Project 的 TeachingUnit，建立／編輯沿用既有年級、班號、名稱及教室規則；刪除或移動前檢查固定課程、單日課程、異動及進度引用，再由 V8 validator 與安全更新檢查把關。新增 Subject 或 Class 不建立 Timetable／Lesson。`ClassManagerV8` 以 V8 Host 的 `writable`、conflict 與精確 raw／revision receipt 控制寫入成功提示；`V8SubjectClassManager` 將既有科目管理器與班級元件組合，對科目操作只轉交符合當前文件的 Host receipt revision。LocalStorage 寫入仍只由 V8 Host 負責。正式 `App.tsx`、V7 Runtime、Teacher Timetable 均未改動。

## Phase 4D R2-C2b-1 — V8 Project lifecycle adapter（未接入正式 App）

`projectRuntimeV8` 沿用既有 V8 複製及刪除規則，新增只改 `activeProjectId` 的 Project 切換操作。V8 validator 容許 Project 沒有學校、任教單位或教師課表；一般建立保留既有預設學校／任教單位作為可編輯的設定起點，但不建立 Timetable，也不繼承來源科目、班級、課程、事件、異動或進度。複製為新學期需明確指定來源 Project、學期與每個 TeachingUnit 的來源有效日期、新日期及 A/B anchor；複製學校、任教單位、教師課表、科目、關聯、班級及當日有效固定課程，重建所有實體 ID 與引用，不複製 Event、override、one-off、progress。跨學期課程有效範圍使用新任教單位日期。既有 copy policy 未改動。

獨立 `ProjectLifecycleV8` 元件不掛入 `App.tsx`：新增／複製分開、關閉髒草稿需確認、唯讀或衝突禁止寫入並提供匯出／採用外部資料接線。成功回呼及關閉僅在 Host 回傳與預期 V8 raw 完全相同、revision 已前進的 persistence receipt 後觸發；失敗保留畫面與草稿。刪除顯示各類引用影響、備份提醒與再次確認；正式額外備份 UI 仍待後續接線。

## Phase 4D R2-C2a — V8-only bootstrap foundation（未接入正式 App）

開發階段決策改為直接建立完全空白 V8；正式 App 目前仍是 V7，既有 R1／B2 V7 migration、備份、交易與恢復模組保留作歷史路徑，但不是未來 App 空白初始化的必要流程。`storageV8.loadAppDataV8Only` 是唯讀檢視：區分 fresh、legacy key、V8 valid／corrupt、未知或既有 activation，以及 bootstrap preparing／active／interrupted；不讀取 V7 migration candidate、不持久化、不自動清除任何 key。Host 可明確以 `loadMode: 'v8-only'` 使用此路徑；預設舊模式保留供既有獨立回歸測試使用。

`activationV8.ts` 定義獨立版本化 `empty-bootstrap` key、完整 validator、attempt ID、不可變 `initialDigest`、目前 V8 raw 的 `currentDigest`、`documentRevision` 與 UTC 時間。狀態為 preparing／active／interrupted；interrupted 不會自動轉 active。`bootstrapEmptyV8` 僅可明確呼叫：要求 Web Locks，在同一鎖內重做 preflight，拒絕 V7 或任何已知舊版 Toki data key、既有／損壞 V8、V1／V2／bootstrap metadata，以及孤立的 cutover backup／rollback archive key。它依序寫入並讀回 preparing、validator 合法的空白 V8、active；失敗保留原始與部分資料並回傳結構化診斷，不重試、不覆寫。若 preparing 第一筆寫入完全未落盤，storage 仍可能呈 fresh；呼叫端不得把失敗回傳當成成功。

V8 Host 的寫入 gate 只接受互斥的有效 V2 active cutover 或 empty-bootstrap active 證據；bootstrap 的初始 digest 必須對應標準空白文件，且 V7 key 維持不存在。寫前重新驗證 metadata、V8 raw digest 與原始 snapshot。每次已確認的正常編輯只推進 `currentDigest`／`documentRevision`，保留初始 digest；V8 文件和 metadata 都讀回且 gate 再驗通過後才核發 receipt。任一失敗保留本頁草稿與原始 JSON 匯出，進入唯讀錯誤／衝突。Web Locks 只協調遵守協定的新版分頁；LocalStorage 跨 key 不具原子性，也不具真正 CAS。

`devLegacyResetV8.ts` 只在明確開發模式可用，唯讀列出 v1／v3／v4／v5／v6／v7 實際存在 key 及 exact raw；呼叫端需先提供逐筆匯出與精確清單，再傳入明確選取及一致確認。清理只對指定舊 key 使用 `removeItem` 並讀回確認，不觸碰 V8、activation、backup、archive、其他 origin 資料；沒有 App UI、import／mount 自動執行或本階段實際資料清除。

## Phase 4D R2-B2c — Session safety、唯讀恢復與 rollback archive foundation

`v8SessionSafety.ts` 提供 Web Locks／BroadcastChannel capability 探測、暫時性隨機 session ID、同源 `hello`／`ack`／`close-request`／`reload-request`／`closing` 訊息及新版分頁觀察。訊息只表示可回覆的新版分頁，presence、回覆、固定等待或使用者勾選皆不能證明不支援協定的舊版 V7 分頁已停止寫入。因此目前 production `inspectCutoverSessionReadiness` **一律回報 blocked**（`legacy-tabs-unverifiable`）；B2b activation 入口在進鎖前、取得鎖後及寫入 active 前重驗，不能因 capability 存在就啟用。Web Locks 不支援或取得失敗同樣阻擋；沒有 localStorage lock fallback 或強制啟用。

`recoveryInspectionV8.ts` 唯讀核對 V7／V8 raw、validator、V2 transaction、backup、digest、revision、source 與 archive；以固定優先順序分類 healthy-active、interrupted、source／V8 conflict、corrupt、backup 問題、archive-required 與 unknown-blocking。結果保留結構化 issue、原始匯出資料、唯讀與人工重試資格，不在檢視時修改 storage、重建 fingerprint 或自動續行。

`rollbackArchiveV8.ts` 在 Web Lock 下建立獨立且不可覆寫的 V2 archive，記錄 exact V8 raw、SHA-256、document revision、transaction ID、source／backup／candidate lineage 及 UTC 時間；寫後讀回驗證，任一步失敗不標示 verified。損壞 V8 僅回傳救援匯出 raw。`planV8Rollback` 唯讀核對 archive、lineage、revision、目前 V8 與 V7 baseline，將無法確認的 V8-only change 標示 `unknown`。本階段不重啟 V7、不降版或刪除 V8、不標記 rolled-back。

Critical 未解風險：瀏覽器無法可靠證明舊版分頁不存在；正式 cutover 維持 blocked，B3 前需可驗證的舊版寫入停止策略。High 未解風險：LocalStorage 跨 key 非原子交易；本階段測試為 mock，未做真實瀏覽器多分頁驗證。正式 App 仍由 V7 接管，B3／B4 的 UI、正式 runtime 接線與驗收均未完成。

## Phase 4D R2-B2b — Activation transaction protocol（未接入正式 App）

`activationV8.ts` 定義獨立 V2 transaction key `aster-timetable-data-v8-transaction-v2`；舊 V1 activation key 保留且不可與 V2 同時作為寫入證據。V2 紀錄 transaction ID、`empty`／V7 source identity、backup ID/key/digest、綁定來源的外部確認、candidate baseline digest、目前 V8 raw digest、document revision、UTC 時間及 archive reference；不複製完整 raw。狀態為 `preparing → prepared → active`、`preparing／prepared → interrupted`、`active → rollback-recovery → rolled-back`。`interrupted`／`rolled-back` 無自動返回 active 的轉換；未知或不完整格式視為 blocking。

`activateCutoverV8` 是只能由未來明確操作呼叫的獨立 service；它在 Web Lock 內重新執行唯讀 preflight，讀回並驗證不可覆寫的 V7 raw backup、SHA-256 和來源綁定的外部備份確認，再依序持久化並讀回 `preparing`、V8 candidate、`prepared`、最後 `active`。每一步重查 V7 source、V8 raw 與 transaction ownership；任一錯誤回傳結構化失敗，不刪除或自動覆寫 V7／V8／backup。相同 transaction ID 的既有有效 active 紀錄會重驗證所有證據並回傳 `replayed` receipt，不重寫任何 key；preparing／prepared／interrupted 不會自動續行。`inspectCutoverV8` 僅讀取並回報中斷、partial write、digest／來源／備份問題、原始 raw 與人工重試資格，不會自行恢復。Rollback archive 仍只有契約，沒有建立或回滾執行流程。

新版 `useAppDataV8` 只有在有效 V8 與 V2 `active` transaction、目前 digest／revision 證據、V7 guard 均通過時才可寫；無 metadata、非 active、未知 metadata、舊 V1 key 同時存在或 conflict 均唯讀。Candidate digest 是不可變的 cutover baseline；正常編輯後 `currentDigest` 與 `documentRevision` 隨確認的 V8 raw 前進，不以 baseline digest 永久鎖住編輯。寫入前重新讀證據，並用相同 Web Lock 協調遵守協定的新版分頁；activation metadata storage event 立即撤銷寫入資格。V8 寫入已確認但 metadata 更新失敗時不發 receipt，保留草稿並進入恢復狀態。

專案目前沒有明定支援的瀏覽器矩陣或 Web Locks 最低版本。Web Locks 對遵守協定的同版本頁面提供互斥；不支援或拒絕取得 lock 時 fail closed。LocalStorage 跨 key 寫入沒有原子交易，storage event 不是鎖，也無法阻止已載入的舊版 Host／V7 分頁繼續寫入。Mock storage 測試只驗證協定分支，不證明真實瀏覽器絕對互斥。正式 App 仍使用 V7；本階段未執行正式 cutover、未建立 rollback UI、未做真實瀏覽器多分頁驗證。B2c 需提供人工恢復／重試與 archive 操作，B3／B4 需完成 App 接入與回歸驗收。

## Phase 4D R2-B2a — Backup & preflight foundation

`cutoverBackupV8` 以嘗試 ID 建立獨立備份 key：從 V7 key 取得精確 raw、使用既有 SHA-256 helper 計算 digest、寫入後讀回完整 record 並重新驗證 raw／digest／metadata，只有確認成功才回傳 receipt。空白來源儲存 `empty` marker，不建立虛假的 V7 raw backup。任何失敗回傳結構化 code；備份模組不寫入 V7 或 V8 key，也不覆寫既有備份。

Rollback archive 僅定義含 V8 原始 raw、digest、原 activation backup ID 與 `read-only` 恢復狀態的驗證契約；本階段不建立 archive 或執行 rollback。

`cutoverPreflightV8` 是獨立的唯讀 API，使用既有 R1 migration、reconciliation 與 V8 validator；回傳候選文件、source identity、blocking／review issue，並檢查既有 V8、activation 與來源變更。外部備份確認契約分開記錄匯出已準備與使用者已確認，且綁定來源 digest。V7 activation guard 目前僅為檢查契約，未接入正式 runtime。

LocalStorage 不提供跨 key 原子交易，備份與 preflight 的最後一次讀取之後仍可能發生其他分頁寫入；B2b 已加入重新驗證與 Web Lock 協定，但無法約束不遵守協定的舊頁面。

## Phase 4D R2-A — V8 Runtime Host foundation

`useAppDataV8` 直接組合既有 `loadAppDataV8`、完整 V8 validator 與 `persistAppDataV8` CAS，不重用會自動持久化 migration 的通用 storage hook。R2-A 原先允許任何有效既有 V8 寫入；R2-B2b 已收緊為上方的 V2 active gate。空白 V8 與通過 R1 preflight／reconciliation 的 V7 candidate 都維持唯讀。

Host 以原始 V8 raw、首次載入時的 V7 raw guard 與本頁 persistence revision 作為寫入 expectation。寫入前驗證 current／next 與 safe update，寫入後讀回完全相同的 raw 才增加 revision 並發出 receipt。失敗時保留本頁 draft；V8 storage event 可在無 draft 時同步，或在有 draft 時進入 conflict 並允許明確採用外部 V8。V7 guard 改變只會阻擋後續 V8 寫入，不會把新 V7 snapshot 改成 baseline，也不提供強制覆蓋入口。

Activation metadata 使用獨立 key 與版本化契約，保存 `sha256` V7 fingerprint、固定 V7 key、V8 activation revision、UTC activation timestamp 與 activation status。R2-A 只驗證及讀取既有 metadata，不建立或更新，因此 mount 不會以當下 V7 raw 重設 fingerprint。

## Phase 4D A2 — V8 Event ownership repair foundation

`eventRepairV8` 提供純資料操作：列出 unresolved Event 與可用的 Project、TeachingUnit、Timetable 候選，並只在使用者明確指定完整 scope 後將單一 Event 原子轉為 resolved。既有且有效的 Project／TeachingUnit 不可在修復時改派；缺失引用可由使用者明確重選。操作保留原 Event ID 與全部內容、拒絕跨 Project Timetable，並以完整 V8 validator 與 safe-update guard 驗證候選文件。

Timetable 在現行 schema 中屬於 Project，沒有直接的 TeachingUnit 外鍵，因此新增或刪除 Timetable 會影響該 Project 內所有 unresolved Event 的候選集合。`eventTopologyV8` 在 topology 改變後重新計算 unresolved candidate snapshot，但不自動 resolved。當唯一候選因 topology 變更而出現時，使用 `requires-confirmation` reason 保持 unresolved，直到使用者確認。刪除仍擁有 resolved Event、Lesson、Override、OneOffLesson 或 TeachingProgress 的 Timetable 會被阻擋，Event 不會搬移或刪除。

`EventRepairManagerV8` 是未掛入正式 App 的獨立元件。它使用 V8-only receipt session 提交完整候選文件，不直接存取 LocalStorage；只有 storage revision 前進且文件符合預期時才顯示成功並移除待確認項目。寫入失敗、跨分頁衝突或 stale data 會保留使用者選擇與待確認 Event。

## Phase 4D R1 — V7→V8 migration safety and preflight

V7→V8 遷移在建立候選 V8 文件前先執行唯讀 `preflightV7ToV8`。報告以 `blocking`、`review`、`informational` 分級，包含 Project／TeachingUnit／Subject 與課程資料量、預期的 Project-scoped Subject 數量、normalized Subject 衝突、replacement Override 歸屬缺口，以及 Event unresolved 原因統計。零 Project 但仍有全域 Subject 時屬 blocking：系統不建立 Project、不猜測歸屬，也不產生可持久化的 V8 文件。Event ownership 無法判定則屬 review，Event 仍完整遷移為 unresolved。

遷移候選完成後，`reconcileV7ToV8` 在任何 storage 寫入前核對 collection 數量與 ID、每個 Project 的 Subject mapping、Lesson／OneOffLesson／replacement Override 引用、Event 原始內容及推導出的 TeachingUnitSubject relation。只有 V8 validator 與 reconciliation 都通過，load 結果才允許沿用既有 CAS 持久化流程；失敗結果保留結構化 preflight／reconciliation issue、原始 V7 raw backup，且不寫入 V8 key。有效的既有 V8 文件仍優先載入，不會被 V7 migration 覆蓋。

## Phase 4D S1-A — TeachingUnit–Subject configuration foundation

`AppDataV8` 使用 Project-scoped `SubjectV8` catalog，並以必要的 `TeachingUnitSubject` collection 表示科目已配置至哪個 TeachingUnit。relation 保存獨立 ID、Project、TeachingUnit 與 Subject；同一 Project + TeachingUnit + Subject pair 必須唯一，三者 scope 與 `applicableSchoolLevels` 必須一致。Lesson、replacement Override、OneOffLesson 與 TeachingProgress 的 Subject 引用都必須有相符 relation。

V7 → V8 遷移保留既有 Subject ID mapping 與所有課程引用，並將每個舊科目配置到同 Project 中所有學制相符的 TeachingUnit，不依名稱合併，也不選第一個 TeachingUnit。缺少 `teachingUnitSubjects` 的既有 V8 文件使用相同確定性規則在記憶體升級；collection 已存在但內容無效時由 validator 拒絕，不自動修補或覆寫。Project copy 會重新映射 Project、TeachingUnit、Subject 與 relation ID；一般新建 Project 保持空白。

本階段只提供 V8 migration、validator、selector、CRUD 與 Project lifecycle 資料層；正式 V7 Runtime、storage key 與 UI 維持不變。

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
