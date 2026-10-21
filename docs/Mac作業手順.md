# 家計簿 Mac 作業手順（ストア版を自分の iPhone に入れて確かめる）

この文書は **Mac の Claude と本人が読む**。Windows の `~/.claude`（共通ルール・スキル）は Mac に無いので、要ることはここに全部書く。
仕様の正本は同じ zip に入っている `仕様書.md`（D19・D23〜D25 と 2章「ストア版の下準備」）。

## 0. この作業の決まり

- 目的：Capacitor（Web アプリを iPhone アプリの入れ物に入れる道具）で包んだストア版を、**無料の Apple ID（Personal Team）で自分の iPhone に入れて**、動くかを確かめる（仕様書 D19）。App Store への提出はしない。
- **Mac の Claude がその場で直してよい**（2026-10-22 本人決定）。直したら**その日のうちに** §6 の戻し用 zip で Windows へ戻す。正本は Windows 側の Git。戻し忘れると、次に Windows で書いた分と食い違う。
- 直してよい場所は `app/`（アプリ本体。PWA と共通）と `ios/App/App/`（Xcode の入れ物）。`仕様書.md` の決定（1章）は変えない。仕様と違う動きにしたくなったら直さずに本人に聞く。
- `app/` を直したら、**必ず §4.3 の1行で `ios/App/App/public/` へ写してから** Xcode の ▶ を押す（iPhone に入るのは `public/` のほう）。
- 記録（家計の中身）を外へ送る機能を足さない（`CLAUDE.md` の決まり）。

## 1. 持っていくもの（Windows の Claude が作る）

`家計簿_<日付>_Mac用.zip`（Windows の `C:/Users/kouri/Desktop/家計簿/` 直下）。中身：

| 場所 | 中身 |
|---|---|
| `app/` | アプリ本体 |
| `ios/` | Xcode の入れ物。`ios/App/App/public/` に `app/` の写しが入った状態（Windows で `npx cap sync ios` 済み） |
| `node_modules/@capacitor/filesystem`・`share` | 保存と共有シートの部品。`ios/App/CapApp-SPM/Package.swift` がこの場所を名指しで読む（**消さない・動かさない**） |
| `package.json`・`capacitor.config.json`・`CLAUDE.md`・`仕様書.md`・`docs/Mac作業手順.md` | 設定と書類 |

Mac に Node.js は要らない（`npm install` しない）。ただし初回のビルドで Xcode が Capacitor 本体（`capacitor-swift-pm` 8.5.3）を GitHub から取ってくるので、**インターネット接続が要る**。

## 2. Mac で最初にやること

1. zip をホーム（`~`）で展開する。zip の中は `kakeibo/` フォルダ1つなので `~/kakeibo` ができる（**フォルダ名に日本語と空白を入れない**ため、この名前にしてある）。`~/kakeibo/ios/App/App.xcodeproj` があることを確かめる。前の版の `~/kakeibo` があるときは、直したまま戻していない分が無いかを先に確かめてから展開する（上書きされる）。
   ```bash
   cd ~ && unzip -o ~/Downloads/家計簿_*_Mac用.zip && ls kakeibo/ios/App
   ```
2. Xcode の場所の確認：
   ```bash
   xcode-select -p
   ```
   `/Applications/Xcode.app/Contents/Developer` なら正解。`/Library/Developer/CommandLineTools` なら `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`。

## 3. 切り分けの段（iPhone も Apple ID も要らない）

署名を省いてコンパイルだけ通す。ここで落ちたら「入れ物・部品の側」の問題、通ったのに iPhone で落ちたら「署名か iPhone の側」の問題と分けられる。

```bash
cd ~/kakeibo/ios/App && xcodebuild -project App.xcodeproj -target App -sdk iphoneos -configuration Debug CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" build 2>&1 | tail -30
```

最後に `** BUILD SUCCEEDED **` が出れば通過。Swift Package（部品）の取得に数分かかる。
落ちたら、最後の30行を**全文**残して §5 を見る。

## 4. iPhone に入れる

### 4.1 Xcode での署名

1. `open ~/kakeibo/ios/App/App.xcodeproj` で開く（`.xcworkspace` ではなく `.xcodeproj`。部品は CocoaPods でなく Swift Package Manager で入る形のため）。
2. 左の一覧のいちばん上「App」→ TARGETS の「App」→ **Signing & Capabilities**。
3. **Automatically manage signing** にチェック → **Team** で自分の Apple ID（Personal Team）。Apple ID が一覧に無ければ **Xcode > Settings > Apple Accounts** で足す。
4. Bundle Identifier は `io.github.qorigame256.kakeibo`（仕様書 D22）。**重複と言われたら**末尾に `.dev` を足して `io.github.qorigame256.kakeibo.dev` にし、以後はそれを使い回す（無料 Apple ID は App ID を7日で10個までしか作れない）。変えたら §7 の結果に書く。
5. 左の一覧に「Update to recommended settings」が出ても**押さない**（Capacitor が作った設定が書き換わる）。
6. 上の実行先で**ケーブルで繋いだ実機**を選ぶ（機種名だけの項目はシミュレータ）→ ▶。

### 4.2 iPhone 側の関門（初回だけ・この順に出る）

1. **デベロッパモード**：設定 > プライバシーとセキュリティ > デベロッパモード をオン → 再起動 → 再起動後の確認で「オンにする」。この項目は Mac に繋いで一度 ▶ を試すまで現れない。
2. **デバイスの準備**：Xcode に `Preparing iPhone for development...`。数分〜十数分。ケーブルを抜かない。
3. **デベロッパを信頼**：設定 > 一般 > VPNとデバイス管理 > 自分の Apple ID > 信頼（インターネット接続が要る）。

実行中は iPhone のロックを解いたままにする。

### 4.3 `app/` を直したあと

```bash
cd ~/kakeibo && rsync -a --delete --exclude 'cordova.js' --exclude 'cordova_plugins.js' app/ ios/App/App/public/
```

（Windows の `npx cap copy ios` と同じ結果になる。`cordova.js`・`cordova_plugins.js` は Capacitor が `public/` に置く空に近いファイルで、`app/` には無いので消さないよう外している）
そのあと Xcode で ▶。

## 5. うまくいかないとき

| 症状 | 疑うところ |
|---|---|
| 部品の取得で失敗（`capacitor-swift-pm` や `Package resolution`） | インターネット接続。Xcode の File > Packages > Reset Package Caches → ▶ |
| `no such module 'Capacitor'` など、部品が見つからない | `node_modules/@capacitor/filesystem`・`share` が zip から展開されているか（`ls ~/kakeibo/node_modules/@capacitor`） |
| `requires that Developer Mode be enabled` | §4.2 の1 |
| 入ったが開くとすぐ閉じる／「信頼されていないデベロッパ」 | §4.2 の3。前に信頼していても、署名の Apple ID が違うともう一度出る |
| 白い画面のまま | Safari の 開発 > （iPhone の名前）> 家計簿 で中のブラウザのエラーを見る（Mac の Safari で 設定 > 詳細 >「Web デベロッパ用の機能を表示」、iPhone で 設定 > アプリ > Safari > 詳細 > Web インスペクタ をオン） |
| `The maximum number of apps for free development profiles has been reached.` | 無料の枠は1台に3本まで。使っていない自作アプリを消す |
| 7日ほどで起動しなくなった | 無料 Apple ID の制限。Mac に繋いで ▶ を押せば直る（データは残る） |

## 6. 確かめること

iPhone 15 Pro（縦向き）で。「済」「だめ（何がどうなったか）」を §7 に書く。

1. **起動**：アイコンが緑地に白い「¥」、下の名前が「家計簿」。起動画面のあと入力タブが出る。上（時刻の帯）と下（ホームバー）に画面が隠れていない。
2. **保存（D24）**：記録を2件入れる → アプリを上へ払って完全に閉じる → 開き直す → 2件残っている。設定タブの分類の名前変更・予算も同じく残る。
3. **書き出し（D25）**：設定 > バックアップ > 書き出し → 共有シートが開く →「"ファイル"に保存」で保存できる。設定の「最後に書き出した日」が今日になる。
4. **読み込み**：3 で保存したファイルを、設定 > バックアップ > 読み込み で選べる（ファイルを選ぶ画面が開くか）。同じものなので記録は増えない。
5. **ランキングのコードを送る**：ランキングタブ > 送る → 名前を入れる → 送る内容 → 共有シートが開き、LINE やメモに文章が渡る。
6. **電波なし**：機内モードにして閉じて開き直す → ふつうに使える。
7. **数字キーボード**：金額の欄を押すと数字のキーボードが出る。
8. **ダーク**：iPhone をダークモードにすると画面の色が変わる。
9. **横向き**（気づいたことだけ）：iPhone を横にしたときの見え方。今の入れ物は iPhone の横向きと iPad も許している（Capacitor の初期値のまま。どうするかは未決ではなく、まだ誰も決めていない）。崩れていても直さず、様子だけ書く。

## 7. 結果の書き方と戻し方

1. `~/kakeibo/docs/Mac確認結果.md` に書く（あれば上書き）。中身：日付、Mac の macOS と Xcode の版（Xcode > About Xcode）、iPhone の iOS の版、§3 の結果、§6 の1〜9の結果、直したファイルと理由、エラーは全文。
2. 何か直したとき、または結果を書いたら、戻し用の zip を作る：
   ```bash
   cd ~ && zip -r ~/Desktop/家計簿_$(date +%Y-%m-%d)_Mac戻し.zip kakeibo/app kakeibo/ios/App/App kakeibo/docs -x '*/.DS_Store' 'kakeibo/ios/App/App/public/*'
   ```
3. 持っていったときと同じ手段で Windows へ渡す。Windows の Claude は、中身を今の Git と比べて（`diff -r`）から `app/`・`ios/App/App/` を上書きし、結果を `仕様書.md` 2章「ストア版の下準備」に移して `Mac確認結果.md` は消す。
