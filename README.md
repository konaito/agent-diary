# agent-diary

エージェントが自分の作業の日記を書き、Supabaseに残す。今はClaude Codeに対応していて、セッションが終わるたびにそのセッションの日記をClaude Code自身が書く。日記はGitHub Pagesのページで読む。

- 日記のページ: https://konaito.github.io/agent-diary/
- デモ（架空の日記、認証なし）: https://konaito.github.io/agent-diary/?demo

## 仕組み

1. Claude CodeのSessionEndフックが`agent-diary hook`を呼ぶ。`/exit`、Ctrl+C、ターミナルのウィンドウを閉じた場合（SIGHUP）のどれでも発火する。
2. フックは受け取ったJSONを`~/.agent-diary/spool/`に置き、ワーカーを切り離して起動して終わる。SessionEndフックの既定の持ち時間は1.5秒なので、フックでは重い処理をしない。
3. ワーカーはスプールをDBに取り込み、トランスクリプトを読んで経過記録に縮める。経過記録を`claude -p`に渡し、構造化出力で日記を受け取って保存する。
4. `/resume`で同じセッションが再び終わったときは、前回読んだメッセージの後ろだけを読んで、続きの日記を1件足す。

日記を書く対象は、対話で起動したセッション（`cli`と`claude-desktop`）だけにしている。`sdk-py`などの自動実行はフックの段階で捨てる。依頼が1件もない範囲は`skipped`として記録だけ残す。

## 日記のページと認証

`docs/`がGitHub Pagesで配信されるページで、ブラウザからSupabaseを直接読む。ホスト版のSupabaseでは、StorageとEdge FunctionがHTMLを`text/plain`で返す。そのため、ページだけGitHub Pagesに置いている。

日記を読めるのは持ち主1人だけ。

1. ページを開いた人は全員匿名ログインする。
2. `claim_site()`を呼び、持ち主がまだいなければ自分を持ち主として登録する。`site_owner`には1行しか入らない。
3. 日記のテーブルには「持ち主だけが読める」RLSポリシーが付いている。持ち主以外は何も読めず、デモへの案内が出る。
4. `record_visit()`で訪問を`site_visits`に1行記録する。訪れた人数は匿名ユーザーの種類数で、ヘッダーに出る。訪問の明細は持ち主だけが読める。

持ち主は、ページの「メール未登録」からメールアドレスを登録できる。登録すると匿名のユーザーにアドレスが結び付き、ユーザーIDは変わらない。他の端末では、閉じた画面の「持ち主ならメールでログイン」から、メールに届く数字のコードでログインする。登録されていないアドレスにはコードを送らず、ユーザーも作らない。

Supabaseの標準のメール送信は、組織のメンバーのアドレスにだけ、1時間に2通まで送れる。持ち主のアドレスはその範囲で選ぶ。

メールを登録する前にブラウザのサイトデータを消すと、持ち主として読めなくなる。そのときは`bun src/cli.ts site reset`で登録を消してから、読みたいブラウザでページを開き直す。

`docs/config.js`のpublishableキーは公開して使う前提のキーで、データはRLSで守っている。

## OTPを選んだ理由

ログインには、メールに届く数字のコード（OTP）を使う。メールをエージェントに委ねる時代において、OTPはエージェントと人間にとって最も良いUXだと考えている。

コードは数字の並びなので、メールを読んだエージェントがそのまま入力欄に入れられる。エージェントがチャットで人間に伝え、人間が自分の端末で入れることもできる。

ログイン用のリンクだと、ログイン状態はリンクを開いたブラウザに残る。メールを読むのがエージェントなら、リンクを開くのもエージェントのブラウザになりやすい。コードなら、ログインしたい端末で入力するので、ログイン状態はその端末に残る。

## テーブル

| 名前 | 内容 |
|---|---|
| `cc_sessions` | セッション1件につき1行。プロジェクト、ブランチ、起動元、自動生成タイトル |
| `diary_entries` | SessionEnd 1回につき1行。処理状態（`pending`から`written`/`skipped`/`failed`）、日記本文、やったこと、うまくいかなかったこと、分かったこと、残っていること、タグ、書き込んだファイル、PR |
| `daily_diary` | 書き終えた日記を東京の日付ごとにまとめたビュー |
| `site_owner` | 日記のページを読めるユーザー。1行だけ |
| `site_visits` | 日記のページを開いた記録。持ち主、閉じた画面、デモのどれを見たか |

定義は`supabase/schemas/`にある。変更するときは`supabase/schemas/`を編集し、`supabase db schema declarative sync -f <名前> --no-apply`でマイグレーションを作る。

## セットアップ

BunとSupabase CLI 2.121以降が要る。日記はホスト版のSupabaseに書く。

```bash
bun install
supabase link --project-ref <ref>
supabase db push
```

`.env`に接続先を書く。BunのSQLクライアントはプリペアドステートメントを使う。そのため、トランザクションプーラー（6543番）ではなく、セッションプーラー（5432番）を使う。

```bash
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres
```

ホスト版では匿名ログインを有効にする（AuthenticationのAnonymous Sign-Ins）。

```bash
bun run setup --install-hook   # ~/.claude/settings.json に SessionEnd フックを足す（バックアップを取る）
```

ローカルのSupabaseで試すときは、`.env`の`DATABASE_URL`を消して`bun run setup`を実行する。Dockerでstackを起動し、`.env`にローカルの接続先を書く。

## 使い方

```bash
bun src/cli.ts show            # 今日の日記
bun src/cli.ts show yesterday
bun src/cli.ts show 2026-10-13
bun src/cli.ts status          # 処理状態の件数と直近の失敗
bun src/cli.ts retry           # 失敗した行を再生成の対象に戻す
bun src/cli.ts enqueue ~/.claude/projects/<dir>/<session>.jsonl   # 過去のセッションを手動で日記にする
bun src/cli.ts site            # 日記のページのURLと持ち主を表示する
bun src/cli.ts site reset      # 持ち主の登録を消す。次にページを開いたブラウザが持ち主になる
```

## 設定

`.env`か環境変数で変えられる。

| 変数 | 既定値 | 内容 |
|---|---|---|
| `AGENT_DIARY_MODEL` | `sonnet` | 日記を書くモデル |
| `AGENT_DIARY_ENTRYPOINTS` | `cli,claude-desktop` | 日記を書く起動元 |
| `AGENT_DIARY_MAX_ATTEMPTS` | `3` | 1行あたりの生成の試行回数の上限 |
| `AGENT_DIARY_TIMEOUT_MS` | `300000` | `claude -p` 1回の制限時間 |
| `AGENT_DIARY_HOME` | `~/.agent-diary` | スプール、ログ、ロックの置き場所 |
| `AGENT_DIARY_SITE_URL` | `https://konaito.github.io/agent-diary/` | `site`コマンドが表示するURL |

ログは`~/.agent-diary/logs/worker.log`に出る。

## 日記生成の`claude -p`について

- `--settings '{"disableAllHooks":true}'`を付け、日記生成のセッションでユーザーのフックを動かさない。SessionEndが再帰しないことは実測で確かめた。念のため環境変数`AGENT_DIARY_CHILD`でもフックを止める。
- `--tools ""`でツールを使わせず、`--no-session-persistence`でトランスクリプトを残さない。
- 作業ディレクトリは`~/.agent-diary/work`にして、プロジェクトのCLAUDE.mdを読ませない。

## 検査

```bash
bun test                 # パーサーの単体テスト
bun run check-parser     # ~/.claude/projects の全トランスクリプトをパーサーに通し、想定外の形式を一覧する
bun run typecheck
```

Claude Codeのトランスクリプト形式は公開仕様ではない。Claude Codeを更新したら`check-parser`を流し、`anomalies`に新しい種別が出ていないかを見る。
