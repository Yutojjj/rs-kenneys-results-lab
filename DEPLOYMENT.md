# GitHub Desktop / Vercel デプロイ手順

## GitHub Desktop

1. `C:\Users\syado\rs-kenneys-results-lab` を既存リポジトリとして追加する
2. Changesに `.env.local` が表示されていないことを確認する
3. Summaryへ `Initial RS Kenneys results lab` と入力してCommit to mainを押す
4. Publish repositoryを押す
5. 個人情報を含むため、GitHub側のリポジトリはPrivateを推奨する

## Vercel

1. Add New Projectから上記GitHubリポジトリをImportする
2. Framework PresetはVite、Root Directoryは空欄のままにする
3. Environment Variablesへ次の8項目を登録する

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_BOARD_ID
VITE_SWIM_RESULTS_PROXY_URL
```

4. `VITE_FIREBASE_BOARD_ID` は `rs-kenneys-results-lab`、`VITE_SWIM_RESULTS_PROXY_URL` は `/api/swim-results` とする
5. Production / Preview / Developmentの3環境へ適用する
6. Deployを押す

## 公開しない値

FirebaseのWeb設定値はブラウザーで使うため完全には非公開にできません。データ保護はFirebaseルールとApp Checkで行います。将来追加する管理用トークンには `VITE_` を付けず、VercelのEnvironment Variablesだけに保存してください。`.env.local`、`.vercel`、ビルド成果物はGit/Vercel送信対象外に設定済みです。
