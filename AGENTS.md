# Toki project rules

- 使用繁體中文（臺灣）溝通；程式碼、識別字與指令使用英文。
- App 品牌固定為 `Toki`；使用者的課表專案名稱是獨立資料，不得寫死為品牌或預設名稱。
- 延續 Japanese Architectural Minimalism 與既有設計 token；不得加入問候語。
- 依 `docs/product-spec.md`、`docs/architecture.md` 與 `docs/roadmap.md` 的階段範圍開發，避免提前實作後續 Phase。
- 保護既有使用者資料與向下相容性。LocalStorage schema 升級使用新 key，舊 key 保留且不得自動覆寫或刪除。
- 優先採用小範圍、可審查的修改；避免無關重構與非必要依賴。
- 變更資料模型或 migration 時必須補足 validator 與自動測試，並執行 `npm run test`、`npm run lint`、`npm run build`。
- 未經使用者明確授權，不得 Commit、Push、Merge、建立 Release 或部署。
