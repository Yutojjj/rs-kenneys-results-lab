# Firebase実験プロジェクトの作成手順

## 1. Firebaseプロジェクトを作る

1. Firebase Consoleを開く
2. 「プロジェクトを追加」を押す
3. プロジェクト名を `rs-kenneys-results-lab` にする
4. Google Analyticsは実験中は無効でも問題ありません
5. プロジェクトを作成する

## 2. Webアプリを登録する

1. プロジェクトの概要から `</>` を押す
2. アプリ名を `RS Kenneys Results Lab` にする
3. Firebase Hostingは選択しない
4. 表示された `firebaseConfig` の値を控える

## 3. Cloud Firestoreを作る

1. 「構築」から「Firestore Database」を開く
2. 「データベースの作成」を押す
3. 本番環境モードを選ぶ
4. ロケーションはアプリ利用者に近いものを選ぶ
5. 作成後「ルール」を開く
6. このプロジェクトの `firestore.rules` の内容を貼り付けて公開する

最初の同期時に次の場所が自動作成されます。

```text
boards/rs-kenneys-results-lab
boards/rs-kenneys-results-lab/recordChunks/chunk-0
```

## 4. Storageを作る

1. 「構築」から「Storage」を開く
2. 「始める」を押す
3. Firestoreと同じ地域を選ぶ
4. 作成後「ルール」を開く
5. このプロジェクトの `storage.rules` の内容を貼り付けて公開する

選手画像は `member-images` フォルダへ保存されます。

## 5. ローカル設定を作る

`.env.example` を複製して `.env.local` に名前を変え、Webアプリ登録時の値を入力します。

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_BOARD_ID=rs-kenneys-results-lab
VITE_SWIM_RESULTS_PROXY_URL=/api/swim-results
```

## 6. Vercelにも同じ値を登録する

1. Vercelで新しいプロジェクトを作る
2. Framework Presetは `Vite` を選ぶ
3. SettingsのEnvironment Variablesを開く
4. `.env.local` と同じ `VITE_` で始まる8項目を登録する
5. 保存して再デプロイする

外部結果フィードが確定したら、サーバー用の `SWIM_RESULTS_FEED_URL` もVercelへ追加します。この値は `VITE_` を付けず、ブラウザへ公開しません。

今回受け取ったFirebase設定は、このフォルダの `.env.local` に入力済みです。`.env.local` はGit対象外なので、GitHubへは公開されません。Vercelには上記手順で同じ値を個別登録してください。

開催前大会を自動反映するフィードは、次のような `upcomingMeets` を返す必要があります。

```json
{
  "records": [],
  "upcomingMeets": [
    {
      "date": "2026/08/01",
      "name": "大会名",
      "place": "会場名",
      "entries": [
        {
          "team": "RSケーニーズ",
          "swimmer": "選手名",
          "gender": "男子",
          "event": "男子 50m 自由形"
        }
      ]
    }
  ]
}
```

## 7. 公開書き込みについて

同梱ルールは認証なしで誰でも閲覧・書き込みできます。URLを知る第三者も記録の変更や画像アップロードができるため、この運用方針を変更する場合はFirebase Authenticationまたはサーバー経由の書き込みへ切り替えます。

Firebase Consoleの初期ルールにある `allow read, write: if false;` のままではアプリは動きません。Firestoreには `firestore.rules`、Storageには `storage.rules` の内容を貼り付けて「公開」を押してください。
