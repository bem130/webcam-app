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
- [ ] `ImageCapture`対応cameraではdefaultの「写真優先」が選ばれ、history detailsのactual routeが「写真API」になる。
- [ ] 「動画フレーム」を選ぶと写真APIを呼ばず、actual routeが「動画フレーム」になる。reload後はdefaultの「写真優先」へ戻る。
- [ ] 写真API非対応cameraでは「写真優先」がdisabledになり、video-frame captureが完全に利用できる。
- [ ] 写真API失敗時は通常UIを不要なwarningで塞がずvideo frameへfallbackし、history detailsでactual routeを確認できる。
- [ ] native JPEG等はhistoryでnative MIMEを維持し、ClipboardへはPNGとして実際にpasteできる。
- [ ] 3000×4000と2448×3264を含むAndroid実機でstage durationとshutter-relative milestoneを記録し、native artifact、Clipboard用PNG変換、representation ready、browser / OS Clipboard処理、thumbnailを区別できる。
- [ ] 3000×4000の動画フレームで`動画フレーム取得`、`Worker handoff`（baselineでは未実行）、`raster準備`、`PNG encode`を記録し、旧`動画フレームPNG` 5035 msの内訳を確定する。
- [ ] 通常URLの3000×4000動画フレームで「動画処理経路」が`Worker OffscreenCanvas (2D)`となり、`動画フレーム取得`、`Worker handoff`、`raster準備`、`PNG encode`を記録できる。
- [ ] 同じbuildを`?videoFramePipeline=canvas`付きで開くと「動画処理経路」が`main-thread Canvas`となり、Worker handoffは未実行になる。画像や診断選択はreloadを越えて保存されない。
- [ ] Worker経路とCanvas baselineで、Clipboard完了までの時間を同じcamera、同じ3000×4000、近い被写体条件で各3回以上測定する。固定ms thresholdではなく中央値とstage構成を比較する。
- [ ] 連続する高解像度capture後も前回の巨大canvas backing storeが保持されず、memory allocation failure時に同じframeをmain-thread Canvasで再試行しない。
- [ ] 3000×4000 native still routeの約3秒という変更前baselineと同じcamera・解像度で比較し、Worker route / fallback routeと各stageを記録する。
- [ ] copy の成功・失敗が text と screen reader live region で判別できる。
- [ ] copy成功通知が390×844でshutterやcamera selectorへ重ならず左下に表示され、約3秒で消える。error / warningは手動で閉じるまで確認できる。
- [ ] Clipboard permission を拒否しても画像が履歴へ残り、「再コピー」が動作する。
- [ ] camera が一台のとき quick swap が表示されない。
- [ ] camera が二台・三台以上のとき quick swap と一覧選択が動作する。
- [ ] switch 失敗時に元の camera へ戻り、戻せない場合は「カメラを再開」が表示される。
- [ ] USB camera の接続・切断後に一覧と状態が更新される。
- [ ] 他 app が camera を使用中の error と回復操作が理解できる。

### Phase 3.6 Android実測記録

2026-08-29、Chrome 150 / Android 10 / 3000×4000で通常URLのWorker 2Dを2回測定した。Clipboard完了は3093 msと2620 ms、Worker PNG encodeは1580 msと1682 msで、main-thread baselineの10862 ms / 9774 msから大幅に短縮した。履歴のactual processing routeはいずれも`Worker OffscreenCanvas (2D)`であり、fallbackは発生していない。追加の端末・被写体条件では上記checklistに従い3回以上の中央値を継続記録する。

## Camera lifecycle

- [ ] camera開始後、`pointerdown`、`keydown`、`wheel`が10秒未満に発生すればidle timerがresetされる。`pointermove`だけではresetされない。
- [ ] 10秒間操作しないとcamera indicatorが消え、全trackが終了し、全画面screensaverに「操作がなかったため、カメラを解放しました。」と表示される。
- [ ] screensaver上で元のshutter位置をtapしても撮影されず、直前のcameraを優先した再取得だけが一度発生する。
- [ ] screensaverは`pointerdown`、`keydown`、`wheel`で再開し、`pointermove`では再開しない。再開後はkeyboard focusがshutterへ戻る。
- [ ] 320×568とsafe area付きviewportでscreensaverが全画面を覆い、背後のcontrolが露出または操作されない。
- [ ] OSのreduced motion設定時もscreensaverにtransition / animationがなく、screen readerが停止状態と再開中statusを読み上げる。
- [ ] camera permission拒否またはdevice消失で再開に失敗した場合、回復可能なerror UIと「カメラを再開」buttonが表示される。
- [ ] native still取得中またはvideo-frame PNG生成中に10秒境界へ達してもcameraを途中停止せず、source artifact完成後から新しい10秒を計る。
- [ ] Clipboard settlementまたはthumbnail生成が継続中でも、camera source完成後のidle timeoutでcameraを停止できる。
- [ ] documentをbackgroundへ移すと直ちに全trackが終了し、visibleへ戻しただけではcameraを自動再取得しない。
- [ ] background停止後は「アプリがバックグラウンドになったため、カメラを解放しました。」と表示され、明示的な再開が動作する。

## 履歴と privacy

- [ ] history は newest first で、時刻、dimensions、概算 size、actual route、MIMEを表示する。
- [ ] 個別削除と確認付き全消去が動作する。
- [ ] reload 後に history が空になる（OS Clipboard に画像が残る場合は正常）。
- [ ] DevTools Network を capture 前に clear し、capture/re-copy/delete 後に request が発生しない。
- [ ] Application/Storage inspection で画像 data、Service Worker、Cache Storage が存在しない。
- [ ] `localStorage`には`camera-clipboard.preferences`だけが存在し、payloadが`version`、`idleTimeout`、`capturePreference`だけである。
- [ ] tab を background にすると camera indicator が停止または suspend 状態になり、復帰できる。
- [ ] tab close/page navigation 後に camera indicator が消える。

## Settings

- [ ] camera画面の「設定を開く」からtop-layer modalを開き、Escapeとclose buttonで閉じられる。
- [ ] 自動停止の`10秒`、`30秒`、`1分`、`3分`、`5分`、`10分`、`自動停止しない`をすべて選択できる。
- [ ] `自動停止しない`ではcameraをその場で停止せず、10分以上操作しなくてもidle停止しない。
- [ ] timeout変更後は新しい時間でtimerが再開し、設定modalを開いたままtimeoutした場合もmodalが閉じてscreensaverが全面に出る。
- [ ] 撮影方式と自動停止時間がreload後とinstalled PWAで復元される。同じoriginのtabとPWAで共有され得ることを確認する。
- [ ] 写真API非対応cameraではeffective表示が動画フレームでも、保存済みの写真優先設定が暗黙に書き換わらない。
- [ ] Web Storage拒否またはquota errorを再現してもcamera開始と撮影が動作する。

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

- [x] `npm ci`、`npm run verify`、`npm run test:e2e` が clean checkout で成功する。
- [x] pull request workflow では deploy job が skip される。
- [x] `main` の成功 workflow だけが GitHub Pages artifact を deploy する。
- [x] production `index.html` の asset URL が `/webcam-app/` 配下で解決する。
- [x] production HTML の resource より前に meta CSP と referrer policy があり、inline script/style がない。
- [ ] production URL で camera、capture、actual paste が動作する。

### Phase 8 automated release verification（2026-08-30）

clean `npm ci`は209 package / 0 vulnerability、`npm run verify`は27 test file / 142 unit・integration testとPlaywright 60 case（34 pass / 26 capability skip）を完了した。production buildはinitial JavaScript 68.09 kB（gzip 22.50 kB）、Worker 3.32 kB、CSS 13.27 kB（gzip 3.65 kB）、`index.html` 1.19 kBだった。

production URL、Manifest、192 / 512 / maskable iconはHTTP 200で、Manifestの`id` / `start_url` / `scope`は`/webcam-app/`、`display`は`standalone`だった。HTMLのbase path、meta CSP、`connect-src 'none'`も確認した。検証環境には接続済みbrowserがなかったため、rendered production UI、PWA install、実camera / Clipboard、Safari / Firefox fallback、VoiceOverは未実施であり、上記checklistを完了扱いにしていない。
