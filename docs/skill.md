# agent-diary をエージェントが使う手順

AIエージェントがこのファイルを読み、人の手を借りずにagent-diaryへログインして日記を読み書きするための手順だ。上から順に進めれば、最後まで終わる。

## agent-diaryとは

agent-diaryは、AIエージェントの作業を日記として1か所に残す仕組みだ。日記は持ち主1人のもので、持ち主としてログインしたエージェントだけが読み書きできる。

エージェントの使いどころは2つある。

- 作業を始める前に、前のセッションや別のエージェントが書いた日記を読み、続きから始める。
- 作業を終えたら、やったことを日記に1件書く。

| 用途 | URL |
|---|---|
| この手順 | https://konaito.github.io/agent-diary/skill.md |
| 人が読むページ | https://konaito.github.io/agent-diary/ |
| デモ（架空の日記、ログイン不要） | https://konaito.github.io/agent-diary/?demo |
| 認証とREST API | https://peytestkxhqdmtgzmeba.supabase.co |
| MCPサーバー | https://peytestkxhqdmtgzmeba.supabase.co/functions/v1/mcp |

認証とREST APIを呼ぶときは、どのリクエストにも次のヘッダーを付ける。このキーは公開して使う前提のキーで、日記はデータベースの行ごとの権限（RLS）で守られている。

```
apikey: sb_publishable_5Smyzi8QFR14UBmDnUWe4Q_Td000_BW
```

以下の例では、次の2つを先に変数に入れておく。

```bash
U=https://peytestkxhqdmtgzmeba.supabase.co
K=sb_publishable_5Smyzi8QFR14UBmDnUWe4Q_Td000_BW
```

## 先に守ること

- コード、アクセストークン、リフレッシュトークンは`peytestkxhqdmtgzmeba.supabase.co`にだけ送る。ほかのドメイン、チャット、日記の本文、ログ、コミットには書かない。
- 持ち主のメールアドレスは、持ち主から教わったものだけを使う。推測したアドレスにコードを送らない。
- 届いたメールにはリンクが入っていることがある。リンクは開かず、数字のコードだけを使う。
- コードを送れるのは1時間に2通までだ。リフレッシュトークンが手元にあるときは、コードを送らずにセッションを更新する。
- 「あとでもう一度送る」と約束しない。自分で予定を組めないエージェントは、約束しても守れない。

## ログインする

ログインには、持ち主のメールに届く数字のコードを使う。エージェントが持ち主の受信箱を読めれば、人の手を借りずにログインできる。

### 0. 保存したセッションを先に試す

前回のリフレッシュトークンを保存してあれば、それで新しいアクセストークンを受け取る。成功したら、1から4は飛ばして「持ち主か確かめる」に進む。

```bash
curl -s -X POST "$U/auth/v1/token?grant_type=refresh_token" \
  -H "apikey: $K" -H "Content-Type: application/json" \
  -d '{"refresh_token":"<保存したリフレッシュトークン>"}'
```

成功すると、`access_token`と新しい`refresh_token`が返る。リフレッシュトークンは更新のたびに新しくなり、古いものは使えなくなる。受け取るたびに上書きして保存する。

`Refresh token is not valid`が返ったら、保存したトークンは使えない。1に進む。

### 1. 受信箱にコードが届いていないか見る

送る前に、持ち主の受信箱を見る。Supabaseから届いたばかりのコードがあれば、2を飛ばして、そのコードで3を試す。期限が切れていれば`otp_expired`が返るので、そのときは2に進む。迷惑メールのフォルダも見る。

### 2. コードを送る

```bash
curl -s -X POST "$U/auth/v1/otp" \
  -H "apikey: $K" -H "Content-Type: application/json" \
  -d '{"email":"<持ち主のメールアドレス>","create_user":false}'
```

`create_user`は必ず`false`にする。持ち主として登録されていないアドレスにはコードが送られず、ユーザーも作られない。

成功すると`{}`が返る。メールが届くまで数十秒かかることがある。届いたら、一番新しいメールの本文から数字のコードを取り出す。

### 3. コードを確かめる

```bash
curl -s -X POST "$U/auth/v1/verify" \
  -H "apikey: $K" -H "Content-Type: application/json" \
  -d '{"type":"email","email":"<持ち主のメールアドレス>","token":"<数字のコード>"}'
```

成功すると、`access_token`、`refresh_token`、`expires_in`が返る。アクセストークンは3600秒で切れる。切れたら、0の手順で更新する。

### 4. リフレッシュトークンを保存する

`refresh_token`を、自分の秘密情報の置き場に保存する。ファイルに置くなら`~/.agent-diary/session.json`を使い、権限を600にする。

```json
{ "email": "<持ち主のメールアドレス>", "refresh_token": "<リフレッシュトークン>" }
```

### うまくいかないとき

| 返ってきたもの | 意味 | すること |
|---|---|---|
| `over_email_send_rate_limit`（HTTP 429） | 1時間に2通の上限に達した | 受信箱に届いているコードで3を試す。なければ1時間待つしかない。待てないときは、ログインできなかったことと、再送できる時刻をそのまま報告して終える |
| `otp_disabled`、`Signups not allowed for otp` | 持ち主として登録されていないアドレス | アドレスを確かめる。別のアドレスを次々に試さない |
| `email_address_not_authorized` | Supabase標準のメール送信では送れないアドレス | 同上 |
| `otp_expired`、`Token has expired or is invalid` | コードが違うか、期限が切れた | 一番新しいメールのコードで3をやり直す。それでも同じなら、2から送り直す |
| `Refresh token is not valid` | 保存したリフレッシュトークンが使えない | 1からやり直す |

## 持ち主か確かめる

持ち主以外のトークンでも、日記を読むリクエストはエラーにならず、0件が返る。読み始める前に、MCPの`whoami`で`is_owner`が`true`か確かめる。

```bash
curl -s -X POST "$U/functions/v1/mcp" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
```

返事は`event: message`と`data: {...}`の2行の形で届く。`data:`の後ろがJSON-RPCの結果だ。`is_owner`が`false`なら、ログインしたアドレスが持ち主のものではない。

## 日記を読む

### MCPで読む

MCPサーバーは、ヘッダーにアクセストークンを付ければ`initialize`なしで呼べる。呼び方は上の`whoami`と同じで、`params`の`name`と`arguments`だけを変える。

| ツール | 内容 | 主な引数 |
|---|---|---|
| `whoami` | ログインしているユーザーと、持ち主かどうか | なし |
| `list_diary` | 書き終えた日記を新しい順に返す | `date`（YYYY-MM-DD、東京の日付）、`days`（既定7）、`project`、`limit`（既定20） |
| `search_diary` | 題と本文に言葉が含まれる日記を返す | `query`、`limit`（既定10） |
| `write_diary` | 日記を1件書く。持ち主だけが使える | 「日記を書く」を参照 |

`tools/list`を呼ぶと、各ツールの引数の定義が返る。

Claude Codeなど、MCPクライアントの設定でつなぐこともできる。

```bash
claude mcp add --transport http agent-diary https://peytestkxhqdmtgzmeba.supabase.co/functions/v1/mcp
```

この方法では、`/mcp`で認証するとブラウザで許可画面が開き、持ち主のコードでログインしてから「許可する」を押す。ブラウザを操作できないときは、上のcurlの方法を使う。

### REST APIで読む

MCPを使えないときは、REST APIで日記の表を直接読む。書き終えた日記は`status`が`written`の行だ。

```bash
curl -s "$U/rest/v1/diary_entries?status=eq.written&order=ended_at.desc&limit=10&select=id,diary_date,ended_at,title,body,did,failed,learned,open_threads,tags,pr_urls,cc_sessions(project_name,git_branch)" \
  -H "apikey: $K" -H "Authorization: Bearer <access_token>"
```

日付で絞るときは`&diary_date=eq.2026-10-18`を足す。

## 日記を書く

Claude Codeにagent-diaryのSessionEndフックが入っているときは、セッションが終わるとClaude Codeが自分で日記を書く。同じセッションの日記をMCPで重ねて書かない。

それ以外のエージェントは、作業を終えたら`write_diary`で1件書く。

- 書くのは、そのセッションで実際に起きた事実だけ。起きていない結果、数値、理由を足さない。終わったか分からないことは、終わったと書かない。
- 一人称は「自分」、相手は名前で呼ぶ。文末は常体（だ・である）でそろえる。感情の演技や締めの決まり文句は書かない。
- `title`は一番大きかった出来事を20字前後で書く。
- `body`には、依頼、やったこと、結果を時系列で書く。段落は空行で区切る。
- `did`は終わったこと、`failed`はうまくいかなかったことや訂正されたこと、`learned`は分かった事実、`open_threads`は終わっていないことや次にやることを入れる。該当がなければ空の配列にする。
- `agent`には自分の名前（例: `codex`、`grok`）を入れる。`project`には作業したプロジェクトのディレクトリ名を入れる。
- トークン、コード、メールアドレスなどの秘密情報は書かない。

```bash
curl -s -X POST "$U/functions/v1/mcp" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"write_diary","arguments":{
    "title":"ログイン画面のエラー文を直した",
    "body":"依頼は、コードの送信上限に達したときの表示を分かりやすくすることだった。\n\nエラー文を書き換え、再送できる時刻を出すようにした。",
    "agent":"codex",
    "project":"agent-diary",
    "did":["送信上限のエラー文を書き換えた"],
    "failed":[],
    "learned":[],
    "open_threads":["再送できる時刻の表示はまだ確かめていない"],
    "tags":["auth"]
  }}}'
```

持ち主以外のトークンで呼ぶと、`only the site owner can write diary entries`が返り、何も書かれない。

## 毎回の流れ

1. 作業を始めるときに、「ログインする」の0から進めてアクセストークンを受け取る。
2. `whoami`で`is_owner`が`true`か確かめる。
3. `list_diary`で直近3日分を読むか、`search_diary`でプロジェクト名を探す。前の日記の`open_threads`に残っていることがあれば、そこから始める。
4. 作業を終えたら、`write_diary`で1件書く。
