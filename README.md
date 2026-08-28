# Camera Clipboard

Camera Clipboard は、カメラの現在フレームを一度の操作で PNG として Clipboard へコピーする、ブラウザだけで動作する小さなユーティリティです。撮影画像はサーバー、写真ライブラリ、ファイル、ブラウザの永続ストレージへ保存せず、履歴は現在のタブのメモリだけに保持します。

設計の詳細は [docs/design.md](docs/design.md) を参照してください。

## 主な機能

- ユーザー操作によるカメラ開始と live preview
- shutter 一回で PNG を Clipboard へコピー
- コピーに失敗しても残る in-memory 履歴と再コピー
- カメラ一覧からの選択と quick swap
- 個別削除、確認付き全消去、Object URL の即時 revoke
- background 時の camera suspend と document 破棄時の track stop
- mobile bottom sheet / desktop side panel の responsive UI
- keyboard、screen reader、reduced motion、forced colors への対応
- browser / OS の標準 UI からの PWA install

## PWA install

Production URLをHTTPSで開き、browser / OSの標準UIからinstallできます。

- Chrome / Edge desktop: address barのinstall icon、またはbrowser menuのinstall項目を使う。
- Chrome on Android: browser menuの「ホーム画面に追加」またはinstall項目を使う。
- iOS / iPadOS: browserの共有menuから「ホーム画面に追加」を選ぶ。
- Safari on macOS: 共有buttonから「Dockに追加」を選ぶ。

install後はstandalone windowで起動します。camera permissionとClipboardの扱い、reloadで履歴が消えるprivacy contractはbrowser tabで使う場合と同じです。Service Workerとoffline cacheは導入していないため、初回起動や再読込みにはnetwork接続が必要です。

## Privacy contract

アプリケーションコードは撮影画像を次の場所へ書き込みません。

- application server または third-party server
- `localStorage`、IndexedDB、Cache Storage、OPFS
- filesystem、download folder、写真ライブラリ
- analytics、telemetry、remote error reporter、console log

許可する保持先は、現在の document に属するメモリと、ユーザー操作で書き込む system Clipboard だけです。再読み込み後に履歴を復元しません。OS の Clipboard 履歴、device 間 Clipboard 同期、swap、crash dump は OS/browser 側の責任範囲です。

カメラ要求では常に `audio: false` を指定し、microphone permission を要求しません。

## 開発

Node.js 24.14.1 以上の Node 24、npm 11 を推奨します。

```powershell
npm.cmd ci
npm.cmd run dev
```

Vite の development URL は通常 `http://localhost:5173/webcam-app/` です。Camera と Clipboard API には secure context が必要ですが、localhost は開発用 secure context として扱われます。

### 検証

```powershell
npm.cmd run verify
npx.cmd playwright install chromium firefox webkit
npm.cmd run test:e2e
```

`verify` は format、lint、strict TypeScript、unit/integration test、production build を実行します。E2E は初期 permission UX、axe による WCAG A/AA 検査、small viewport、Chromium fake camera による capture/copy/history/no-network/no-storage/reload を確認します。

実機の camera/Clipboard/assistive technology は browser automation だけでは保証できません。release 前に [手動 QA](docs/manual-qa.md) を対象端末で実施してください。

## Production build と配信

```powershell
npm.cmd run build
```

出力は `dist/` です。Vite の `base` は GitHub project site 用の `/webcam-app/` に固定しています。GitHub repository の Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定すると、`main` の verified build だけが `https://bem130.github.io/webcam-app/` へ配信されます。Pull request は検証だけを行い、deploy しません。

workflow は GitHub 公式 actions のみを full commit SHA で固定し、deploy job だけへ Pages/OIDC の write permission を付与します。依存更新は Dependabot が確認します。

## GitHub Pages の security 制約

GitHub Pages では repository から任意の HTTP response header を設定できません。そのため `Permissions-Policy`、`X-Content-Type-Options`、`frame-ancestors` を含む header 版 CSP は保証できません。

代わりに production HTML の先頭で meta CSP と `referrer=no-referrer` を設定し、`connect-src 'none'`、外部 script/font/analytics 禁止、`audio: false`、no-network/no-storage test を application invariant として維持します。将来 response header が必須になった場合は、header を設定できる host または前段 CDN への移行が必要です。

## License

[MIT License](LICENSE)
