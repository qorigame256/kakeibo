# 家計簿

自分の家計を iPhone で記録する個人用 PWA。素の HTML/CSS/JS（ビルドなし・外部ライブラリなし）。
仕様の正本は `仕様書.md`。ファイル構成もそちらの4章。

## 決まり

- 記録は端末の中（localStorage）だけ。外部サービスへ送る機能を足すときは本人に確認する。
- ランキングのコード（`app/ranking.js` の `computeCard`）に入れるのは名前と計算した数字だけ。記録の中身（日付・メモ・分類・個々の金額）を足さない（仕様書 D30。友だちに渡る中身はこれだけと約束しているため）。
- **保存の読み書きは `app/store.js` に閉じ込める。** あとで App Store 用に包むとき（仕様書 D24）に保存先を差し替える場所を1か所にするため。
- **分類の `id` を変えない・使い回さない。** 記録は `cat` の id で分類と結び付いている。分類の削除は `deleted: true` の印だけ（データから消すと過去の記録の分類名が出なくなる）。
- 公開先は `https://qorigame256.github.io/kakeibo/`（リポジトリ `qorigame256/kakeibo`）。main へ push すると `.github/workflows/pages.yml` が `app/` だけを公開する。アカウント・作者・push の決まりは共通ルール「GitHub Pages で公開するとき」。
- 動作確認は `.claude/launch.json` の `app`（`node tools/serve.js`、http://localhost:8766/。使用中なら自動で別の番号）をブラウザ画面で開き、iPhone 幅（375px）で見る。
- サービスワーカー（`app/sw.js`）は「保存済みの版を先に出し裏で更新」方式。ファイルを足したら `FILES` にも足す。中身を変えて公開するときは `CACHE` の版数を上げる。
