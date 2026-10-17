# cc-diary

Claude Code のセッションが終わるたびに、そのセッションの日記を Claude Code 自身に書かせる。日記は Supabase に保存し、GitHub Pages のページで読む。

- 日記のページ: https://konaito.github.io/cc-diary/
- デモ（架空の日記、認証なし）: https://konaito.github.io/cc-diary/?demo

## 仕組み

1. Claude Code の SessionEnd フックが `cc-diary hook` を呼ぶ。`/exit`、Ctrl+C、ターミナルのウィンドウを閉じた場合（SIGHUP）のどれでも発火する。
2. フックは受け取った JSON を `~/.cc-diary/spool/` に置き、ワーカーを切り離して起動して終わる。SessionEnd フックの既定の持ち時間は1.5秒なので、フックでは重い処理をしない。
3. ワーカーはスプールを DB に取り込み、トランスクリプトを読んで経過記録に縮める。それを `claude -p` に渡し、構造化出力で日記を受け取って保存する。
4. `/resume` で同じセッションが再び終わったときは、前回読んだメッセージの後ろだけを読んで、続きの日記を1件足す。

日記を書く対象は、対話で起動したセッション（`cli` と `claude-desktop`）だけにしている。`sdk-py` などの自動実行はフックの段階で捨てる。依頼が1件もない範囲は `skipped` として記録だけ残す。

## 日記のページと認証

`docs/` が GitHub Pages で配信されるページで、ブラウザから Supabase を直接読む。Supabase の Storage と Edge Function はホスト版では HTML を `text/plain` で返すので、ページだけ GitHub Pages に置いている。

読めるのは、最初にページを開いたブラウザ1つだけ。

1. ページを開くと `site_is_claimed()` で持ち主が決まっているかを確かめる。
2. まだなら匿名ログインし、`claim_site()` で自分を持ち主として登録する。`site_owner` は1行しか入らない。
3. 日記のテーブルには「持ち主だけが読める」RLS ポリシーが付いている。持ち主以外は何も読めず、デモへの案内が出る。
4. 持ち主が決まった後の訪問者には匿名ログインさせないので、匿名ユーザーは増えない。

ブラウザのサイトデータを消すと持ち主として読めなくなる。そのときは `bun src/cli.ts site reset` で登録を消してから、読みたいブラウザでページを開き直す。

`docs/config.js` の publishable キーは公開して使う前提のキーで、データは RLS で守っている。

## テーブル

| 名前 | 内容 |
|---|---|
| `cc_sessions` | セッション1件につき1行。プロジェクト、ブランチ、起動元、自動生成タイトル |
| `diary_entries` | SessionEnd 1回につき1行。処理状態（`pending` から `written` / `skipped` / `failed`）、日記本文、やったこと、うまくいかなかったこと、分かったこと、残っていること、タグ、書き込んだファイル、PR |
| `daily_diary` | 書き終えた日記を東京の日付ごとにまとめたビュー |
| `site_owner` | 日記のページを読めるユーザー。1行だけ |

定義は `supabase/schemas/` にある。変更するときはそこを編集し、`supabase db schema declarative sync -f <名前> --no-apply` でマイグレーションを作る。

## セットアップ

Bun と Supabase CLI 2.121 以降が要る。日記はホスト版の Supabase に書く。

```bash
bun install
supabase link --project-ref <ref>
supabase db push
```

`.env` に接続先を書く。Bun の SQL クライアントはプリペアドステートメントを使うので、トランザクションプーラー（6543番）ではなくセッションプーラー（5432番）を使う。

```bash
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

ホスト版では匿名ログインを有効にする（Authentication の Anonymous Sign-Ins）。

```bash
bun run setup --install-hook   # ~/.claude/settings.json に SessionEnd フックを足す（バックアップを取る）
```

ローカルの Supabase で試すときは、`.env` の `DATABASE_URL` を消して `bun run setup` を実行する。Docker で stack を起動し、`.env` にローカルの接続先を書く。

## 使い方

```bash
bun src/cli.ts show            # 今日の日記
bun src/cli.ts show yesterday
bun src/cli.ts show 2026-10-13
bun src/cli.ts status          # 処理状態の件数と直近の失敗
bun src/cli.ts retry           # 失敗した行を再生成の対象に戻す
bun src/cli.ts enqueue ~/.claude/projects/<dir>/<session>.jsonl   # 過去のセッションを手動で日記にする
bun src/cli.ts site            # 日記のページの URL と持ち主を表示する
bun src/cli.ts site reset      # 持ち主の登録を消す。次にページを開いたブラウザが持ち主になる
```

## 設定

`.env` か環境変数で変えられる。

| 変数 | 既定値 | 内容 |
|---|---|---|
| `CC_DIARY_MODEL` | `sonnet` | 日記を書くモデル |
| `CC_DIARY_ENTRYPOINTS` | `cli,claude-desktop` | 日記を書く起動元 |
| `CC_DIARY_MAX_ATTEMPTS` | `3` | 1行あたりの生成の試行回数の上限 |
| `CC_DIARY_TIMEOUT_MS` | `300000` | `claude -p` 1回の制限時間 |
| `CC_DIARY_HOME` | `~/.cc-diary` | スプール、ログ、ロックの置き場所 |
| `CC_DIARY_SITE_URL` | `https://konaito.github.io/cc-diary/` | `site` コマンドが表示する URL |

ログは `~/.cc-diary/logs/worker.log` に出る。

## 日記生成の `claude -p` について

- `--settings '{"disableAllHooks":true}'` を付け、日記生成のセッションでユーザーのフックを動かさない。SessionEnd が再帰しないことは実測で確かめた。念のため環境変数 `CC_DIARY_CHILD` でもフックを止める。
- `--tools ""` でツールを使わせず、`--no-session-persistence` でトランスクリプトを残さない。
- 作業ディレクトリは `~/.cc-diary/work` にして、プロジェクトの CLAUDE.md を読ませない。

## 検査

```bash
bun test                 # パーサーの単体テスト
bun run check-parser     # ~/.claude/projects の全トランスクリプトをパーサーに通し、想定外の形式を一覧する
bun run typecheck
```

Claude Code のトランスクリプト形式は公開仕様ではない。Claude Code を更新したら `check-parser` を流し、`anomalies` に新しい種別が出ていないかを見る。
