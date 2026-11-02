# SK2 作品集

網址：https://steking1207.github.io/portfolio/

純 HTML／CSS／JavaScript，沒有建置步驟，直接由 GitHub Pages 提供。所有作品內容都在 `data/works.json`，網站載入時讀取它來產生畫面。

## 新增、編輯、刪除、下架作品

打開 **https://steking1207.github.io/portfolio/admin/**（後台不會出現在網站選單上）。

1. **登入**：後台有保護，必須貼上對這個 repo 有寫入權限的 GitHub 權杖才進得去，其他人打開只會看到登入畫面。
   - 到 [Fine-grained personal access tokens](https://github.com/settings/personal-access-tokens/new) 建立
   - Repository access：只選 `portfolio`
   - Repository permissions → **Contents：Read and write**
   - 預設關掉瀏覽器就登出；勾「記住這台電腦」才會保留。權杖只存在你的瀏覽器，不會進 repo
2. **新增**：「＋ 新增作品」→ 填標題、年份、分類 → 把截圖拖進「圖片」。第一張是封面，可拖曳排序。圖片會自動縮成網頁尺寸（WebP，最寬 2000px）並產生縮圖。每張圖可在縮圖下方選外框：瀏覽器框／手機框／無外框（上傳時會先自動猜一個）。
3. **編輯**：點左側作品直接改。
4. **下架**：勾「下架（不在網站顯示）」，資料與圖片都保留。
5. **刪除**：作品頁最下方「刪除這件作品」，發佈時一併刪除圖片檔。
6. **精選**：勾「放在首頁精選」並設定順序。
7. 按 **預覽** 可先在新分頁看效果，確認後按 **發佈到 GitHub**。所有變更會合成一次 commit，GitHub Pages 約 1 分鐘後更新。

也可以按「下載 works.json」，自己覆蓋 `data/works.json` 再 commit。

## 深淺色

- 網站預設：後台「網站資訊」→「網站預設顯示」選 跟隨系統／淺色／深色（存在 `site.theme`）
- 訪客：右上角按鈕依序切換 跟隨系統 → 淺色 → 深色，會記在訪客自己的瀏覽器
- 後台本身：右上角 ☀ ☾ ◐ 切換

## 線上狀態標示

| status | 顯示 | 何時用 |
| --- | --- | --- |
| `live` | 上線中 ↗ | 網站還在，而且仍是這個設計（需填 `url`） |
| `redesigned` | 已改版 ↗ | 網站還在，但設計已換（需填 `url`） |
| 空字串 | 不顯示 | 已下線，或 APP、平面等沒有網址的作品 |

`demo` 是自己架設的可操作版本，會另外顯示「線上 Demo ↗」。

## 資料格式

```jsonc
{
  "site": { "name": "SK2", "title": "…", "intro": "…", "statement": "…", "email": "", "links": [{ "label": "GitHub", "url": "…" }] },
  "categories": [{ "id": "corporate", "name": "企業品牌官網", "en": "Corporate", "desc": "…" }],
  "featured": ["2016-ego", "2018-bt-air"],          // 首頁精選，依序
  "works": [{
    "id": "2012-cht",                                // 網址代號，小寫英數與 -
    "title": "中華電信", "subtitle": "自適應官網",
    "year": 2012, "category": "corporate",
    "roles": ["前端開發"], "tags": ["RWD"],
    "status": "redesigned", "url": "https://www.cht.com.tw/", "demo": "",
    "summary": "",
    "images": [{ "src": "images/works/2012-cht/01.webp", "w": 920, "h": 672 }],  // 縮圖自動找 01-t.webp
    "hidden": false
  }]
}
```

## 檔案結構

```
index.html            網站
assets/css/site.css   樣式（色彩、字級等設計變數在檔案開頭）
assets/js/app.js      互動與畫面產生
data/works.json       作品資料
images/works/<id>/    各作品圖片（NN.webp 原圖、NN-t.webp 縮圖）
admin/                後台
```

本機預覽：在 repo 根目錄執行 `python3 -m http.server`，開 http://localhost:8000/。
