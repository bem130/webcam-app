# Camera Clipboard V2 開発計画

| 項目           | 内容                                   |
| -------------- | -------------------------------------- |
| 文書状態       | V2実装計画                             |
| Version        | 2.0                                    |
| 更新日         | 2026-08-28                             |
| 対象branch     | `main`                                 |
| Production URL | `https://bem130.github.io/webcam-app/` |

## 1. 目的と優先順位

現在のcamera / Clipboard / in-memory historyとprivacy contractを維持しながら、次の順序でV2を実装する。

| Phase | 内容                                                            | 状態             |
| ----: | --------------------------------------------------------------- | ---------------- |
|     1 | PWA installation                                                | 完了 (`4d2ef2b`) |
|     2 | Full-resolution video-frame capture + resolution display        | 完了 (`14339ac`) |
|   2.5 | Architecture and repository verification gates                  | 未着手           |
|     3 | Native still capture via `ImageCapture` progressive enhancement | 未着手           |
|     4 | Idle timeout core + hard camera suspend                         | 未着手           |
|     5 | Screensaver + interaction-based resume                          | 未着手           |
|     6 | Preferences (`10s` … `10m` / `off`)                             | 未着手           |
|     7 | Acceptance automation + high-resolution memory hardening        | 未着手           |
|     8 | Documentation + release hardening                               | 未着手           |

各phaseは単独でbuild・test・deploy可能な状態で完了させる。複数phaseを一つのcommitへまとめず、phaseごとに実装、検証、diff review、commit、pushを行う。Phase 3の`ImageCapture`が利用できない環境でも、Phase 2のvideo-frame captureだけで完全に利用可能な状態を保つ。

V2開発完了までは、本書をV2変更事項のnormative specificationとする。`docs/design.md`または既存実装と競合する場合は本書を優先し、各phaseで該当する`design.md` contractもincrementalに同期する。

## 2. V2全体の設計契約

### 2.1 Privacyと永続化

- 撮影画像は現在のdocumentのmemoryと、user操作で書き込むsystem Clipboard以外へ保存しない。
- camera frame、`Blob`、Object URL、thumbnail、device label / IDをnetwork、Cache Storage、IndexedDB、filesystem、`localStorage`へ書き込まない。
- Service Workerを導入せず、meta CSPの`connect-src 'none'`を維持する。
- microphoneを要求せず、camera constraintsでは常に`audio: false`を維持する。
- 永続化を許可するのはversion付きの非画像preferenceである`idleTimeout`だけとし、`src/platform/preferences.ts`以外からWeb Storageへアクセスしない。
- preferences portの型は画像、`Blob`、`CaptureEntry`を受け取れない形に限定する。

### 2.2 Capture qualityとfallback

最高品質routeとfallbackを分離する。

```text
ImageCapture対応・photo capability取得成功
  -> maximum still dimensionsを要求してtakePhoto()
  -> PNGへ変換

ImageCapture非対応・capability取得失敗・takePhoto失敗
  -> 最大化したvideo streamのcurrent frame
  -> PNGへ変換
```

`takePhoto()`はoptional progressive enhancementであり、camera開始、camera切替、video-frame captureを阻害してはならない。Clipboard writeは既存のWebKit user activation contractを維持し、最初の`await`より前にPNG Promiseを入れた`ClipboardItem`を書込み始める。

### 2.3 CaptureとClipboardの独立lifecycle

captureとcopyは同じuser actionから開始するが、開始後のlifecycleは独立させる。

```text
shutter
  ├─ ClipboardItem(Promise<PNG>)を同期的にwrite開始
  │    └─ Clipboard success / failure transition
  │
  └─ camera source acquisition -> PNG encode
       ├─ encode成功直後にhistory追加
       ├─ thumbnail生成
       └─ cameraはidle / background hard stop可能
```

- PNG encode成功後のhistory追加とcamera resource releaseはClipboard settlementを待たない。
- Clipboard success / failureはencode / historyと独立したstate transitionとして処理する。
- idle inhibitionはcamera source acquisition、still decode、PNG encode、camera switchの間だけ有効にする。
- Clipboard write結果待ち、history追加後のUI feedback、thumbnail完成待ちはcameraを保持する理由にしない。
- capture source / PNG encode失敗時はhistoryを追加せず、Clipboard側のfailure feedbackでcapture errorを上書きしない。

### 2.4 解像度表示

UIでは実測値とcapabilityを混同しない。

- `MediaStreamTrack.getSettings()`由来の実際のpreview width、height、frame rateを「プレビュー」として表示する。
- `getPhotoCapabilities()`が利用できる場合は、still photoの最大要求dimensionsを「撮影」として別表示する。
- `ImageCapture`非対応時は「プレビュー / 撮影」として同じvideo-frame dimensionsを表示する。
- history entryには常に実際に生成したPNGのpixel dimensionsを表示する。
- camera切替、idle復帰、track settings変更後に表示を更新する。

### 2.5 Idle / background invariant

- 初期timeoutは`10s`とし、選択肢は`10s`、`30s`、`1m`、`3m`、`5m`、`10m`、`off`に限定する。
- timeout時はvideoを隠すだけでなく、全camera trackへ`stop()`を呼んでhardwareを解放する。
- camera source acquisition、still decode、PNG encode中はidle transitionを延期し、PNG settlement後にtimerを再armする。Clipboard write settlementは待たない。
- screensaverを解除する最初のinteractionはresume専用としてconsumeし、shutterや背後のcontrolを発火させない。
- `pointerdown`、`keydown`、`wheel`をactivityとして扱い、`pointermove`はtimer reset対象にしない。
- backgroundとidleのどちらでも全trackへ`stop()`を呼び、camera hardware releaseをapplication contractにする。
- backgroundとidleはresume triggerとUIが異なるためreasonを区別し、二重resumeやstale transactionを防ぐ。

## 3. Phase 1: PWA installation

### 実装済み

- `/webcam-app/` scopeのWeb App Manifestを追加した。
- 192×192 px、512×512 px、maskable、Apple touch iconを追加した。
- `display: "standalone"`とbrowser / OS標準install UIを採用した。
- installabilityに必須ではないService Workerとcustom install promptは導入していない。
- manifest、icon、production artifact、Chromium installability diagnosticsを自動testへ追加した。

### 完了commit

`4d2ef2b feat: add phase 1 PWA installation support`

Production端末での実installはPhase 8のmanual QAで最終確認する。

## 4. Phase 2: Full-resolution video-frame capture + resolution display

### 実装

- `MAX_LONG_EDGE_PX = 1920`によるcapture canvasの縮小を廃止する。
- PNGのwidth / heightを実際の`video.videoWidth` / `video.videoHeight`と一致させ、application側でupscaleもdownscaleもしない。
- browserが`MediaStreamTrack.getCapabilities()`でwidth / heightの最大値を公開する場合は、`applyConstraints()`の`ideal`値として最大capabilityをbest-effortで要求する。
- capability API未対応または`applyConstraints()`失敗時は取得済みstreamを停止させず、browserがnegotiationした解像度へfallbackする。
- initial camera、exact camera selection、quick swap、idle復帰の全経路で同じquality negotiationを適用できるadapter boundaryを作る。
- `getSettings()`からpreviewの実測width、height、frame rateを取得し、camera viewへ表示する。
- history thumbnailだけは表示効率のためlong edge 320 pxを維持する。
- frame PNG encode完了後は巨大canvasの`width` / `height`を小さい値へ戻し、backing storeを保持し続けない。

### 自動検証

- 4K / 8K、landscape / portraitのsource dimensionsがそのままoutput dimensionsになる。
- thumbnailだけが320 pxへ縮小される。
- maximum capability適用、unsupported fallback、`applyConstraints()` rejection fallbackを確認する。
- `getSettings()`の実測値が表示modelへ正しく変換され、camera切替後に更新される。
- high-resolution encode failureがtyped errorになり、壊れたhistory entryを追加しない。
- encode成功・失敗の両方でframe canvasを解放する。

### 完了条件

- application固有の1920 px ceilingがsource、test、設計文書からなくなる。
- 対応camera / browserでは利用可能な最大video resolutionをbest-effortで取得し、実際に配信されたframeを等倍でPNG化する。
- UIに実際のpreview / video-frame capture解像度とframe rateが表示される。
- 既存のClipboard user activation順序とprivacy invariantを維持する。
- `npm run verify`と`npm run test:e2e`が成功する。

### 完了commit

`14339ac feat: complete phase 2 full-resolution video capture`

## 4.5 Phase 2.5: Architecture and repository verification gates

V2のeffect surfaceを追加する前に、方針違反をCIで拒否できる構造へ移行する。

### Repository gate

- `main`をprotected branchにし、pull request経由だけで変更する。
- GitHub Actionsの`Verify` checkをstrict required status checkにする。
- administratorにもruleを適用し、force pushとbranch deletionを禁止する。
- solo repositoryのためapproving review countは0とするが、PRとgreen checkは必須にする。
- 以後のphaseは`codex/phase-N-*` branchへcommit / pushし、PRのrequired check成功後だけmergeする。

### Architecture gate

- architecture testで`src/core/**`からplatform / application / uiへのimportを禁止する。
- `src/platform/**`からapplication / uiへのimportを禁止する。
- capture、camera session、idleのimperative orchestrationを小さいcontrollerへ分割し、`App`へeffect lifecycleを追加し続けない。
- Phase 2.5ではcapture controllerとcamera session boundaryを導入し、Phase 4前にidle controllerを独立追加できる形にする。
- core actionの不存在表現を`Option`へ統一し、browser / DOM境界の`null`をcoreへ持ち込まない。

### Verification semantics

- `verify:source`をformat、lint、typecheck、unit / integration、buildのfast gateとする。
- `verify:e2e`を全browser E2E gateとする。
- `verify`は両方を実行するall gateとし、CIはbrowser install前後で同じ二つを明示実行する。
- `skipLibCheck: false`で現在のdependency setが通るか確認し、成功すればfalseを維持する。失敗時だけ具体的なdependency errorを文書化して例外とする。

### Capture lifecycle修正

- 既存`Promise.all([operation.encoded, operation.clipboard])`を廃止する。
- encode成功直後にhistoryを追加し、capture busy / idle inhibitionを解除する。
- Clipboard resultは独立observerでcopy stateとfeedbackだけを更新する。
- encode failureとClipboard failureの競合時はcapture errorを優先し、historyを作らない。

### 自動検証

- forbidden import fixtureがarchitecture testで失敗し、現行source graphは成功する。
- encode完了後、未settled Clipboardを待たずhistory追加とcapture idle解除が起きる。
- Clipboardが先にsettleしてもencode / history resultを変えない。
- core action payloadに`CameraId | null`を残さない。
- `npm run verify`がsourceとE2Eの両方を実行する。

### Commit

`refactor: enforce phase 2.5 architecture gates`

## 5. Phase 3: Native still capture via ImageCapture

### 実装

- `globalThis.ImageCapture`をcapability detectionし、存在する場合だけvideo trackからadapterを生成する。
- `getPhotoCapabilities()`の`imageWidth.max` / `imageHeight.max`をstill captureの最大要求dimensionsとして保持する。
- shutterでは`takePhoto({ imageWidth, imageHeight })`を最高品質routeとして使う。
- `takePhoto()`が返すencoded imageをdecodeし、実際のdimensionsを保ったPNGへ変換してClipboardとhistoryへ渡す。
- `ImageCapture`非対応、photo capability取得失敗、`takePhoto()`失敗、返却Blobのdecode失敗時は、trackがliveならPhase 2のvideo-frame captureへ一度fallbackする。
- fallbackも失敗した場合だけtyped capture errorを表示する。fallbackした事実は画像内容を含めずstatusとして通知してよい。
- photo capabilityがvideo settingsと異なる場合、camera viewまたはdetailsに「プレビュー」と「撮影 最大」を分けて表示する。
- photo PNG encode完了後にtemporary `ImageBitmap`をcloseし、巨大canvasを縮小してbacking storeを解放する。

### 自動検証

- supported時に`getPhotoCapabilities()`を呼び、maximum `imageWidth` / `imageHeight`を`takePhoto()`へ渡す。
- unsupported時はPhase 2のvideo-frame routeだけを使う。
- capability取得失敗と`takePhoto()`失敗ではvideo-frame routeへfallbackする。
- trackがendedならfallbackで不正なcaptureを作らずtyped errorにする。
- returned still Blobの実dimensionsをhistoryとresolution表示へ反映する。
- Clipboard write開始が最初の`await`より前である既存contractを維持する。
- still image metadataを永続化・送信せず、最終Clipboard payloadをPNGに限定する。

### 完了条件

- 対応環境ではvideo stream resolutionを超えるstill photo capabilityを利用できる。
- 非対応環境ではPhase 2と同じ完全なcapture experienceを維持する。
- `npm run verify`と`npm run test:e2e`が成功する。

### Commit

`feat: complete phase 3 native still capture`

## 6. Phase 4: Idle timeout core + hard camera suspend

### Core model

```ts
type IdleTimeout = "10s" | "30s" | "1m" | "3m" | "5m" | "10m" | "off";
type SuspensionReason = "idle" | "background";
```

Idle lifecycleは概念上、次の状態遷移を持つ。

```text
streaming -- timeout --> idleSuspended -- explicit resume --> requesting --> streaming
     |                         |
     +-- capture中は延期 ------+
```

### 実装

- default `10s`のidle timerをpure core decisionとtimer adapterに分離する。
- timeout時はcurrent camera IDを再開用に保持してから全trackを`stop()`し、stream referenceとvideo `srcObject`を解放する。
- camera source acquisition、still decode、PNG encode、camera switch中はidle suspendしない。PNG settlementを新しいactivityとしてtimerを再armし、Clipboard settlementは待たない。
- `off`ではidle timerを作成しない。
- Phase 4ではidle停止理由と「カメラを再開」actionを明示する最小UIを提供し、Phase 5でscreensaverへ拡張する。
- background / idleの両方でhard stopしつつ別reasonとして扱い、二重resumeやstale transactionを防ぐ。

### 自動検証

- fake timerで`9.999s`ではstreaming、`10.000s`で全trackの`stop()`が一度だけ呼ばれる。
- `off`では時間が経過しても停止しない。
- activityでtimerがresetされる。
- capture開始直後にtimeoutへ到達してもstopせず、operation完了後にtimerを再armする。
- idle停止とbackground suspendが互いのresumeを誤って実行しない。

### Commit

`feat: complete phase 4 idle camera suspension`

## 7. Phase 5: Screensaver + interaction-based resume

### 実装

- idle hard stop中はcamera previewとcontrolを覆うfull-viewport screensaverを表示する。
- overlay自身が`pointerdown`、`keydown`、`wheel`を受け取り、最初のinteractionをconsumeしてcamera resumeだけを開始する。
- overlay背後のshutter、history、camera selectorへ同じeventを伝播させない。
- streaming中の`pointerdown`、`keydown`、`wheel`はidle timerをresetする。`pointermove`は対象にしない。
- resume中は重複requestを防ぎ、成功、permission拒否、camera消失を既存typed stateへ接続する。
- screensaverとresume statusをscreen readerへ通知し、keyboard focusをoverlayから復帰後の適切なcontrolへ戻す。
- `prefers-reduced-motion`ではscreensaver transitionを無効化する。

### 自動検証

- screensaver上のshutter位置をtapしても撮影されず、resumeだけが一度発生する。
- `pointerdown`、`keydown`、`wheel`でresumeし、`pointermove`ではresume / timer resetしない。
- resume連打で`getUserMedia()`が重複しない。
- resume失敗時に回復可能なerror UIを表示する。
- focus、live region、reduced motion、320×568を含むviewportでoverlayが機能する。

### Commit

`feat: complete phase 5 idle screensaver`

## 8. Phase 6: Idle timeout preferences

### 実装

- camera viewから短い操作で到達できるsettings UIを追加する。
- `10s`、`30s`、`1m`、`3m`、`5m`、`10m`、`off`だけを選択可能にする。
- version付きの最小payload `{ version: 1, idleTimeout }`だけを`src/platform/preferences.ts`で`localStorage`へ保存する。
- missing、invalid、future version、JSON parse error、SecurityError / quota errorは安全なdefault `10s`へfallbackする。
- preference変更時は現在のtimerをcancelし、新しい設定で再armする。`off`選択時は稼働中cameraを停止せずauto-stopだけを無効にする。
- installed PWAとbrowser tabで同じorigin preferenceを共有し得ることを文書化する。

### Privacy test変更

source全体の`localStorage`文字列禁止を、次のarchitecture contractへ置き換える。

- Web Storage accessは`src/platform/preferences.ts`だけに許可する。
- preferences payloadは`version`と`idleTimeout`以外を持てない。
- capture / history codeからpreferences portへ`Blob`、Object URL、dimensions、device情報を渡せない。
- IndexedDB、Cache Storage、Service Worker、network、download禁止は維持する。

### 自動検証

- 全optionのround trip、valid value restore、missing / invalid / stale valueのdefault fallbackを確認する。
- storage APIがthrowしてもcamera起動を阻害しない。
- preference変更でtimerが正しく再arm / cancelされる。
- image `Blob`がpersistent preferenceへ到達するAPI surfaceを持たない。

### Commit

`feat: complete phase 6 idle preferences`

## 9. Phase 7: Acceptance automation + memory hardening

### Browser / accessibility

- 320×568、390×844、768×1024、1280×800のrequired viewportをbrowser testへ固定する。
- keyboard focus、Escape、reduced motion、forced colorsの主要contractを自動化する。
- Chromiumでは実際のClipboard APIへPNGを書き、同じbrowser contextでread-backする。
- test用fake camera / Clipboard以外のnetwork requestや画像persistent storageが増えていないことを再確認する。

### Resolution / ImageCapture

- 4K source、portrait 4K、video settings表示、still capability表示をcontract testへ固定する。
- `ImageCapture` supported / unsupported / capability failure / `takePhoto()` failureを全て確認する。
- actual photo dimensionsとhistory dimensionsが一致する。

### Idle / preferences

- timeout全境界、`off`、activity reset、screensaver resume-only、capture中のdeferred suspendをbrowser testへ追加する。
- valid / invalid preference restoreとprivacy boundaryを確認する。

### Memory hardening

- 48MP相当のRGBA backing storeが約195MBになり得る前提で、同時に保持するdecoded image / canvasを一つに制限する。
- frame / photo encodeの全success / failure pathで`ImageBitmap.close()`とcanvas縮小が行われることをtestする。
- consecutive high-resolution captureで前回canvas dimensionsを保持しない。
- transient allocation failureをtyped errorへ写像し、camera streamと既存historyを壊さない。
- 履歴Blob合計の既存warningと、capture瞬間のtransient memory対策を別のcontractとして扱う。

### Commit

`test: complete phase 7 V2 acceptance hardening`

## 10. Phase 8: Documentation + release hardening

### 実施内容

- README、`docs/design.md`、manual QAを実装結果に合わせて更新する。
- 「preview stream最大化」と「native still最大要求」、実測 / capability表示、browser fallbackを区別して記載する。
- idle timeout、hard stop、screensaver resume、preference storage、installed PWAでの挙動を文書化する。
- clean installからformat、lint、typecheck、unit / integration、production build、全browser E2Eを実行する。
- production artifactについてmanifest、icon、CSP、base path、bundle size、secret、大容量fileを確認する。
- GitHub Actions成功後、production URLでPWA install、camera indicator消灯、idle resume、解像度表示、actual image pasteを対象実機で確認する。

### 完了条件

- CI/CDとproduction smoke testが成功し、未実施の実機項目が結果とともに明記される。
- Chromium / Androidの`ImageCapture` routeと、Safari / Firefoxのvideo-frame fallbackを対象実機で確認する。
- worktreeがcleanで、local `HEAD`と`origin/main`が一致する。

### Commit

文書・検証修正が必要な場合のみ、`docs: complete phase 8 V2 release hardening`とする。変更がなければ空commitは作らない。

## 11. Commit / push運用

各phaseで次の順序を守る。

1. phase対象だけを変更する。
2. UTF-8、format、lint、TypeScript、unit / integration test、production buildを確認する。
3. browser挙動を変更したphaseではPlaywright E2Eも確認する。
4. `git diff --check`とstaged diffをreviewし、secretと意図しない大容量fileを確認する。
5. phase専用commitを作成する。
6. `origin/main`へpushし、次のphaseへ進む。

push前にremoteが進んでいた場合は、remote差分を確認してからnon-destructiveに統合する。既存CI/CD workflowを各機能の都合だけで変更しない。

## 12. 仕様根拠

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [W3C: Web Application Manifest](https://www.w3.org/TR/appmanifest/)
- [W3C: Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [W3C: MediaStream Image Capture](https://www.w3.org/TR/image-capture/)
- [MDN: ImageCapture](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture)
- [MDN: ImageCapture.getPhotoCapabilities()](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/getPhotoCapabilities)
- [MDN: ImageCapture.takePhoto()](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto)
- [WHATWG HTML: Web storage](https://html.spec.whatwg.org/multipage/webstorage.html)
