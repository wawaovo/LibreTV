# LibreTV 個人客製功能：v2.21.2 升級紀錄

這個分支使用 **LibreSpark/LibreTV v2.21.2** 作為基礎。原本部署在 Cloudflare Pages 的舊版 `main` 不會被改動。

## 已移植

- **首頁推薦**：使用新版原生的豆瓣／Bangumi／影視熱榜元件。點擊推薦卡片會自動搜尋，並在已配置且可用時啟用名稱為「豆瓣資源」或 key 為 `dbzy` 的影音來源。若沒有該來源，不會私自新增來源。
- **搜尋**：保留新版內建的流式搜尋、多來源聚合、關鍵字相關性過濾與來源健康度機制。舊版搜尋到大量無關影片的情況由新版相關性過濾處理。
- **海報**：先使用新版 SmartImage 原圖／鏡像／內建代理備援；全部失敗或沒有原圖時，呼叫本站 `/api/poster` 向 TMDB 補圖。只接受符合搜尋片名的海報，否則顯示新版占位圖。
- **原本影音來源**：`legacy-sources.json` 是從原本 `js/config.js` 保存的來源名單。資料可能失效、變更或涉及第三方權利，**不會自動啟用**；請使用者自行確認可用性與使用權後，再透過「設定 → 來源管理 → 資料源訂閱」匯入。
- **手機版**：保留點擊推薦後捲動至頁首的操作。

## 新版首次設定

1. 應先在伺服器安全設定 `PASSWORD`；若需 TMDB 海報備援，可另外設定 `TMDB_API_KEY`（v3 API Key）。**不要把 API Key 提交到 GitHub，也不要使用 `NEXT_PUBLIC_` 前綴**。
2. 如要恢復舊版來源，匯入此分支的原始 JSON 連結：`https://raw.githubusercontent.com/wawaovo/LibreTV/upgrade-v2-21-2-custom/legacy-sources.json`。需審查及勾選要使用的來源。
3. 如果要預設顯示豆瓣推薦，可設定 `DEFAULT_RECOMMEND_SOURCE=douban`。如果圖片直接連線失敗，可以用 `DEFAULT_IMAGE_MODE=proxy`。
4. 測試片名搜尋（包含找不到結果的片名）、推薦卡片、自訂來源、圖片失敗備援、手機版和播放流程後，才能考慮部署正式站。

## 部署與安全警告

- **不可將本分支直接拿去覆蓋現有 Cloudflare Pages 靜態網站**。新版有 Next.js Node.js API，需部署到支援對應 Next.js Server Runtime 的環境（例如原作者支援的 Docker / Node standalone），或者另外驗證 Cloudflare Workers 相容轉接與建置。尚未測試成功前，不應變更正式站的 Pages 配置。
- 原本的 `main/js/douban.js` 曾直接寫入 TMDB API Key，建議在 TMDB 控制台**撤銷/重生該金鑰**。這個新分支不會將金鑰重新提交。
- 新版資料存於不同的瀏覽器狀態結構；自訂設定／來源不會自動由舊版遷移。請先備份舊站設定並確認匯入名單。
- 搜尋和推薦不保證某影片在第三方來源上真的可播放，實際可用性仍需測試。

## 測試狀態

已完成程式碼初步移植。**尚未通過正式建置與端到端播放測試**；部署前須執行 `npm ci`、`npm run build`、`npm test`（若腳本存在），並驗證瀏覽器互動及外部 API 連線。
