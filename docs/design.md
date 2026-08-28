# Camera Clipboard Web App 設計書

| 項目 | 内容 |
| --- | --- |
| 文書状態 | PWA install拡張を含む実装設計 |
| Version | 0.2.0 |
| 作成日 | 2026-08-27 |
| 仮称 | Camera Clipboard |
| 対象 | mobile / tablet / desktop のmodern browser |
| Repository | [`bem130/webcam-app`](https://github.com/bem130/webcam-app) |
| Production URL | `https://bem130.github.io/webcam-app/` |

## 0. 方針

本アプリを「現在のcamera frameを一度の操作でsystem Clipboardへコピーする、小さなclient-side utility」と定義する。中心となる設計上の注意点は次の四点である。

1. アプリ自身は撮影画像を永続化せず、serverへ送信しない。撮影履歴は現在のdocumentが生存している間だけmemory上に保持する。
2. 撮影とClipboard書込みを一つの明確なprimary actionにまとめる。camera切替と履歴参照は常に短い操作で到達可能にする。
3. Apple Human Interface Guidelines（以下、Apple HIG）のclarity、hierarchy、consistency、feedback、privacy、accessibilityをWebへ適用する。ただしnative iOS UIの表層的な模倣は行わず、Webの標準操作も尊重する。
4. platform APIへの依存を境界へ集約し、domain state・状態遷移・errorを型で表す。GUI主体の小規模WebアプリであるためTypeScriptを採用し、不要なRust/Wasm層は設けない。

## 1. Product definition

### 1.1 一文での定義

camera previewを表示し、shutterを押すと静止画をClipboardへコピーすると同時に、reloadまで参照できるin-memory履歴へ追加するWebアプリである。

### 1.2 解決する課題

一般的なcamera appでは「撮影 → 写真libraryへ保存 → 対象appで選択・貼付」という経路になる。本アプリは「撮影 → Clipboardへcopy → 対象appへpaste」という短い経路を提供し、写真libraryへ画像を残さない。

### 1.3 成功条件

- 初回のcamera開始後、通常の撮影は一回のtap/clickで完了する。
- camera切替は一回のtapで直前のcameraと切り替えられ、任意のcameraも二回以内の操作で選択できる。
- copyの成功・失敗が即時に判別できる。
- copyに失敗しても撮影済み画像は履歴に残り、再copyできる。
- reload、tab close、browser process終了のいずれかで履歴が消える。
- アプリ起因の永続的な画像保存と画像送信が発生しない。

## 2. Scope

### 2.1 v1に含める機能

| ID | 機能 | 優先度 |
| --- | --- | --- |
| FR-01 | user actionを起点としたcamera permission要求 | 必須 |
| FR-02 | live camera preview | 必須 |
| FR-03 | 現在frameのPNG化とClipboardへのcopy | 必須 |
| FR-04 | 撮影画像のin-memory履歴 | 必須 |
| FR-05 | 履歴画像のpreviewと再copy | 必須 |
| FR-06 | 複数cameraの列挙、任意選択、quick swap | 必須 |
| FR-07 | 個別削除と全履歴消去 | 必須 |
| FR-08 | camera・Clipboard・encodeのtyped error表示と回復操作 | 必須 |
| FR-09 | mobile / tablet / desktop responsive layout | 必須 |
| FR-10 | keyboard、screen reader、reduced motion対応 | 必須 |
| FR-11 | camera接続・切断への追従 | 推奨 |
| FR-12 | tabがbackgroundへ移った際のcamera suspendと復帰 | 推奨 |
| FR-13 | browser / OS標準UIからのPWA install | 必須 |

### 2.2 v1に含めない機能

- 写真library、filesystem、download folderへの保存
- `localStorage`、IndexedDB、Cache Storage、OPFS等への画像保存
- server upload、account、同期、共有link
- 動画撮影、音声取得、連写、timer、filter、crop、markup
- galleryからの画像import
- OCR、QR code認識、document scan補正
- Service Workerによる撮影画像のcache
- offline利用とapp shellのService Worker cache
- native app固有API、Apple Camera Controlへの対応

### 2.3 前提

- top-level documentとしてHTTPSで配信する。`localhost`はdevelopment用途に限り許容する。
- cameraとimage Clipboard writeを実装するmodern browserを対象とする。
- microphone permissionは一切要求しない。
- Clipboardは「現在の一項目を置換する」system resourceであり、撮影ごとに直前のClipboard内容を置換する。

## 3. Data and privacy contract

### 3.1 「保存しない」の定義

本設計で「アプリが保存しない」とは、アプリが取得したcamera frameまたは生成画像を、次の場所へ意図的に書き込まないことをいう。

- application serverまたはthird-party server
- browserのpersistent storage
- filesystemまたはdownload領域
- Service Worker cache
- analytics、logging、error reporting service

許可される保持先は次の二つだけである。

1. 現在のWeb documentに属するmemory
2. userの明示操作によって書き込まれるsystem Clipboard

### 3.2 責任境界

| 層 | 本アプリの契約 |
| --- | --- |
| Application | 画像をmemoryとClipboard以外へ書かず、network送信しない。reload時の復元手段を持たない。 |
| Browser | permission、camera indicator、process memory、Clipboard APIの実装はbrowserが管理する。 |
| OS | Clipboard履歴、swap、crash dump、device間Clipboard同期等はOS設定と実装が管理する。 |
| Paste先app | 貼付後の保存、送信、加工は貼付先appが管理する。 |

AppleのUniversal Clipboardが有効な環境では、copyした画像が近くの同一Apple Account端末のClipboardへ一時的に追加され得る。これはClipboardの期待されたsystem behaviorであり、本アプリによる画像送信とは区別する。[Apple Support: Universal Clipboard](https://support.apple.com/en-hk/102430)

### 3.3 保証するinvariant

- **P-01:** `audio: false`を常に指定し、audio trackを取得しない。
- **P-02:** captureは可視かつenabledなshutterまたは履歴の「再コピー」操作からのみ開始する。
- **P-03:** 画像をrequest body、URL、cookie、telemetry payload、console logへ含めない。
- **P-04:** 履歴はmodule-level global、DOM attribute、URL、history stateへ埋め込まず、application state内だけに保持する。
- **P-05:** reload後に履歴を復元しない。
- **P-06:** 削除したentryのObject URLを直ちにrevokeする。
- **P-07:** document破棄時に全camera trackをstopし、全Object URLをrevokeする。
- **P-08:** Clipboard書込みの事実と対象時刻はUIに表示してよいが、画像内容はlogへ出さない。

## 4. User experience

### 4.1 初回起動

初期画面ではcamera permissionを自動要求しない。次の短い説明とprimary buttonを表示する。

> 撮影すると画像をClipboardへコピーする。画像はserverや端末の写真libraryへ保存しない。履歴はこのtabを再読み込みするまで保持する。copy後の扱いは端末のClipboard設定に従う。

Primary buttonは「カメラを開始」とする。buttonのactivationと同じuser interaction内で`getUserMedia()`を呼ぶ。Apple HIGのprivacy guidanceに従い、protected resourceが必要になった文脈でpermissionを求める。[Apple HIG: Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)

起動前に次のcapability checkを行う。

- `window.isSecureContext`
- `navigator.mediaDevices?.getUserMedia`
- `navigator.mediaDevices?.enumerateDevices`
- `navigator.clipboard?.write`
- `globalThis.ClipboardItem`

必須capabilityが欠ける場合はpermissionを要求せず、未対応理由を表示する。

### 4.2 Camera view

live previewを画面の主役とし、常設controlは最小限にする。

| 位置 | Control | 動作 |
| --- | --- | --- |
| 上部中央 | 現在camera名のselector pill | camera一覧をmenuとして開く |
| 上部右 | camera稼働表示 | 「カメラ使用中」をiconとtextで示す |
| 下部左 | 最新履歴thumbnail + 件数badge | 履歴を開く |
| 下部中央 | shutter | 撮影し、履歴追加とClipboard copyを行う |
| 下部右 | camera quick swap | 現在cameraと直前cameraを切り替える |

cameraが一台だけの場合、quick swapは非表示とし、空いた場所をclickableにしない。camera labelが取得できない段階では「カメラ 1」のようなordinal labelを用い、permission取得後に実labelへ更新する。`enumerateDevices()`はpermission前に非default deviceやlabelを十分に公開しないためである。[MDN: enumerateDevices()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)

### 4.3 撮影とcopy

1. userがshutterをactivateする。
2. 画面全体へ80 ms以下の軽いwhite flashを表示する。`prefers-reduced-motion: reduce`ではflashを省略する。
3. current frameをPNG Blobへencodeする。
4. 同じ操作のuser activationを失う前にClipboard writeを開始する。
5. encode成功時点で、Clipboard結果と独立に履歴へ追加する。
6. Clipboard成功時は「Clipboardにコピーした」を短いstatus pillとscreen reader live regionへ表示する。
7. Clipboard失敗時は「撮影したが、コピーできなかった」を表示し、「再コピー」を提供する。

処理中はshutter内部をactivity indicatorへ変え、二重activationを防ぐ。Apple HIGは完了に時間を要するbuttonでactivity indicatorを使うこと、重要actionの成功・失敗をfeedbackで伝えることを推奨している。[Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) / [Apple HIG: Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)

### 4.4 Camera切替

camera切替には二つの経路を提供する。

- **Quick swap:** 下部右buttonを一回tapし、現在cameraと直前に使用した別cameraを交換する。初回はdevice list上の次cameraへ進む。
- **Exact selection:** 上部camera selectorを開き、label付き一覧から任意cameraを選ぶ。

switch中は最後のframeを静止表示し、中央へ小さなactivity indicatorを重ねる。新camera取得に失敗した場合は旧cameraへの復帰を一度試みる。復帰にも失敗した場合はcamera stopped stateへ移り、「カメラを再開」を表示する。

別deviceIdへの変更は、既存trackへ`applyConstraints()`する方式を採らない。W3C Media Capture仕様上、trackの`deviceId`は同じsourceについて固定であり、別deviceへの変更は新しい`getUserMedia()` requestで行う。[W3C: Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)

### 4.5 History

- newest firstのgridとして表示する。
- 各entryはthumbnail、撮影時刻、pixel dimensions、概算sizeを持つ。
- thumbnail activationでdetail previewを開く。
- detailには「再コピー」と「削除」を置く。
- 「すべて消去」はdestructive actionとして明示し、確認dialogを一度表示する。
- 履歴が空なら「このtabで撮影した画像がここに表示される」と説明する。
- reload、tab close、document crash後の復元UIは提供しない。

mobileではbottom sheet、幅1024 px以上では右side panelとして表示する。履歴を開いてもcamera streamは維持するが、shutterは隠して誤撮影を防ぐ。

### 4.6 Backgroundと復帰

- `document.visibilityState === "hidden"`になったらvideo trackの`enabled`を`false`にし、cameraをsuspendする。
- visibleへ戻ったらtrackを再enableする。
- browserがtrackを終了していた場合は自動で新規permission promptを出さず、「カメラを再開」buttonを表示する。
- `pagehide`またはdocument破棄時はtrackをstopする。

Media Capture仕様では、すべての関連trackがmuted、disabled、stoppedの状態になった場合、user agentはdeviceを手放し、再enable時に再取得することが推奨される。この動作を利用し、background中のcamera indicatorと電力消費を抑える。[W3C: MediaStreamTrack lifecycle](https://www.w3.org/TR/mediacapture-streams/)

## 5. Layout and visual design

### 5.1 Apple HIGの適用方法

| HIG上の観点 | 本アプリへの適用 |
| --- | --- |
| Clarity | primary actionをshutter一つに限定し、各iconへaccessible nameを付ける。 |
| Hierarchy | camera previewを最大領域とし、controlはedgeへ集約する。 |
| Consistency | camera、switch、history、copy、deleteに一般的なsymbolと用語を使う。 |
| Feedback | shutter flash、progress、success、failureを視覚・textの両方で示す。 |
| Privacy | 必要になるまでpermissionを求めず、保持先と責任境界を明示する。 |
| Adaptivity | safe area、orientation、viewport、pointer種別、text拡大へ追従する。 |
| Accessibility | 44 × 44 CSS px以上の主要target、visible focus、semantic HTML、live regionを使う。 |

Apple HIGはApple platform向けguidelineである。本アプリではHIGを設計原則として参照し、browser標準control・keyboard操作・WCAGを同時に満たす。[Apple HIG](https://developer.apple.com/design/human-interface-guidelines) / [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)

### 5.2 Responsive layout

| Viewport | Layout |
| --- | --- |
| 0–767 px | `100dvh`のcamera canvas。top/bottom overlay。historyはfull-width bottom sheet。 |
| 768–1023 px | camera中央配置。landscapeではcontrol間隔を広げる。historyは最大560 pxのsheet。 |
| 1024 px以上 | camera領域と320–360 pxのoptional history side panel。controlはcamera領域内に維持する。 |

previewは黒背景に`object-fit: contain`で表示し、撮影範囲をcropせずに見せる。letterboxは許容する。browser UIやnotchと重ならないよう、`env(safe-area-inset-*)`をcontrol paddingへ加える。

### 5.3 Control dimensions

| Control | Visual size | Hit target |
| --- | ---: | ---: |
| Shutter | 72 × 72 px | 80 × 80 px以上 |
| Quick swap | 44 × 44 px | 52 × 52 px以上 |
| History thumbnail | 48 × 48 px | 52 × 52 px以上 |
| Camera selector | 高さ44 px以上 | 高さ44 px以上 |
| Sheet / dialog button | 高さ44 px以上 | 高さ44 px以上 |

WCAG 2.2のminimum targetは24 × 24 CSS pxであるが、本アプリの主要controlはtouch-first utilityとして44 × 44 CSS px以上を採用する。[WCAG 2.2: Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)

### 5.4 Visual tokens

- camera surface: `#000`
- primary text on controls: `#FFF`
- semantic accent: `#0A84FF`
- destructive: system red相当。色だけで意味を伝えずlabelを併記する。
- overlay material: dark translucent fill + blur。`backdrop-filter`非対応時は不透明度の高いsolid fillへfallbackする。
- font: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`
- radius: control 12 px、sheet 20 px、pillはfully rounded
- normal text contrast: 4.5:1以上。camera image上のtextは必ずscrimまたはopaque material上へ置く。[WCAG 2.2: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- motion: 120–220 ms、ease-out。撮影flash以外のdecorative motionは`prefers-reduced-motion`で除去する。

SF Symbolsのasset自体には依存しない。Webで利用可能なlicense明確なinline SVGを同じsemantic roleで用い、icon-only buttonにも常に`aria-label`とtooltipを付ける。

### 5.5 Front cameraのmirror

- front-facing cameraのlive previewだけを左右反転し、selfie cameraとして自然な追従にする。
- Clipboardへcopyする画像とhistory thumbnailは左右反転しない。文字やsceneの向きをsensorと同じに保つ。
- rear-facing cameraはpreview・出力ともに反転しない。
- v1ではmirror設定を設けない。設定追加はprimary workflowを複雑にするためscope外とする。

## 6. Application state

### 6.1 Camera lifecycle

```mermaid
stateDiagram-v2
    [*] --> Preflight
    Preflight --> Unsupported: 必須APIなし
    Preflight --> AwaitingStart: 対応環境
    AwaitingStart --> Requesting: カメラを開始
    Requesting --> Streaming: 許可・取得成功
    Requesting --> Blocked: 拒否・cameraなし
    Streaming --> Switching: camera選択
    Switching --> Streaming: 切替または復帰成功
    Switching --> Blocked: 復帰失敗
    Streaming --> Suspended: document hidden
    Suspended --> Streaming: visible・再取得成功
    Suspended --> Blocked: track終了
    Blocked --> Requesting: 再試行
```

### 6.2 Capture transaction

```mermaid
stateDiagram-v2
    [*] --> Ready
    Ready --> EncodingAndCopying: shutter
    EncodingAndCopying --> Copied: encode成功・copy成功
    EncodingAndCopying --> CopyFailed: encode成功・copy失敗
    EncodingAndCopying --> CaptureFailed: encode失敗
    Copied --> Ready: feedback完了
    CopyFailed --> Ready: dismiss
    CaptureFailed --> Ready: dismiss
```

`CopyFailed`でもencode済みBlobはhistoryへ追加する。`CaptureFailed`では有効なBlobが存在しないためhistoryへ追加しない。

## 7. Capture and Clipboard sequence

```mermaid
sequenceDiagram
    actor User
    participant UI
    participant Runtime
    participant Canvas
    participant Clipboard
    User->>UI: shutterをactivate
    UI->>Runtime: captureAndCopy(video)
    Runtime->>Canvas: PNG Promiseを生成
    Runtime->>Clipboard: write(ClipboardItem(PNG Promise))
    Note over Runtime,Clipboard: awaitより前に呼ぶ
    Canvas-->>Runtime: PNG Blob
    Runtime-->>UI: historyへ追加
    Clipboard-->>Runtime: copy success / failure
    Runtime-->>UI: typed outcome
```

Safari/WebKitではClipboard writeにuser gestureが必要である。したがってbutton handler内でBlob生成を`await`してから`navigator.clipboard.write()`を呼ぶ実装は禁止する。PNGを生成する`Promise<Blob>`を`ClipboardItem`へ渡し、`clipboard.write()`自体を同期的なevent handler call stack内で開始する。[WebKit: Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/) / [MDN: Clipboard.write()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)

概念的な実装は次の形とする。

```ts
function captureAndCopy(video: HTMLVideoElement): CaptureOperation {
  const png: Promise<Blob> = encodeVisibleFrameAsPng(video);
  const clipboard: Promise<void> = navigator.clipboard.write([
    new ClipboardItem({ "image/png": png }),
  ]);

  return combineCaptureOutcomes(png, clipboard);
}
```

この関数の呼出しと`clipboard.write()`の間へ`await`、`queueMicrotask`、`setTimeout`、component effectを挟まない。

## 8. Technical architecture

### 8.1 Technology choice

| 項目 | 選択 |
| --- | --- |
| Language | TypeScript (`strict`) |
| UI | Preact functional components |
| Build | Vite |
| Styling | plain CSS + CSS custom properties |
| Unit test | Vitest |
| Browser test | Playwright |
| Accessibility test | axe-core + manual VoiceOver / keyboard test |
| Hosting | GitHub Pages (`bem130/webcam-app`) |

Rust/Wasmは採用しない。本アプリの主要処理は`getUserMedia`、DOM video、Canvas、ClipboardというWeb platform side effectであり、Wasmへ移すplatform-independent computeがほぼ存在しないためである。TypeScriptはWeb frontendとして許容し、strictなdiscriminated unionとboundary conversionで静的検査を活用する。

### 8.2 Dependency direction

```mermaid
flowchart TD
    UI["UI components"] --> Core["Pure core: Model / update"]
    UI --> Runtime["Imperative runtime"]
    Runtime --> Camera["Camera adapter"]
    Runtime --> Capture["Canvas encoder"]
    Runtime --> Clipboard["Clipboard adapter"]
```

- `core`はDOM、`navigator`、timer、networkを参照しない。
- `platform`はWeb APIの`null`、`undefined`、exceptionを直ちにdomainの`Option` / `Result` / error unionへ変換する。
- `ui`はdomain stateを表示し、user intentをruntimeへ渡す。
- errorの識別と表示文を分離し、表示文はmessage catalogで管理する。
- dependency graphは`ui -> core`、`ui -> runtime -> platform`を基本とし、`core`から外側へ依存しない。

### 8.3 Directory layout

```text
src/
  core/
    model.ts
    update.ts
    result.ts
    errors.ts
    history.ts
    camera-selection.ts
  platform/
    camera.ts
    capture.ts
    clipboard.ts
    object-url-registry.ts
    lifecycle.ts
  ui/
    app.tsx
    camera-view.tsx
    history-panel.tsx
    capture-detail.tsx
    permission-view.tsx
    error-view.tsx
    messages.ja.ts
  styles/
    tokens.css
    app.css
tests/
  unit/
  integration/
  e2e/
```

過剰なlayer分割は避け、platform boundaryとpure coreの差が実際に存在する単位だけをdirectoryへ分ける。

### 8.4 Core types

```ts
type Option<T> =
  | Readonly<{ tag: "some"; value: T }>
  | Readonly<{ tag: "none" }>;

type Result<T, E> =
  | Readonly<{ tag: "ok"; value: T }>
  | Readonly<{ tag: "err"; error: E }>;

type CameraId = string & Readonly<{ __brand: "CameraId" }>;
type CaptureId = string & Readonly<{ __brand: "CaptureId" }>;

type CameraDescriptor = Readonly<{
  id: CameraId;
  label: string;
  facing: "user" | "environment" | "left" | "right" | "unknown";
}>;

type CaptureEntry = Readonly<{
  id: CaptureId;
  capturedAtEpochMs: number;
  camera: Option<CameraId>;
  widthPx: number;
  heightPx: number;
  png: Blob;
  thumbnail: Blob;
  byteLength: number;
}>;

type CopyState =
  | Readonly<{ tag: "idle" }>
  | Readonly<{ tag: "copying"; captureId: CaptureId }>
  | Readonly<{ tag: "copied"; captureId: CaptureId }>
  | Readonly<{ tag: "failed"; captureId: CaptureId; error: ClipboardError }>;
```

`Blob`はimmutableなopaque valueとしてcore modelへ保持してよい。`MediaStream`、`MediaStreamTrack`、`HTMLVideoElement`、Object URLはplatformまたはUI lifecycleに閉じ込める。

### 8.5 Error model

```ts
type CameraError =
  | Readonly<{ tag: "insecureContext" }>
  | Readonly<{ tag: "unsupported" }>
  | Readonly<{ tag: "permissionDenied" }>
  | Readonly<{ tag: "noCamera" }>
  | Readonly<{ tag: "cameraUnavailable" }>
  | Readonly<{ tag: "constraintsUnsatisfied" }>
  | Readonly<{ tag: "streamEnded" }>
  | Readonly<{ tag: "unknown"; causeName: string }>;

type CaptureError =
  | Readonly<{ tag: "frameNotReady" }>
  | Readonly<{ tag: "canvasUnavailable" }>
  | Readonly<{ tag: "pngEncodingFailed" }>
  | Readonly<{ tag: "memoryAllocationFailed" }>;

type ClipboardError =
  | Readonly<{ tag: "unsupported" }>
  | Readonly<{ tag: "notAllowed" }>
  | Readonly<{ tag: "unsupportedMime"; mime: "image/png" }>
  | Readonly<{ tag: "writeFailed"; causeName: string }>;
```

`DOMException.name`の文字列分岐は`platform`内だけで行い、未知値を`unknown`または`writeFailed`へ閉じ込める。UI側はunionをexhaustive `switch`で表示へ写像する。

## 9. Camera implementation

### 9.1 初期request

```ts
const constraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 30, max: 30 },
  },
};
```

`exact`を初回に使わない。希望cameraが存在しないだけでrequest全体が失敗することを避ける。`facingMode`の`user`はfront-facing、`environment`はrear-facingを意味する。[MDN: facingMode](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode)

`<video>`には`autoplay muted playsinline`を設定する。`loadedmetadata`後かつ`videoWidth > 0 && videoHeight > 0`になってからshutterをenableする。

### 9.2 Device enumeration

1. 初期stream取得後に`enumerateDevices()`を呼ぶ。
2. `kind === "videoinput"`だけを残す。
3. empty labelにはstable ordinal display labelを割り当てる。
4. current trackの`getSettings().deviceId`と照合してcurrent cameraを決定する。
5. `devicechange`対応browserではlistを再取得する。
6. `devicechange`非対応browserではcamera menuを開くたびにlistを再取得する。

### 9.3 Switch algorithm

1. `switching`へ遷移し、shutterをdisableする。
2. current frameを一時canvasへ描画し、visual placeholderにする。
3. 旧trackをstopする。
4. `{ video: { deviceId: { exact: targetId } }, audio: false }`で新streamを取得する。
5. videoへ接続し、frame ready後にplaceholderを消す。
6. 失敗時は旧deviceIdで一度だけ再取得する。
7. 成否にかかわらず最新device listを取得する。

複数switch requestを同時実行しない。transaction IDを持ち、遅れて完了した古いrequestのstreamは直ちにstopする。

## 10. Image pipeline

### 10.1 Output specification

| 項目 | 仕様 |
| --- | --- |
| MIME type | `image/png` |
| Dimensions | source frameのaspect ratioを維持し、long edgeを最大1920 pxに縮小。upscaleしない。 |
| Crop | なし |
| Metadata | Canvas再encodeによりsource metadataを引き継がない |
| Orientation | 画面上の正立方向へnormalize |
| Color | browserのCanvas出力に従う。v1では明示的color profile変換を行わない。 |

PNGを採用する理由は、Async Clipboard APIでbrowser間の共通対応が最も明確なimage formatだからである。MDNはbrowserが一般にPNG image writeを実装すると説明し、WebKitも`image/png`をsupported representationとしている。[MDN: Clipboard.write()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write) / [WebKit: Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)

### 10.2 Encode

- 一つのreusable off-DOM canvasを用いる。
- source dimensionsからtarget dimensionsを純粋関数で算出する。
- front previewのCSS transformをCanvasへ適用しない。
- `drawImage(video, 0, 0, width, height)`後に`canvas.toBlob(..., "image/png")`を呼ぶ。
- `toBlob`が`null`を返した場合は`pngEncodingFailed`とする。
- encode完了後に320 px square以内のJPEG thumbnailを別canvasで生成する。thumbnailはUI専用でありClipboardには使わない。
- 一時`ImageBitmap`を用いた場合は必ず`close()`する。

## 11. In-memory history and resource management

### 11.1 Retention policy

- userが削除しない限り、現在document内の全entryをreloadまで保持する。
- application都合のsilent evictionは行わない。
- 保持順はnewest firstとする。
- memory使用量が128 MiBを超えた時点で一度だけnon-modal warningを表示し、全消去への導線を提示する。
- memory不足によりencodeまたはallocationが失敗した場合は、既存履歴を勝手に削除せずerrorを表示する。

「reloadまで保持」は、browser processが生存し十分なmemoryを確保できる範囲のbest-effort contractである。OSによるtab eviction、browser crash、process kill後まで保持する保証はpersistent storageなしでは成立しない。

### 11.2 Object URL lifecycle

- `CaptureEntry`自体にはObject URLを格納しない。
- UI adapterが`CaptureId -> objectURL` registryを持つ。
- entry削除時、全消去時、component teardown時に`URL.revokeObjectURL()`を呼ぶ。
- 同じBlobに対してrenderごとにURLを再生成しない。
- history gridではoriginal PNGをdecodeせず、thumbnail Blobを使う。

## 12. Error UX and recovery

| Error | User-facing message | Primary recovery |
| --- | --- | --- |
| insecure context | 「安全な接続で開く必要がある」 | HTTPS URLを案内 |
| camera unsupported | 「このbrowserはcamera APIに対応していない」 | 対応browserを使用 |
| permission denied | 「cameraの使用が許可されていない」 | browser設定の確認手順を表示 |
| no camera | 「利用できるcameraが見つからない」 | 接続後に再試行 |
| camera unavailable | 「cameraを開始できない。他のappが使用中の可能性がある」 | 再試行 |
| stream ended | 「cameraとの接続が終了した」 | カメラを再開 |
| frame not ready | 「映像の準備が完了していない」 | 自動で短時間後にenable、または再試行 |
| PNG encode failure | 「画像を作成できなかった」 | 再撮影 |
| Clipboard unsupported | 「このbrowserは画像のClipboard copyに対応していない」 | 対応browserを使用 |
| Clipboard not allowed | 「Clipboardへの書込みが許可されなかった」 | 履歴から再コピー |
| generic Clipboard failure | 「撮影したが、コピーできなかった」 | 履歴から再コピー |

error画面には技術的exception messageをそのまま表示しない。development buildのdiagnostic logでも画像、deviceId全体、Blob URLを記録しない。

## 13. Accessibility

- interactive elementはnative `<button>`、camera selectorはbutton + menu、history overlayは`<dialog>`を第一候補とする。
- icon-only buttonには具体的な`aria-label`を付ける。例: 「背面カメラへ切り替え」「履歴を開く（3件）」。
- success / failureは`role="status" aria-live="polite"`へ通知する。permissionやcamera停止など操作を妨げるerrorのみ`role="alert"`を使う。
- dialogを開いたらheadingまたは最初の意味あるcontrolへfocusを移し、閉じたら起点controlへ戻す。
- keyboard focusは常に視認可能にする。[WCAG 2.2: Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- Tab / Shift+Tabで全controlへ到達でき、Enter / Spaceでbuttonをactivateでき、Escapeでmenu・dialogを閉じられる。
- global single-key shortcutは設けない。
- browser zoom 200%でcontrolやstatusがclipしない。
- device orientation変更時にcamera controlの相対位置を維持する。
- `forced-colors`ではtranslucent materialを無効化し、system colorとoutlineを使う。
- copied statusを色、flash、iconだけで伝えず、必ずtextも出す。
- live camera imageへ冗長なalt textは付けず、video elementはscreen readerのreading orderから外し、camera状態を別textで提供する。

## 14. Security and GitHub Pages deployment

### 14.1 Deployment target

| 項目 | 値 |
| --- | --- |
| Repository | [`bem130/webcam-app`](https://github.com/bem130/webcam-app) |
| Default branch | `main` |
| Pages type | project site |
| Production URL | `https://bem130.github.io/webcam-app/` |
| Build output | `dist/` |
| Publishing source | GitHub Actions |

GitHub Pagesはstatic HTML、CSS、JavaScriptをHTTPSで配信できるため、cameraとClipboard APIが要求するsecure contextを満たす。[GitHub Docs: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) `getUserMedia()`はuser permissionを常に必要とし、top-level documentまたは明示的に許可されたframeでのみrequestできる。[MDN: getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)

### 14.2 Vite base path

本siteはuser site rootではなく`/webcam-app/`配下のproject siteである。asset URLを正しく生成するため、Viteへrepository名をbaseとして明示する。

```ts
import { defineConfig } from "vite";
import preact from "@preact/preset-vite";

export default defineConfig({
  base: "/webcam-app/",
  plugins: [preact()],
});
```

Vite公式guideも`https://<USERNAME>.github.io/<REPO>/`へdeployする場合に`base: "/<REPO>/"`を要求している。[Vite: Deploying a Static Site](https://vite.dev/guide/static-deploy)

v1はclient-side routingを持たないため、GitHub Pagesのdirect navigationに対するSPA 404 fallbackは不要である。将来routingを導入する場合はhash routingまたは404 fallbackを別途設計する。

### 14.3 GitHub Actions pipeline

RepositoryのSettings → Pages → Build and deployment → Sourceを「GitHub Actions」に設定する。Viteはbuild stepを要するため、branch directoryの直接公開は採用しない。[GitHub Docs: Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

Pipelineを次の二段階に分ける。

1. **Verify:** pull requestと`main`へのpushで`npm ci`、format check、lint、TypeScript typecheck、unit test、production buildを実行する。
2. **Deploy:** `main`へのpushでVerifyが成功した場合だけ`dist/`をPages artifactとしてuploadし、`github-pages` environmentへdeployする。

Workflow contractは次のとおりである。

- `permissions`は通常`contents: read`だけとし、deploy jobだけに`pages: write`と`id-token: write`を付与する。
- `pull_request`ではbuildまで行い、deployしない。
- `concurrency.group`を`pages`へ固定し、古い未完了deployをcancelする。
- third-party Actionを使わず、GitHub公式Actionだけをimmutable commit SHAでpinする。version tagはcommentとして併記する。
- DependabotでGitHub Actionsとnpm dependencyのupdateを確認する。
- generated `dist/`を`main`へcommitしない。
- deploy失敗時に直前の成功deploymentを破壊しない。

GitHub Pagesはcustom GitHub Actions workflowによるbuildとdeploymentを正式にsupportする。[GitHub Docs: Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

### 14.4 GitHub Pagesにおけるsecurity headerの制約

GitHub Pagesではrepositoryから任意のHTTP response headerを設定できない。このため、当初想定していた`Permissions-Policy`、`X-Content-Type-Options`、`frame-ancestors`を含むheader版CSPをPages単体では保証できない。GitHub Pages利用時の明示的なhosting constraintとして受け入れる。

設定可能な範囲では、`index.html`の先頭付近に次のmeta policyを置く。

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
>
<meta name="referrer" content="no-referrer">
```

- production bundleにinline scriptとinline event handlerを含めない。
- 外部font、CDN script、analytics、remote error reporterを使わない。
- `connect-src 'none'`を維持できない追加機能はprivacy contractの変更として別途reviewする。
- CSP `meta`は、それより前に現れるresourceへ適用されないため、document先頭に置く。
- `frame-ancestors`、report-only policy、`sandbox`はCSP `meta`では利用できない。[W3C: Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- strictなresponse header制御が将来必須になった場合は、custom domainの前段proxy/CDNまたは別hostへのmigrationを設計する。

microphoneについてはapplication codeが常に`audio: false`とし、microphone APIを呼ばないことを自動testする。Pages上で`Permissions-Policy: microphone=()`を送れない点は、このapplication invariantで補う。

### 14.5 Logging

productionではcamera API failureのdomain error tagだけをmemory上で扱い、network telemetryへ送らない。console出力も原則行わない。device label、deviceId、capture時刻、Blob sizeはdiagnostic reportとして自動収集しない。

### 14.6 Static asset cache

HTML、JavaScript、CSS、Web App Manifest、icon等のapp shellは通常のHTTP cache対象としてよい。これは撮影画像の保存禁止と独立である。

PWA installにはWeb App Manifestを使い、`id`、`start_url`、`scope`をGitHub Pagesの`/webcam-app/`へ固定する。192×192 pxと512×512 pxのPNG icon、maskable icon、Apple touch iconを配信し、`display: "standalone"`で起動する。install操作はbrowser / OSの標準UIへ委ね、非標準のcustom install promptを必須経路にしない。

Service Workerはinstallabilityの必須条件ではないため導入しない。offline対応は保証せず、Service Worker cacheを撮影画像の保存経路にしないprivacy contractを維持する。[MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) / [W3C: Web Application Manifest](https://www.w3.org/TR/appmanifest/)

## 15. Browser support strategy

UA文字列やbrowser名で機能を決めず、capability detectionを使う。support contractは次の必須capabilityをすべて満たす環境とする。

1. secure context
2. `MediaDevices.getUserMedia`
3. `MediaDevices.enumerateDevices`
4. Canvas 2D + PNG Blob encode
5. `ClipboardItem`
6. `Clipboard.write`
7. `image/png` Clipboard write

`ClipboardItem.supports("image/png")`が存在する場合は事前検査に使う。存在しない場合は実際のwrite結果をtyped errorへ変換する。`devicechange`、`backdrop-filter`、`ImageBitmap`はoptional enhancementとする。

releaseごとに次のcurrent stable browserで実機確認する。

- Safari on iOS / iPadOS
- Safari on macOS
- Chrome on Android
- Chrome / Edge on Windows and macOS
- Firefox on desktop

Clipboard APIはbrowser間でpermission modelとuser activationの扱いが異なるため、「compileが通ること」をcompatibility保証としない。各engineでactual copy-and-paste testを行う。

## 16. Performance requirements

| ID | Requirement |
| --- | --- |
| NFR-01 | production JavaScript initial transferをgzip 80 KiB以下に保つことを目標とする。 |
| NFR-02 | camera permission許可からfirst live frameまで、device依存時間を除くapplication overheadを100 ms以下にする。 |
| NFR-03 | 1920 px long-edge frameのshutterからhistory追加まで、reference mobile deviceでp95 700 ms以下を目標とする。 |
| NFR-04 | copy処理中のlong taskを50 ms未満へ分割し、UI feedbackを先にpaint可能にする。 |
| NFR-05 | history gridでoriginal PNGをdecodeせずthumbnailを使う。 |
| NFR-06 | background時にvideo trackをdisableし、不要なcamera使用と電力消費を抑える。 |
| NFR-07 | layout shiftによりshutter位置を変化させない。 |

PNG encodeがmain threadを長く占有するbrowserでは、OffscreenCanvasのsupportを検査してworker encodeを将来導入できるよう`CaptureEncoder` boundaryを保つ。ただしSafariのClipboard user activationを維持するため、Clipboard write開始自体はUI event handler内に残す。

## 17. Testing strategy

### 17.1 Unit tests

- camera lifecycleの全state transition
- capture成功、copy失敗、encode失敗の分離
- historyのnewest-first追加、個別削除、全消去
- memory warning thresholdの境界値
- quick swapの一台、二台、三台以上の挙動
- device list更新時にcurrent deviceが消えた場合
- source dimensionsからtarget dimensionsへの縮小計算
- front/rear mirror decision
- 全error unionのexhaustive mapping

### 17.2 Adapter contract tests

- `getUserMedia` exception nameから`CameraError`への写像
- empty device labelのfallback
- 古いswitch transaction完了時にstreamをstopすること
- `clipboard.write()`が最初の`await`より前に呼ばれること
- copy失敗時もPNG Promise成功ならhistoryへ追加すること
- Object URLの生成回数とrevoke回数

### 17.3 Browser E2E

- manifestが読込まれ、install用metadataとiconが`/webcam-app/`配下で解決する
- 初回permission grant / deny
- cameraが一台、二台、三台以上
- USB cameraの接続・切断
- cameraを他appが使用中
- portrait / landscape切替
- background → foreground復帰
- shutter連打時にtransactionが重複しない
- Notes、chat app、image editor等へPNGを実際にpasteできる
- reload後にhistoryが空である
- reload後もOS Clipboardに画像が残り得ることは正常とする
- DevTools Networkで撮影後のrequestが一件も発生しない
- browser storage inspectionで画像dataが存在しない

### 17.4 Accessibility and visual QA

- iOS / macOS VoiceOver
- keyboard-only navigation
- 200% zoom
- `prefers-reduced-motion`
- light / dark appearance
- forced colors
- 320 × 568、390 × 844、768 × 1024、1280 × 800 viewport
- 明るいpreview、暗いpreview、複雑なpreviewの上でcontrol contrastを確認

## 18. Acceptance criteria

v1は次をすべて満たした時点で完成とする。

- [ ] 初期画面からuser actionでcameraを開始できる。
- [ ] microphone permissionを要求しない。
- [ ] shutter一回でPNGがClipboardへ入り、別appへpasteできる。
- [ ] 撮影成功・copy失敗時に画像が履歴へ残る。
- [ ] camera quick swapとcamera一覧選択が機能する。
- [ ] 全履歴がreloadまでmemory上に残り、reload後は空になる。
- [ ] 個別削除と全消去で対応Object URLがrevokeされる。
- [ ] camera frameをnetwork、persistent storage、downloadへ書き込まない。
- [ ] hidden時にcamera trackをdisableし、document破棄時にstopする。
- [ ] Safari / Chromium / Firefoxの対象versionでactual image pasteを確認する。
- [ ] keyboard、VoiceOver、reduced motion、200% zoomのtestを通す。
- [ ] production `index.html`でmeta CSPとreferrer policyが有効であり、inline script / inline styleを含まない。
- [ ] TypeScript、lint、unit、integration、E2E testをCIで通す。
- [ ] `https://bem130.github.io/webcam-app/`でasset、camera、Clipboard copyが動作する。
- [ ] Chromium、iOS / iPadOS、macOS Safariの標準UIからinstallでき、standaloneで起動する。
- [ ] PWA install後もService Worker、Cache Storage、永続的な撮影履歴を作らない。
- [ ] `vite.config.ts`の`base`が`/webcam-app/`である。
- [ ] pull requestではdeployせず、`main`のverified buildだけをPagesへdeployする。
- [ ] GitHub Pagesでは設定不能なsecurity headerとmeta CSPの保証範囲が文書化されている。

## 19. Implementation plan

### Stage 1: Platform spike

- camera開始、Canvas PNG encode、Clipboard writeを一画面で接続する。
- Safari user activation patternを実機検証する。
- output orientationとfront preview mirrorを確認する。
- 完了条件: iOS Safari、desktop Safari、Chromiumで一回のtapから画像pasteまで成功する。

### Stage 2: Core and lifecycle

- typed state、error union、camera selection、capture transactionを実装する。
- fake adapterによるunit testを整備する。
- 完了条件: errorとstate transitionの全branchがtestされる。

### Stage 3: HIG-based UI

- responsive camera view、control、feedback、history sheet / side panelを実装する。
- accessibility semanticsとfocus managementを加える。
- 完了条件: target size、contrast、keyboard、VoiceOverのacceptance criteriaを満たす。

### Stage 4: Privacy and hardening

- meta CSP、no-network assertion、storage inspection、resource cleanupを検証する。
- multi-camera、background、device removal、memory warningをtestする。
- GitHub Actionsのverify / deploy workflowを整備し、GitHub Pages上で実機確認する。
- 完了条件: privacy contractと全acceptance criteriaを満たし、production URLで正常動作する。

## 20. Design decisions

| Decision | 採用 | 理由 |
| --- | --- | --- |
| Image format | PNG | image Clipboard writeのengine間共通性を優先する。 |
| Persistence | なし | 明示要件。履歴はcurrent document memoryだけに置く。 |
| History eviction | silent evictionなし | 「reloadまで残る」という期待を優先する。memory warningは出す。 |
| Capture API | video + Canvas | `ImageCapture.takePhoto()`よりbrowser supportと挙動の一貫性を優先する。 |
| Preview fit | contain | 出力に含まれる全範囲をpreviewで見せる。 |
| Front mirror | previewのみ | selfie操作の自然さと出力内文字の正方向を両立する。 |
| Framework | Preact | declarative UIと小さいbundleの均衡を取る。 |
| Native/Wasm core | 採用しない | platform-dependent I/Oが支配的で、追加境界の利益が小さい。 |
| Service Worker | 採用しない | v1の機能に不要で、保存契約の説明を単純に保てる。 |
| PWA install | Manifestのみ | installabilityを提供しつつ、offline cacheとcustom promptをscope外に保つ。 |
| Analytics | 採用しない | 画像utilityのprivacy surfaceを最小化する。 |
| Hosting | GitHub Pages | backend不要のstatic appに適合し、HTTPS secure contextを提供する。 |
| Pages publishing | GitHub Actions | Vite buildと検証を通過したartifactだけを公開する。 |
| Vite base | `/webcam-app/` | project siteのsubpathでasset URLを正しく解決する。 |
| Security policy | meta CSP + application invariant | Pages単体ではcustom response headerを設定できない制約に対応する。 |

## 21. References

- [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines)
- [Apple HIG: Privacy](https://developer.apple.com/design/human-interface-guidelines/privacy)
- [Apple HIG: Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Apple HIG: Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)
- [Apple HIG: Menus](https://developer.apple.com/design/human-interface-guidelines/menus)
- [MDN: MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MDN: MediaDevices.enumerateDevices()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices)
- [MDN: MediaTrackConstraints.facingMode](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/facingMode)
- [MDN: Clipboard.write()](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard/write)
- [WebKit: Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)
- [W3C: Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)
- [WCAG 2.2: Contrast Minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [WCAG 2.2: Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [WCAG 2.2: Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)
- [Apple Support: Universal Clipboard](https://support.apple.com/en-hk/102430)
- [bem130: 私のソフトウェアの設計指針](https://zenn.dev/bem130/articles/1b352797de94e7)
- [GitHub Docs: What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [GitHub Docs: Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub Docs: Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
- [Vite: Deploying a Static Site](https://vite.dev/guide/static-deploy)
- [W3C: Content Security Policy Level 3](https://www.w3.org/TR/CSP3/)
- [MDN: Making PWAs installable](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
- [W3C: Web Application Manifest](https://www.w3.org/TR/appmanifest/)
