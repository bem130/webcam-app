# Camera Clipboard 開発計画

| 項目           | 内容                                   |
| -------------- | -------------------------------------- |
| 文書状態       | 実装計画                               |
| 作成日         | 2026-08-28                             |
| 対象branch     | `main`                                 |
| Production URL | `https://bem130.github.io/webcam-app/` |

## 1. 目的と優先順位

現在のcamera / Clipboard / in-memory historyとprivacy contractを維持しながら、次の順序で機能と検証を追加する。

1. PWA install対応
2. 撮影画像の解像度上限撤廃
3. 未自動化のacceptance項目の補強
4. release hardeningとproduction確認

各phaseは単独でbuild・test・deploy可能な状態で完了させる。複数phaseを一つのcommitへまとめず、phaseごとに実装、検証、diff review、commit、pushを行う。作業開始時点の`stash@{0}`は明示的な指示がない限り復元・削除しない。

## 2. 守る設計契約

- 撮影画像は現在のdocumentのmemoryと、user操作で書き込むsystem Clipboard以外へ保存しない。
- camera frameをnetwork、Cache Storage、IndexedDB、`localStorage`、filesystemへ書き込まない。
- microphoneを要求せず、camera constraintsでは常に`audio: false`を維持する。
- GitHub Pagesのproject path `/webcam-app/`とmeta CSPの`connect-src 'none'`を維持する。
- custom install promptや特定browserだけのAPIを必須経路にせず、standard manifestとbrowser / OSのinstall UIを基本経路にする。
- high-resolution captureでmemory使用量とPNG encode時間が増えることをerror handling、test、manual QAへ反映する。

## 3. Phase 1: PWA install

### 実装

- Web App Manifestを追加し、`name` / `short_name`、`id`、`start_url`、`scope`、`display: "standalone"`、theme/background colorを定義する。
- Chromium系browserのinstallability要件を満たす192×192 pxと512×512 pxのPNG iconを追加する。
- maskable iconは重要部分を仕様上のsafe zone内へ置く。Apple端末向けに180×180 pxのtouch iconも用意する。
- `index.html`からmanifestとiconを参照し、すべてのURLをViteの`/webcam-app/` baseと整合させる。
- READMEとmanual QAへ、Chromium / Android、iOS / iPadOS、macOS Safariのinstall手順と確認項目を追加する。
- app shellのoffline対応を目的とするService Workerは導入しない。installabilityには必須ではなく、現時点のscopeはinstall対応であってoffline対応ではないためである。撮影画像をService Worker cacheへ保存しない既存契約も維持する。

### 自動検証

- manifestの必須member、scope、icon size / MIME / purposeをintegration testで検証する。
- production buildにmanifestと全iconが含まれ、HTMLから`/webcam-app/`配下で参照されることをbuild verifierで検証する。
- Service Worker登録とpersistent image storageが追加されていないことをprivacy testで維持する。

### 完了条件

- HTTPSのproduction URLでbrowser / OS標準UIからinstallできる。
- installed appがstandalone表示で`/webcam-app/`から起動する。
- install後もcamera、Clipboard、reload時の履歴消去が通常のbrowser表示と同じ契約で動作する。
- `npm run verify`と`npm run test:e2e`が成功する。

### Commit

`feat: add phase 1 PWA installation support`

## 4. Phase 2: 撮影解像度上限の撤廃

### 実装

- `MAX_LONG_EDGE_PX = 1920`によるcapture canvasの縮小を廃止する。
- PNGのwidth / heightを実際の`video.videoWidth` / `video.videoHeight`と一致させ、application側でupscaleもdownscaleもしない。
- browserが`MediaStreamTrack.getCapabilities()`でwidth / heightの最大値を公開する場合は、`applyConstraints()`の`ideal`値として最大capabilityをbest-effortで要求する。未対応または適用不能な場合は取得済みstreamを停止させず、browserがnegotiationした解像度へfallbackする。
- camera選択・切替のどちらでも同じquality negotiationを適用する。
- history thumbnailだけは表示効率のためlong edge 320 pxを維持する。これはClipboardへ書くoriginal PNGの解像度制限ではない。

### 自動検証

- landscape / portraitの4K以上のsource dimensionsがそのままoutput dimensionsになるunit testを追加する。
- thumbnailだけが320 pxへ縮小される境界を分離してtestする。
- maximum capability適用、unsupported fallback、`applyConstraints()`失敗時fallbackをadapter testで確認する。
- high-resolution encode failureがtyped errorになり、壊れたhistory entryを追加しないことを確認する。

### 完了条件

- application固有の1920 px ceilingがsource、test、design文書からなくなる。
- 対応camera / browserでは利用可能な最大解像度をbest-effortで取得し、実際に配信されたframeを等倍でPNG化する。
- 既存のClipboard user activation順序とprivacy invariantを維持する。
- `npm run verify`と`npm run test:e2e`が成功する。

### Commit

`feat: remove phase 2 capture resolution limit`

## 5. Phase 3: Acceptance自動化

### 実装と検証

- 320×568、390×844、768×1024、1280×800のrequired viewportをbrowser testへ固定する。
- keyboard focus、Escape、reduced motion、forced colorsの主要contractを自動化する。
- Chromiumでは実際のClipboard APIへPNGを書き、同じbrowser contextでread-backできることを確認する。OSの別appへのpasteはmanual QAとして残す。
- test用fake camera / Clipboard以外のnetwork requestやpersistent storageが増えていないことを再確認する。

### 完了条件

- 自動化可能なacceptance項目がCIで再現可能になり、実機でしか確認できない項目がmanual QAに明確に分離される。
- `npm run verify`と全engineの`npm run test:e2e`が成功する。

### Commit

`test: complete phase 3 acceptance automation`

## 6. Phase 4: Release hardening

### 実施内容

- README、`docs/design.md`、manual QAを実装結果に合わせて更新し、PWA installとfull-resolution captureのsupport boundaryを明記する。
- clean installからformat、lint、typecheck、unit / integration、production build、browser E2Eを実行する。
- production artifactについてmanifest、icon、CSP、base path、bundle size、secret、大容量fileを確認する。
- phase commitをpushし、GitHub Actions成功後にproduction URLでmanifest取得、icon表示、install、camera、actual pasteを実機確認する。

### 完了条件

- CI/CDとproduction smoke testが成功し、未実施の実機項目が結果とともに明記される。
- worktreeがcleanで、local `HEAD`と`origin/main`が一致する。

### Commit

文書・検証修正が必要な場合のみ、`docs: complete phase 4 release hardening`とする。変更がなければ空commitは作らない。

## 7. Commit / push運用

各phaseで次の順序を守る。

1. phase対象だけを変更する。
2. UTF-8、format、lint、TypeScript、unit / integration test、production buildを確認する。
3. browser挙動を変更したphaseではPlaywright E2Eも確認する。
4. `git diff --check`とstaged diffをreviewし、secretと意図しない大容量fileを確認する。
5. phase専用commitを作成する。
6. `origin/main`へpushし、次のphaseへ進む。

push前にremoteが進んでいた場合は、remote差分を確認してからnon-destructiveに統合する。既存CI/CD workflowをPWA実装の都合だけで変更しない。

## 8. 仕様根拠

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [W3C: Web Application Manifest](https://www.w3.org/TR/appmanifest/)
- [Apple Support: Turn a website into an app in Safari on Mac](https://support.apple.com/guide/safari/add-to-dock-ibrw9e991864/mac)
- [W3C: Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
