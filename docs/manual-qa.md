# Release manual QA

自動テストでは OS Clipboard、実カメラ、browser permission UI、VoiceOver の end-to-end 動作を完全には検証できない。release candidate を production 相当の HTTPS URL へ配信し、以下を記録する。

## 対象環境

- Safari on iOS / iPadOS
- Safari on macOS
- Chrome on Android
- Chrome / Edge on Windows and macOS
- Firefox on desktop

各環境について browser/OS version、端末、実施日、結果、既知の差異を release note に残す。

## PWA install

- [ ] Chrome / Edge desktopでbrowser標準のinstall UIが表示され、installできる。
- [ ] Chrome on Androidでbrowser menuからinstallまたはホーム画面追加ができる。
- [ ] iOS / iPadOSの共有menuからホーム画面へ追加できる。
- [ ] Safari on macOSの共有menuからDockへ追加できる。
- [ ] installed appがstandalone表示で`/webcam-app/`から起動する。
- [ ] installed appでcamera開始、capture、actual pasteが動作する。
- [ ] installed appをreloadすると撮影履歴が消える。
- [ ] offlineで再読込みした場合はoffline対応を装わず、browser / OS標準のnetwork errorになる。
- [ ] iconがcircle、squircle、rounded rectangleでmaskされてもcamera symbolが欠けない。

## Camera と Clipboard

- [ ] 初期表示だけでは camera permission が要求されない。
- [ ] 「カメラを開始」の操作により permission が要求され、microphone permission は要求されない。
- [ ] rear camera が利用可能な端末では初期候補になり、preview は crop されない。
- [ ] front camera の preview だけが mirror 表示され、copy/paste した PNG は mirror されない。
- [ ] shutter 一回で PNG が Clipboard へ入り、Notes、chat app、image editor へ実際に paste できる。
- [ ] copy の成功・失敗が text と screen reader live region で判別できる。
- [ ] Clipboard permission を拒否しても画像が履歴へ残り、「再コピー」が動作する。
- [ ] camera が一台のとき quick swap が表示されない。
- [ ] camera が二台・三台以上のとき quick swap と一覧選択が動作する。
- [ ] switch 失敗時に元の camera へ戻り、戻せない場合は「カメラを再開」が表示される。
- [ ] USB camera の接続・切断後に一覧と状態が更新される。
- [ ] 他 app が camera を使用中の error と回復操作が理解できる。

## 履歴と privacy

- [ ] history は newest first で、時刻、dimensions、概算 size を表示する。
- [ ] 個別削除と確認付き全消去が動作する。
- [ ] reload 後に history が空になる（OS Clipboard に画像が残る場合は正常）。
- [ ] DevTools Network を capture 前に clear し、capture/re-copy/delete 後に request が発生しない。
- [ ] Application/Storage inspection で画像 data、Service Worker、Cache Storage が存在しない。
- [ ] tab を background にすると camera indicator が停止または suspend 状態になり、復帰できる。
- [ ] tab close/page navigation 後に camera indicator が消える。

## Accessibility と layout

- [ ] keyboard の Tab / Shift+Tab で全 control に到達し、focus ring が見える。
- [ ] Enter / Space で button を実行し、Escape で menu/dialog を閉じられる。
- [ ] iOS/macOS VoiceOver で camera 状態、button 名、成功・失敗、dialog heading が読まれる。
- [ ] browser zoom 200% で control/status が clip または overlap しない。
- [ ] `prefers-reduced-motion: reduce` で capture flash と decorative motion が抑制される。
- [ ] forced colors で text、focus、control boundary を判別できる。
- [ ] 320×568、390×844、768×1024、1280×800 と portrait/landscape で shutter 位置が安定する。
- [ ] 明るい・暗い・複雑な preview 上で control/text の contrast が保たれる。

## Production deployment

- [ ] `npm ci`、`npm run verify`、`npm run test:e2e` が clean checkout で成功する。
- [ ] pull request workflow では deploy job が skip される。
- [ ] `main` の成功 workflow だけが GitHub Pages artifact を deploy する。
- [ ] production `index.html` の asset URL が `/webcam-app/` 配下で解決する。
- [ ] production HTML の resource より前に meta CSP と referrer policy があり、inline script/style がない。
- [ ] production URL で camera、capture、actual paste が動作する。
