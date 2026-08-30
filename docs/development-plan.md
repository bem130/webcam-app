# Camera Clipboard V2 開発計画

| 項目           | 内容                                   |
| -------------- | -------------------------------------- |
| 文書状態       | V2実装計画・Phase 8実機QA待ち          |
| Version        | 2.2                                    |
| 更新日         | 2026-08-30                             |
| 対象branch     | `main`                                 |
| Production URL | `https://bem130.github.io/webcam-app/` |

## 1. 目的と優先順位

現在のcamera / Clipboard / in-memory historyとprivacy contractを維持しながら、次の順序でV2を実装する。

| Phase | 内容                                                            | 状態                     |
| ----: | --------------------------------------------------------------- | ------------------------ |
|     1 | PWA installation                                                | 完了 (`4d2ef2b`)         |
|     2 | Full-resolution video-frame capture + resolution display        | 完了 (`14339ac`)         |
|   2.5 | Architecture and repository verification gates                  | 完了 (`ac16b78`)         |
|     3 | Native still capture via `ImageCapture` progressive enhancement | 完了 (`8b0a83a`)         |
|   3.5 | Capture pipeline measurement and worker optimization            | 完了 (`a163a8d`)         |
|   3.6 | Video-frame measurement and Worker optimization                 | 完了 (`9706e83`)         |
|     4 | Idle timeout core + hard camera suspend                         | 完了 (`b228df4`)         |
|     5 | Screensaver + interaction-based resume                          | 完了 (`b801ff5`)         |
|     6 | Preferences (idle timeout + capture mode)                       | 完了 (`93edea5`)         |
|     7 | Acceptance automation + high-resolution memory hardening        | 完了 (`a8b3e6e`)         |
|     8 | Documentation + release hardening                               | 自動検証完了・実機QA待ち |

各phaseは単独でbuild・test・deploy可能な状態で完了させる。複数phaseを一つのcommitへまとめず、phaseごとに実装、検証、diff review、commit、pushを行う。Phase 3の`ImageCapture`が利用できない環境でも、Phase 2のvideo-frame captureだけで完全に利用可能な状態を保つ。Phase 3.5と3.6は実機で顕在化したcapture / Clipboard latencyをPhase 4より先に扱い、Phase 4以降のidle lifecycleへ重い画像処理を持ち越さない。

V2開発完了までは、本書をV2変更事項のnormative specificationとする。`docs/design.md`または既存実装と競合する場合は本書を優先し、各phaseで該当する`design.md` contractもincrementalに同期する。

## 2. V2全体の設計契約

### 2.1 Privacyと永続化

- 撮影画像は現在のdocumentのmemoryと、user操作で書き込むsystem Clipboard以外へ保存しない。
- camera frame、`Blob`、Object URL、thumbnail、device label / IDをnetwork、Cache Storage、IndexedDB、filesystem、`localStorage`へ書き込まない。
- Service Workerを導入せず、meta CSPの`connect-src 'none'`を維持する。
- microphoneを要求せず、camera constraintsでは常に`audio: false`を維持する。
- 永続化を許可するのはversion付きの非画像preferenceである`idleTimeout`と`capturePreference`だけとし、`src/platform/preferences.ts`以外からWeb Storageへアクセスしない。
- preferences portの型は画像、`Blob`、`CaptureEntry`を受け取れない形に限定する。

### 2.2 Capture qualityとfallback

ユーザーが選ぶpreference、実際に使用したroute、生成された画像形式を分離する。

```ts
type CapturePreference = "photoPreferred" | "videoFrame";

type CaptureRoute = "photo" | "videoFrame";

type ImageMimeType = `image/${string}`;

type CapturedImage = {
  readonly blob: Blob;
  readonly mimeType: ImageMimeType;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly route: CaptureRoute;
};
```

```text
preference = photoPreferred
かつ ImageCapture対応・photo capability取得成功
  -> maximum still dimensionsを要求してtakePhoto()
  -> native encoded BlobをCapturedImageとして保持

preference = videoFrame
または ImageCapture非対応・capability取得失敗・takePhoto失敗
  -> 最大化したvideo streamのcurrent frame
  -> PNGへ変換
```

`takePhoto()`はoptional progressive enhancementであり、camera開始、camera切替、video-frame captureを阻害してはならない。`photoPreferred`はphoto routeの成功を保証する名前ではなく、capability取得または`takePhoto()`自体の失敗時に`videoFrame`へfallbackするpreferenceである。actual routeは各history entryへ保持し、configured preferenceと混同しない。

capture artifactとClipboard representationも分離する。`takePhoto()`が返したnative encoded Blobはhistoryでは再encodeせず保持する。一方、Clipboard APIでportableな画像writeとして保証される形式は`image/png`であり、`takePhoto()`の返却MIMEは非同期に初めて確定するため、Phase 3の互換経路は最初の`await`より前に`image/png`のPromiseを入れた`ClipboardItem`を書込み始める。native MIMEを直接Clipboardへ書く最適化は、shutter時点でMIMEを安全に確定でき、`ClipboardItem.supports(mimeType)`と実writeの両方を満たせる実装に限る。標準APIだけで事前確定できない環境では推測したMIME keyを使わない。

### 2.3 CaptureとClipboardの独立lifecycle

captureとcopyは同じuser actionから開始するが、開始後のlifecycleは独立させる。

```text
shutter
  ├─ ClipboardItem(Promise<compatible representation>)を同期的にwrite開始
  │    └─ Clipboard success / failure transition
  │
  └─ camera source acquisition -> CapturedImage
       ├─ artifact完成直後にhistory追加
       ├─ thumbnail生成
       ├─ 必要な場合だけClipboard用PNG互換変換
       └─ cameraはidle / background hard stop可能
```

- capture artifact完成後のhistory追加とcamera resource releaseはthumbnail、Clipboard変換、Clipboard settlementを待たない。
- Clipboard success / failureはcapture / historyと独立したstate transitionとして処理する。
- idle inhibitionはcamera source acquisition、video-frame PNG encode、camera switchの間だけ有効にする。native still Blob取得後のthumbnail生成、Clipboard用互換変換、Clipboard settlementはcameraを保持する理由にしない。
- Clipboard write結果待ち、history追加後のUI feedback、thumbnail完成待ちはcameraを保持する理由にしない。
- capture source / artifact生成失敗時はhistoryを追加せず、Clipboard側のfailure feedbackでcapture errorを上書きしない。historyへnative artifactを追加できた後にClipboard互換変換だけが失敗しても、撮影成功を取り消さない。

### 2.4 解像度表示

UIでは実測値とcapabilityを混同しない。

- `MediaStreamTrack.getSettings()`由来の実際のpreview width、height、frame rateを「プレビュー」として表示する。
- `getPhotoCapabilities()`が利用できる場合は、still photoの最大要求dimensionsを「撮影」として別表示する。
- `ImageCapture`非対応時は「プレビュー / 撮影」として同じvideo-frame dimensionsを表示する。
- history entryには実際の`CapturedImage`のpixel dimensions、MIME、actual routeを保持する。通常UIではfallbackを静かに扱い、details / debugでrouteを確認可能にする。
- camera切替、idle復帰、track settings変更後に表示を更新する。

### 2.5 Idle / background invariant

- 初期timeoutは`10s`とし、選択肢は`10s`、`30s`、`1m`、`3m`、`5m`、`10m`、`off`に限定する。
- timeout時はvideoを隠すだけでなく、全camera trackへ`stop()`を呼んでhardwareを解放する。
- camera source acquisition、video-frame PNG encode中はidle transitionを延期し、capture artifact settlement後にtimerを再armする。native still Blob取得後のdecode / thumbnail / Clipboard互換変換とClipboard settlementは待たない。
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

### UI stacking gate

- 通常UI、app overlay、`showModal()`によるtop layer modalを別のstacking planeとして扱う。
- 同一stacking contextで表現できる上下関係はcamera viewまたは`AppOverlayPlane`のDOM/render順をsource of truthにする。
- DOM順で不足する場合だけsemantic ordered declarationから`--z-generated-*`を生成し、生の数値`z-index`と未登録layerをarchitecture testで拒否する。
- history / confirm dialogはtop layerを利用し、通常documentの`z-index`体系へ混ぜない。
- `transform`、`opacity`、`filter`、`isolation`、`contain`、fixed / sticky positioningを追加する変更ではstacking context treeを再監査する。

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
- style sourceに生の数値`z-index`がなく、modal componentが`showModal()`を使用する。
- `npm run verify`がsourceとE2Eの両方を実行する。

### Commit

`refactor: enforce phase 2.5 architecture gates`

## 5. Phase 3: Native still capture via ImageCapture

### Capture preferenceとactual route

```ts
type CapturePreference = "photoPreferred" | "videoFrame";

type CaptureRoute = "photo" | "videoFrame";
```

- defaultは`photoPreferred`とし、`ImageCapture`が利用可能なcameraではnative still routeを優先する。
- settings UIから`photoPreferred`と`videoFrame`を明示的に選択可能にする。Phase 3ではcurrent documentのsession stateだけに保持し、Phase 6で非画像preferenceとして永続化する。
- `videoFrame`選択時は`ImageCapture` capabilityが存在しても`takePhoto()`を呼ばず、Phase 2のcurrent video-frame routeを使う。
- `ImageCapture`非対応時は`photoPreferred` optionをdisabledにしてeffective routeを`videoFrame`とする。保存値またはdefaultの`photoPreferred`自体は破壊せず、対応cameraへ切り替えた場合は再びphoto routeを利用可能にする。
- `photoPreferred`選択時のcapability取得 / `takePhoto()`失敗はvideo-frameへ一度fallbackし、設定値を暗黙に書き換えない。
- 通常UIではfallbackを静かに扱う。configured preference、現在利用可能なroute、各captureのactual routeは別のstate / fieldとして保持し、history detailsまたはlocal debug表示で確認可能にする。
- `auto`はPhase 3へ含めない。明示的な2 preferenceで端末実測を集め、adaptive strategyの価値と状態空間を再評価してから別phaseで判断する。

### 実装

- `globalThis.ImageCapture`をcapability detectionし、存在する場合だけvideo trackからadapterを生成する。
- `getPhotoCapabilities()`の`imageWidth.max` / `imageHeight.max`をstill captureの最大要求dimensionsとして保持する。
- shutterでは`takePhoto({ imageWidth, imageHeight })`を最高品質routeとして使う。
- `takePhoto()`が返すencoded BlobはMIMEを検証し、実dimensionsを取得したうえで再encodeせず`CapturedImage`としてhistoryへ渡す。capture domainでPNGを前提にしない。
- `ImageCapture`非対応、photo capability取得失敗、`takePhoto()`失敗時は、trackがliveならPhase 2のvideo-frame captureへ一度fallbackする。
- native Blob取得後のWorker処理失敗は同じBlobをmain-thread Canvas adapterで一度fallbackする。両adapterでMIME / decode検証が失敗した場合はtyped capture errorを返し、camera source解放後の別時点のvideo frameを暗黙に撮影しない。
- video-frame fallbackも失敗した場合だけtyped capture errorを表示する。fallbackした事実は画像内容を含めずstatusとして通知してよい。
- photo capabilityがvideo settingsと異なる場合、camera viewまたはdetailsに「プレビュー」と「撮影 最大」を分けて表示する。
- thumbnailはnative Blobから非同期生成し、temporary `ImageBitmap`をcloseする。native stillをhistoryへ追加するためのfull-size canvas / PNG encodeは作らない。
- Clipboard adapterはcapture形式とClipboard representationを分離する。portable fallbackは同期的に開始した`image/png` Promiseへnative Blobを必要時だけ変換し、native MIME direct writeは事前にMIMEを確定できる場合だけopt-inする。
- Phase 3ではpreview streamの最大化を維持する。photo preference用の軽量previewやfallback時のstream再設定は同時導入せず、同一preview条件でroute別timingを比較してから判断する。

### Local performance measurement

- 外部送信や永続化を行わないlocal timingとして、source acquisition、video-frame PNG encodeまたはClipboard互換変換、thumbnail、Clipboard settlementを個別に計測する。
- timing recordにはactual route、source / output dimensions、native MIME、Clipboard MIME、Blob byte lengthを含め、各stageが未実行の場合は`Option.none`で表す。画像内容、device ID / labelは含めない。
- user agentは既存browser情報からその場で参照するdebug情報に限り、preferenceやhistoryへ保存しない。
- 端末実測の暫定baselineとして、Androidの3000×4000 video-frame PNGで約10秒、2448×3264で約2秒という観測を記録する。これは自動測定前の参考値であり、原因確定値として扱わない。
- 計測結果はcapture成功判定やroute選択へfeedbackしない。Phase 3ではauto adaptiveを実装しない。

### 自動検証

- default `photoPreferred`かつsupported時はnative still routeを選び、actual routeを`photo`として記録する。
- `videoFrame`選択時はsupported環境でも`getPhotoCapabilities()` / `takePhoto()`を呼ばない。
- unsupported時は`photoPreferred`を選択不能としてvideo-frame routeだけを使い、stored preferenceを書き換えず、対応cameraへの切替後はphoto routeを再利用できる。
- supported時に`getPhotoCapabilities()`を呼び、maximum `imageWidth` / `imageHeight`を`takePhoto()`へ渡す。
- unsupported時はPhase 2のvideo-frame routeだけを使う。
- capability取得失敗と`takePhoto()`失敗ではvideo-frame routeへfallbackし、actual routeを`videoFrame`として記録する。
- trackがendedならfallbackで不正なcaptureを作らずtyped errorにする。
- returned still Blobのnative MIMEと実dimensionsをhistoryへ反映し、history用full-size PNG re-encodeを行わない。
- Clipboard write開始が最初の`await`より前である既存contractを維持し、capture / history successはClipboard互換変換やsettlementを待たない。
- native MIME direct writeを行う場合は事前確定、`ClipboardItem.supports()`、runtime writeのgateをtestし、それ以外は`image/png`互換経路を使う。
- stage timingがroute / dimensions / byte lengthとともにlocalで観測でき、計測失敗が撮影を壊さない。
- still image metadataとtimingを永続化・送信しない。

### 完了条件

- 対応環境ではvideo stream resolutionを超えるstill photo capabilityを利用でき、native encoded artifactをhistoryへ再encodeせず保持する。
- 非対応環境ではPhase 2と同じ完全なcapture experienceを維持する。
- `npm run verify`が成功する。

### Commit

`feat: complete phase 3 native still capture`

## 5.5 Phase 3.5: Capture pipeline measurement and worker optimization

Phase 3のnative still routeではnative encoded Blobをhistory artifactとして保持できたが、portable Clipboard representation、dimensions検査、thumbnailのために同じfull-resolution imageを複数回decodeし得る。さらに`navigator.clipboard.write()`のsettlementには、applicationがrepresentationを用意する時間とbrowser / OS側の処理時間が含まれる。両者を分離して計測したうえで、Web APIの範囲内で重複処理とmain-thread負荷を削減する。

Chromium sourceで観測されるPNG decode、Android system Clipboard用PNG再encode、main-thread canvasのidle-task schedulingはtarget browserの重要な実装根拠だが、Web標準の保証ではない。Chromium固有の挙動へcapture correctnessを依存させず、feature detection、既存Canvas adapterへのfallback、実機比較を必須とする。

### Timing contract

- durationとshutter-relative milestoneを異なる型・fieldで表現し、同じ`elapsedMs`として混在させない。

```ts
type CaptureStageDuration = Readonly<{
  kind: "duration";
  stage: "sourceAcquisition" | "videoFrameEncode" | "imageDecode" | "clipboardEncode" | "thumbnail";
  durationMs: Option<number>;
}>;

type CaptureMilestone = Readonly<{
  kind: "milestone";
  milestone: "clipboardRepresentationReady" | "clipboardSettled";
  offsetFromShutterMs: Option<number>;
}>;
```

- shutterを共通originとし、applicationのportable representation完成時点を`clipboardRepresentationReady`、`navigator.clipboard.write()` settlementを`clipboardSettled`として別々のmilestone offsetに記録する。
- representation完成後にClipboardがsettleする場合だけ、`browserClipboard = clipboardSettled.offsetFromShutterMs - clipboardRepresentationReady.offsetFromShutterMs`をderived timingとして表示する。representation完成前にwriteがrejectした場合は`Option.none`とし、負数を丸めてbrowser時間として報告しない。
- 従来のClipboard write開始からsettlementまでを表していた`clipboardSettle` durationは廃止し、異なるoriginの値との減算を許さない。将来write duration自体が必要になった場合は`clipboardWriteDuration`として明示的に別計測する。
- 既存のsource acquisition、image decode、video-frame encode、Clipboard互換encode、thumbnail durationを維持し、routeごとに未実行stageを`Option.none`で表す。
- timingはlocal memory / details表示だけに保持し、network送信、永続化、自動route選択へ使用しない。
- Android実機の暫定観測として、3000×4000 video-frame PNGは約10秒、2448×3264 video-frame PNGは約2秒、3000×4000 native still routeは約3秒を比較baselineにする。ただし自動testの固定性能閾値にはしない。

### Decode-once image processing

- native still Blobはplatform image-processing transactionへ一度だけ渡し、full-resolution decodeを一回に集約する。
- 一つのdecoded imageから実dimensions、portable PNG用full-size canvas、320 px thumbnail用small canvasを準備し、`ImageBitmap.close()`を必ず呼ぶ。
- full-size PNG完成後はfull canvasのbacking storeを直ちに縮小 / 解放する。thumbnail側に保持してよいのは320 px raster相当だけとし、full decoded imageをClipboard settlementまで保持しない。
- history artifactはnative Blobと実dimensionsが確定した時点で追加し、thumbnailを`pending | ready | failed`として別transitionで更新できるmodelにする。thumbnail failureでcapture成功を取り消さない。
- thumbnail encodeはClipboardのsuccess / failure settlement後に開始し、browser-side Clipboard処理とfull-image decode / encodeがCPU・memory bandwidthを競合しないようにする。Clipboard failureでもthumbnail処理は開始する。

### Persistent worker adapter

- application起動時に同一originのDedicated Workerを一つだけ準備し、captureごとのworker生成・module compileをcritical pathへ入れない。
- Workerでは`createImageBitmap()`による単一decodeと`OffscreenCanvas.convertToBlob()`によるPNG / JPEG encodeを行う。2D contextはcamera imageがopaqueであることを`{ alpha: false }`で宣言する。
- `willReadFrequently`は`getImageData()`中心のworkloadではないためdefaultで有効化しない。採否は別の端末A/B benchmarkで判断する。
- main threadとWorkerのmessage protocolはtransaction IDとdiscriminated unionを使い、concurrent capture、stale response、worker error、terminationをtypedに扱う。
- `Worker`、`OffscreenCanvas`、`convertToBlob()`、worker内`createImageBitmap()`のいずれかが利用不能、初期化失敗、decode / encode rejection、worker crashとなった場合は既存main-thread Canvas adapterへ一度fallbackする。
- fallbackしてもcapture route、history native artifact、Clipboard user activation、camera lifetimeの契約を変えない。performance optimization failureをcapture failureと混同しない。
- worker scriptはapplication codeと同じoriginから初期loadし、capture Blobをrequest body、URL、persistent storageへ変換しない。`connect-src 'none'`、Service Workerなし、capture操作後のno-network contractを維持する。

### Resource and lifecycle contract

- Clipboard writeは従来どおり最初の`await`より前に`Promise<Blob>` representationで開始する。
- source artifact completion、history追加、camera source releaseはWorker encode、thumbnail、Clipboard settlementを待たない。
- Clipboard representation ready、Clipboard settlement、thumbnail settlementは独立observerで更新し、いずれの順序でもcapture successを巻き戻さない。
- worker内のjob resourceはsuccess、failure、fallback、component unmountの全経路で破棄する。pending jobを無期限にMapへ保持しない。
- video-frame routeもWorker化の対象にできるが、Phase 3.5の第一対象はnative Blobの重複decodeとportable PNG変換とする。既存video-element frame captureのcorrectnessを同時に作り直さない。

### 自動検証

- native JPEG相当の一captureでfull-resolution decodeが一回だけ呼ばれ、dimensions、Clipboard PNG、thumbnail rasterへ共有される。
- Clipboard representation readyとsettlementのtimestampが同じoriginで記録され、derived browser timeが正しく計算される。early rejectionではbrowser timeを捏造しない。
- historyはthumbnailとClipboardの未settled状態でも追加され、後からthumbnailだけが更新される。
- thumbnail encodeはClipboard success / failureのどちらでもsettlement後に始まり、それ以前には開始しない。
- Worker adapterのsuccess、unsupported、initialization failure、job failure、crash、stale response、concurrent jobを確認する。
- worker / fallbackの両経路でnative artifact、actual dimensions、portable `image/png` Clipboard representationが一致する。
- `ImageBitmap.close()`、full canvas解放、pending job cleanupがsuccess / failureの全経路で行われる。
- app起動後のcapture / copy操作が追加network request、persistent image storage、Service Workerを発生させない。
- `npm run verify`が成功し、Android実機ではphase開始前後のstage timingを同一解像度・同一routeで記録する。

### Deferred experiments / non-goals

- generic libpng WASM、single-thread SIMD、ultra-fast low-compression PNGはWorker / decode-once後のstage timingでapplication PNGが依然支配的な場合だけ別benchmarkとして検討する。
- Wasm threadsはcross-origin isolationと現在のGitHub Pages / no-Service-Worker contractが整合しないためPhase 3.5へ含めない。
- WebCodecs `VideoEncoder`、WebGPU、`willReadFrequently`の決め打ちは今回のstill PNG bottleneckの既定解にしない。
- Android native content-URI Clipboard adapterはWeb API外の別product routeとする。検討時はmemory-only providerのprocess-death耐性とtemporary fileを使う場合のno-storage contract変更を先に裁定する。
- Phase 3.5ではpreview最大化と明示的な`photoPreferred | videoFrame` preferenceを維持し、adaptive route / preview解像度最適化は導入しない。

### Commit

`perf: complete phase 3.5 capture pipeline optimization`

## 5.6 Phase 3.6: Video-frame measurement and Worker optimization

### Observed baseline and problem statement

同一Android端末・同一Chrome 150・同一3000×4000 camera modeの最新測定では、native photo routeはClipboard完了まで約3061 ms、video-frame routeは約10862 msである。細分化後のvideo-frame baselineはframe validation 0 ms、raster 62 ms、main-thread PNG encode 9774 ms、browser / OS Clipboard 813 msであり、PNG encodeが全体の約90%を占める。

```text
current video-frame route

HTMLVideoElement (3000×4000)
        ↓ main thread
HTMLCanvasElement.drawImage(video)
        ↓
HTMLCanvasElement.toBlob(image/png)
        ↓
ClipboardItem(Promise<PNG>)
        ↓ Clipboard settlement
PNGをfull-resolution decode
        ↓
320 px thumbnail JPEG
```

Phase 3.5のpersistent Worker / decode-onceはnative Blob routeだけに適用されており、video-frame baselineはmain-thread Canvasである。3.6Aの実測により`drawImage()`ではなく`toBlob()`が支配的と確定したため、3.6Bでは既存Workerをvideo frameへ拡張する。

### Timing contract

`CaptureTimingMeasurement`のdurationとmilestoneの判別を維持する。新しいstageは全て`kind: "duration"`かつ`durationMs`であり、shutter-relativeな`clipboardRepresentationReady` / `clipboardSettled`とは混在させない。

```ts
type VideoFrameDurationStage =
  "videoFrameAcquire" | "videoFrameTransfer" | "videoFrameRaster" | "videoFramePngEncode";
```

- `videoFrameAcquire`: capture対象frameのvalidation開始から、main threadでcurrent frameを表すresourceを取得するまで。baselineではdimensions / readiness validation、Worker候補では`createImageBitmap(video)`のsettlementを含む。
- `videoFrameTransfer`: transferableを添付した`postMessage()`開始からWorkerのaccepted acknowledgement受信まで。物理memory copyだけではなく、Worker dispatch / queue / acknowledgementを含むhandoff round-tripであり、zero-copy時間とは呼ばない。main-thread baselineでは未実行とする。
- `videoFrameRaster`: encode対象canvasのcontext取得とframe配置。baselineでは`drawImage(video, ...)`、Worker 2Dでは`drawImage(bitmap, ...)`、`bitmaprenderer`候補では`transferFromImageBitmap()`を含む。
- `videoFramePngEncode`: `toBlob("image/png")`または`convertToBlob({ type: "image/png" })`開始からPNG Blob完成まで。

既存の集約`videoFrameEncode`は新stageと同時に合算値として表示しない。旧sessionとの永続互換性は不要であり、history detailsでは新しいstageを個別表示する。支配stageの判断は固定ms thresholdではなく、同一端末・同一camera・同一dimensionsの比較で行う。

### Subphase 3.6A: Instrument the unchanged baseline first

最初のdeployではalgorithmを変えず、既存の`HTMLVideoElement → HTMLCanvasElement.drawImage() → toBlob()`を小さなbaseline adapterへ分離して詳細timingを追加する。

- Canvas contextは既存どおりopaque camera imageとして扱い、encode完了後にbacking storeを1×1へ解放する。
- Clipboard writeはshutter handler内で同期的に開始し、最初の`await`より前というWebKit user-activation contractを維持する。
- thumbnailはClipboard settlement後にのみ開始する。ただし現baselineでPNGをfull-resolution再decodeしている事実はtimingへ残し、3.6Aでは同時に変更しない。
- Androidで`videoFrameAcquire`、`videoFrameRaster`、`videoFramePngEncode`、Clipboard milestones、thumbnailを記録し、5035 msの内訳を確定する。

3.6Aは単独でverify・deployし、実機baselineを得る。Worker primary routeやWASMの採否はこの測定前に決めない。

### Subphase 3.6B: Typed Worker prototype and A/B comparison

3.6A測定後、現在のpersistent same-origin module Workerをtyped discriminated unionで拡張する。第一prototypeは互換性とboundaryの単純さから次とする。

```text
main thread
HTMLVideoElement
    ↓ createImageBitmap(video)
transferable ImageBitmap
    ↓ postMessage(message, [bitmap])

persistent Worker
ImageBitmap
    ↓ 2D drawImage または bitmaprenderer transfer
OffscreenCanvas
    ↓ convertToBlob(image/png)
PNG Blob
```

HTML Standardでは`HTMLVideoElement`が`createImageBitmap()`のsourceであり、current playback positionのframeからnatural dimensionsのbitmapを作る。`ImageBitmap`はtransferableであり、transfer後のmain-thread objectはdetachedされる。transferが全実装でzero-copyになるとは仮定しない。[HTML Standard: ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html) / [MDN: Transferable objects](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Transferable_objects)

Worker protocolはnative still jobとvideo-frame jobを混同しない。

```ts
type ImageProcessingRequest =
  PrepareNativeImageRequest | PrepareVideoFrameRequest | EncodeThumbnailRequest | DiscardRequest;
```

job IDでconcurrent request、accepted acknowledgement、stale response、timeout、crash、disposeを識別する。UI componentへ`Worker`、`ImageBitmap`、`OffscreenCanvas`を漏らさない。main threadでWorkerへ渡せなかったbitmapとWorkerがownershipを受け取ったbitmapの双方について、success / error / timeout / dispose時の`close()`またはdetached lifecycleをtestする。

### Raster A/B and baseline selection

Worker内のrasterizerは次のtyped strategyとして比較可能にする。

```ts
type VideoFrameRasterizer = "2d" | "bitmapRenderer";
```

- `2d`: `{ alpha: false }`の2D contextへ`drawImage(bitmap, ...)`する。
- `bitmapRenderer`: support時だけ`getContext("bitmaprenderer", { alpha: false })`と`transferFromImageBitmap()`を使う。ownershipがcanvasへ移るため、同じbitmapをthumbnail用に再利用する前提を置かない。
- `bitmaprenderer`は低overhead / intermediate compositing回避を目的とする標準APIだが、端末上のzero-copyや速度向上は保証されない。unsupported / failure時は2Dへfallbackする。[HTML Standard: ImageBitmap rendering context](https://html.spec.whatwg.org/multipage/canvas.html#the-imagebitmaprenderingcontext-interface)

baseline rasterが62 msに留まったため、`bitmaprenderer`の実装優先度は下げる。まず同一buildで通常URLのWorker 2Dと`?videoFramePipeline=canvas`のbaselineを比較し、actual processing routeをhistory detailsへ記録する。画像や選択結果を永続化しない。Worker 2DのAndroid実測後に最速かつ安定したrouteを確定し、baselineはportable fallback / contract testとして残す。`bitmaprenderer`はWorker 2Dでもrasterが支配的と判明した場合だけ追加する。

### MediaStreamTrackProcessor decision

`MediaStreamTrackProcessor + VideoFrame`はframeをWorkerへ直接流せる可能性があるが、現時点でBaselineではなく、browserによりWindow / Dedicated Workerのどちらへ公開されるかも不一致である。Phase 3.6のprimary routeにはせず、`createImageBitmap(video)`後も`videoFrameAcquire`が支配的な場合だけChrome Android向けoptional experimentとして再検討する。[MDN: MediaStreamTrackProcessor](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrackProcessor)

### Thumbnail critical path

- Clipboard PNG生成とbrowser / OS Clipboard settlementより前に、thumbnailのfull-resolution PNG decodeを開始しない。
- Worker frame処理中に320 px rasterを準備する案と、Clipboard settlement後にcurrent frameまたはPNGから縮小する案を別strategyとして測定する。
- 320 px raster準備が`clipboardRepresentationReady`を有意に遅らせる場合はcritical pathへ入れない。
- どのstrategyでもClipboard settlementまで保持するfull-resolution bitmap / canvasを増やさず、320 px rasterまたはBlobだけを保持する。

### Deferred decisions

- Worker + OffscreenCanvas後も`videoFramePngEncode`がdominantであり、product latency目標を満たさない場合だけ、ultra-fast low/no-compression PNGとsingle-thread Wasm SIMDを独立benchmarkする。今回の実測ではphoto routeと同等以上へ到達したため導入しない。
- generic libpng WASM、Wasm threads、WebGPU、WebCodecs VideoEncoderは「Wasm / hardware / GPUだから速い」という理由では採用しない。
- performance CIへ固定ms thresholdを置かない。CIはstage semantics、resource cleanup、fallback、privacy、correctnessをgateし、Android latencyはmanual QAで比較する。

### Verification gates

- unchanged main-thread baselineで新duration stageが正しい順序・意味で記録される。
- Worker success、unsupported、initialization failure、runtime failure、stale response、concurrent job、timeout、dispose cleanupを確認する。
- transferred `ImageBitmap`のownership / cleanupとfull canvas backing store解放を全exit pathで確認する。
- Worker 2D / main-thread baselineのactual routeがdiagnosticsへ入り、unsupported時はmain-thread baselineへ安全にfallbackする。`bitmaprenderer`はbaseline rasterが支配的でなかったため未導入とする。
- thumbnail用full-resolution処理がClipboard critical path前に開始しない。
- native photo routeのdecode-once、native history Blob、portable Clipboard PNG、thumbnail遅延、Worker fallbackにregressionがない。
- same-origin Worker bundle、`connect-src 'none'`、no Service Worker、no network、no persistent image storageを維持する。
- `npm run verify`を通し、Android実機で同一3000×4000 camera modeのbaseline / Worker routeを記録する。

### Measured outcome and decision

```text
3000×4000 / Chrome 150 / Android 10

                         Worker run 1   Worker run 2   main-thread baseline
frame acquisition             200 ms          85 ms                0 ms
Worker handoff                106 ms          41 ms           未実行
raster                         10 ms          87 ms               62 ms
PNG encode                   1580 ms        1682 ms             9774 ms
representation ready         1865 ms        2041 ms            10049 ms
browser / OS                 1228 ms         578 ms              813 ms
Clipboard settled            3093 ms        2620 ms            10862 ms
thumbnail                     761 ms         912 ms             1405 ms
```

Worker 2DによりPNG encodeは平均1631 msとなりbaseline比で約83%減少、Clipboard完了は2620〜3093 msとなり約3.5〜4.1倍高速化した。native photo routeの3061 msに対して同等または高速であり、3000×4000 preview frameを使う目的を解像度低下なしで達成した。

`createImageBitmap(video)`とhandoffは合計126〜306 ms、Worker rasterは10〜87 msであり、次の最適化対象として`MediaStreamTrackProcessor`や`bitmaprenderer`を導入する根拠はない。Worker PNGは依然最大のapplication stageだが、photo routeと同等のproduct latencyへ到達し、browser / OS Clipboardも578〜1228 msを占めるため、Wasm / custom PNG encoderはTCBとmemory surfaceを増やす利益が確認できない。Worker 2Dをdefaultとして確定し、main-thread Canvasをportable fallbackと診断baselineとして残す。

### Commits

```text
dd30d53 perf: instrument video-frame capture stages (#13)
9706e83 perf: add video-frame worker prototype
04dc7a4 docs: record video-frame worker benchmark procedure
```

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
- camera source acquisition、video-frame PNG artifact生成、camera switch中はidle suspendしない。capture artifact settlementを新しいactivityとしてtimerを再armし、native still取得後のdecode / thumbnail / Clipboard互換変換とClipboard settlementは待たない。
- `off`ではidle timerを作成しない。
- Phase 4ではidle停止理由と「カメラを再開」actionを明示する最小UIを提供し、Phase 5でscreensaverへ拡張する。
- background / idleの両方でhard stopしつつ別reasonとして扱い、二重resumeやstale transactionを防ぐ。

### 自動検証

- fake timerで`9.999s`ではstreaming、`10.000s`で全trackの`stop()`が一度だけ呼ばれる。
- `off`では時間が経過しても停止しない。
- activityでtimerがresetされる。
- capture開始直後にtimeoutへ到達してもstopせず、operation完了後にtimerを再armする。
- idle停止とbackground suspendが互いのresumeを誤って実行しない。

### 完了commits

```text
55db3bd feat: add typed idle timer controller
8c7250b refactor: expose camera-source capture lifetime
b228df4 feat: hard-stop idle and background cameras
```

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

### 完了commit

`b801ff5 feat: complete phase 5 idle screensaver`

## 8. Phase 6: User preferences

### 実装

- camera viewから短い操作で到達できるsettings UIを追加する。
- `10s`、`30s`、`1m`、`3m`、`5m`、`10m`、`off`だけを選択可能にする。
- `capturePreference`は`photoPreferred`または`videoFrame`だけを許可し、defaultを`photoPreferred`とする。
- version付きの最小payload `{ version: 1, idleTimeout, capturePreference }`だけを`src/platform/preferences.ts`で`localStorage`へ保存する。
- 保存するのはpreferenceだけであり、ImageCapture非対応環境でruntime routeが`videoFrame`になっても`photoPreferred`の保存値を上書きしない。
- missing、invalid、future version、JSON parse error、SecurityError / quota errorは安全なdefault `10s`へfallbackする。
- preference変更時は現在のtimerをcancelし、新しい設定で再armする。`off`選択時は稼働中cameraを停止せずauto-stopだけを無効にする。
- installed PWAとbrowser tabで同じorigin preferenceを共有し得ることを文書化する。

### Privacy test変更

source全体の`localStorage`文字列禁止を、次のarchitecture contractへ置き換える。

- Web Storage accessは`src/platform/preferences.ts`だけに許可する。
- preferences payloadは`version`、`idleTimeout`、`capturePreference`以外を持てない。
- capture / history codeからpreferences portへ`Blob`、Object URL、dimensions、device情報を渡せない。
- IndexedDB、Cache Storage、Service Worker、network、download禁止は維持する。

### 自動検証

- 全optionのround trip、valid value restore、missing / invalid / stale valueのdefault `10s` / `photoPreferred` fallbackを確認する。
- stored preferenceとeffective / actual routeが独立し、非対応cameraへの切替で保存値が変わらないことを確認する。
- storage APIがthrowしてもcamera起動を阻害しない。
- preference変更でtimerが正しく再arm / cancelされる。
- image `Blob`がpersistent preferenceへ到達するAPI surfaceを持たない。

### 完了commits

```text
ac670ff feat: add typed preference storage boundary
93edea5 feat: add persistent camera settings UI
```

## 9. Phase 7: Acceptance automation + memory hardening

### Browser / accessibility

- 320×568、390×844、768×1024、1280×800のrequired viewportをbrowser testへ固定する。
- keyboard focus、Escape、reduced motion、forced colorsの主要contractを自動化する。
- Chromiumでは実際のClipboard APIへportableなPNG representationを書き、同じbrowser contextでread-backする。native MIME direct writeは対象browserが明示的にsupportする場合だけ追加検証する。
- test用fake camera / Clipboard以外のnetwork requestや画像persistent storageが増えていないことを再確認する。

### Resolution / ImageCapture

- 4K source、portrait 4K、video settings表示、still capability表示をcontract testへ固定する。
- `ImageCapture` supported / unsupported / capability failure / `takePhoto()` failureを全て確認する。
- configured `CapturePreference`とactual `CaptureRoute`を別々に検証し、fallback後もpreferenceが変化しない。
- actual photo dimensions、native MIME、history artifactが一致し、native still history pathがfull-size PNG re-encodeを呼ばない。
- capture artifact完成後のhistory追加はthumbnail、Clipboard互換変換、Clipboard settlementを待たない。
- source acquisition、compatibility encode、thumbnail、Clipboard settlementのtimingが独立して記録され、欠落stageを`Option`で表現する。

### Idle / preferences

- timeout全境界、`off`、activity reset、screensaver resume-only、capture中のdeferred suspendをbrowser testへ追加する。
- valid / invalid preference restoreとprivacy boundaryを確認する。

### Memory hardening

- 48MP相当のRGBA backing storeが約195MBになり得る前提で、同時に保持するdecoded image / canvasを一つに制限する。
- frame / photo encodeの全success / failure pathで`ImageBitmap.close()`とcanvas縮小が行われることをtestする。
- consecutive high-resolution captureで前回canvas dimensionsを保持しない。
- transient allocation failureをtyped errorへ写像し、camera streamと既存historyを壊さない。
- 履歴Blob合計の既存warningと、capture瞬間のtransient memory対策を別のcontractとして扱う。

### 完了内容

- 4 required viewport、keyboard focus / Escape、reduced motion、forced colors、4K preview / still capability分離表示をbrowser acceptanceへ固定した。
- ChromiumでmockではないClipboardへportable PNGを書込み、同じbrowser contextからread-backするgateを追加した。
- capture source取得中のidle抑止と、完了後のtimer再armをbrowser testで確認した。
- main-thread / Worker双方のcanvas backing store cleanupを共通化し、success / failure / consecutive captureで1×1へ縮小するcontractを固定した。
- `QuotaExceededError`を`memoryAllocationFailed`へ写像し、同じ巨大allocationをWorkerからCanvasへ再試行しない。通常のWorker failure fallbackは維持する。

### 完了commits

```text
99d6bf8 fix: harden high-resolution canvas cleanup
ed2d4e6 fix: avoid retrying memory allocation failures
8072ff0 test: expand V2 browser acceptance coverage
a8b3e6e test: cover capture idle inhibition in browser
```

### Commit

上記のresource hardeningとacceptance concernごとに分割して完了した。

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

### 自動release verification（2026-08-30）

- clean `npm ci`は209 packageをinstallし、auditは0 vulnerabilityだった。
- `npm run verify`はrepository hygiene、format、lint、strict TypeScript、27 test file / 142 unit・integration test、production build、Playwright 60 case（34 pass / 26 capability skip）を完了した。
- production artifactはinitial JavaScript 68.09 kB（gzip 22.50 kB）、Worker 3.32 kB、CSS 13.27 kB（gzip 3.65 kB）、`index.html` 1.19 kBだった。
- repository gateはtracked textのUTF-8、MIT license、package metadata / lockfile、secret pattern、危険なfilename、1 MiB超のtracked fileを検査する。最大tracked fileは約122 kBだった。
- production URLはHTTP 200で、Manifestは`id` / `start_url` / `scope`が`/webcam-app/`、`display`が`standalone`、192 / 512 / maskable iconが同一base pathでHTTP 200だった。HTMLのmeta CSP、`connect-src 'none'`、Manifest linkも確認した。
- 接続済みbrowserのない検証環境ではrendered production UIを追加確認できなかった。実install、実camera indicator、idle resume、actual paste、Androidのnative still、Safari / Firefox fallback、VoiceOverは上記完了条件を満たすためのmanual QAとして未実施のまま明示する。

自動release hardeningは`build: gate repository release hygiene`と本節の文書同期へ分割した。Phase 8全体を完了にするのは対象実機のmanual QA後とする。

### Commit

文書・検証修正が必要な場合のみ、`docs: complete phase 8 V2 release hardening`とする。変更がなければ空commitは作らない。

## 11. Commit / push運用

各phaseで次の順序を守る。

1. phase対象だけを変更する。
2. UTF-8、format、lint、TypeScript、unit / integration test、production buildを確認する。
3. browser挙動を変更したphaseではPlaywright E2Eも確認する。
4. `git diff --check`とstaged diffをreviewし、secretと意図しない大容量fileを確認する。
5. phase専用commitを作成する。
6. phase branchへpushしてPRを作成し、required `Verify`成功後だけprotected `main`へmergeする。
7. merge後の`origin/main`とdeploy結果を確認してから次のphaseへ進む。

push前にremoteが進んでいた場合は、remote差分を確認してからnon-destructiveに統合する。既存CI/CD workflowを各機能の都合だけで変更しない。

## 12. 仕様根拠

- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [W3C: Web Application Manifest](https://www.w3.org/TR/appmanifest/)
- [W3C: Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [W3C: MediaStream Image Capture](https://www.w3.org/TR/image-capture/)
- [MDN: ImageCapture](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture)
- [MDN: ImageCapture.getPhotoCapabilities()](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/getPhotoCapabilities)
- [MDN: ImageCapture.takePhoto()](https://developer.mozilla.org/en-US/docs/Web/API/ImageCapture/takePhoto)
- [W3C: Clipboard API and events](https://www.w3.org/TR/clipboard-apis/)
- [MDN: ClipboardItem.supports()](https://developer.mozilla.org/en-US/docs/Web/API/ClipboardItem/supports_static)
- [MDN: OffscreenCanvas.convertToBlob()](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)
- [MDN: OffscreenCanvas.getContext()](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/getContext)
- [Chromium: Clipboard image writer](https://chromium.googlesource.com/chromium/src/+/2ae2589b5697a61ec4d96d3bdf7a726e38a2e58c/third_party/blink/renderer/modules/clipboard/clipboard_writer.cc)
- [Chromium: Android Clipboard bitmap writer](https://chromium.googlesource.com/chromium/src/+/e40dc1e2c83b02f4a41cd2cb88c0abad32c60ca5/ui/base/clipboard/clipboard_android.cc)
- [Chromium: Canvas async Blob creator](https://chromium.googlesource.com/chromium/src/third_party/+/master/blink/renderer/core/html/canvas/canvas_async_blob_creator.cc)
- [WHATWG HTML: Web storage](https://html.spec.whatwg.org/multipage/webstorage.html)
