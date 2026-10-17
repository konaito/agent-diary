#!/usr/bin/env bun
// agent-diary: Claude Code のセッションが終わるたびに、そのセッションの日記を Claude Code 自身に書かせる。
import { basename } from "node:path";
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, PATHS } from "./config.ts";
import { runHook } from "./hook.ts";
import { parseTranscript } from "./transcript.ts";
import { openDb, refreshDatabaseUrl, runWorker } from "./worker.ts";

const USAGE = `agent-diary <command>

  hook                      SessionEnd フックから呼ぶ。標準入力の JSON をスプールに置いてワーカーを起動する
  worker                    スプールを取り込み、未処理の日記を書く
  show [日付]               日記を表示する。日付は YYYY-MM-DD / today / yesterday（省略時 today）
  status                    処理状態の件数と直近の失敗を表示する
  enqueue <transcript.jsonl>...  既存のトランスクリプトを手動でキューに入れる（終了時刻はトランスクリプト最後のメッセージ）
  retry                     失敗した行の試行回数を戻して再生成の対象にする
  db-url                    supabase status から .env の DATABASE_URL を更新する
  site                      日記サイトの URL と持ち主を表示する
  site reset                持ち主の登録を消す。次にサイトを開いたブラウザが持ち主になる`;

function tokyoDate(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
}

function requireDb() {
  const cfg = loadConfig();
  if (!cfg.databaseUrl) {
    console.error("DATABASE_URL がありません。`bun run setup` か `agent-diary db-url` を実行してください。");
    process.exit(1);
  }
  return openDb(cfg.databaseUrl);
}

// 日記の日付と違う日なら「10/12 」を前に付ける
const md = (d: Date, diaryDate: string) => {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);
  return day === diaryDate ? "" : `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))} `;
};
const hhmm = (d: Date) => new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function show(arg: string | undefined) {
  const date = !arg || arg === "today" ? tokyoDate() : arg === "yesterday" ? tokyoDate(-1) : arg;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`日付の形式が違います: ${arg}`);
  const db = requireDb();
  const rows = await db`
    select e.title, e.body, e.did, e.failed, e.learned, e.open_threads, e.tags, e.ended_at, e.span_started_at,
           s.project_name, s.git_branch, e.pr_urls
    from public.diary_entries e join public.cc_sessions s using (session_id)
    where e.diary_date = ${date} and e.status = 'written'
    order by e.ended_at`;
  await db.close();
  if (rows.length === 0) {
    console.log(`${date} の日記はまだない。`);
    return;
  }
  const out: string[] = [`# ${date} の日記`, ""];
  const list = (label: string, xs: string[]) => {
    if (xs.length) out.push(`**${label}**`, ...xs.map((x) => `- ${x}`), "");
  };
  for (const r of rows) {
    const span = r.span_started_at ? `${md(r.span_started_at, date)}${hhmm(r.span_started_at)}〜${md(r.ended_at, date)}${hhmm(r.ended_at)}` : hhmm(r.ended_at);
    out.push(`## ${r.title}`, "", `${span} · ${r.project_name}${r.git_branch ? ` (${r.git_branch})` : ""}`, "", r.body, "");
    list("やったこと", r.did);
    list("うまくいかなかったこと", r.failed);
    list("分かったこと", r.learned);
    list("残っていること", r.open_threads);
    if (r.pr_urls.length) out.push(`PR: ${r.pr_urls.join(" ")}`, "");
    if (r.tags.length) out.push(r.tags.map((t: string) => `#${t}`).join(" "), "");
  }
  console.log(out.join("\n").trimEnd());
}

async function status() {
  const db = requireDb();
  const counts = await db`select status, count(*)::int as n from public.diary_entries group by status order by status`;
  const failures = await db`
    select id, session_id, attempts, ended_at, left(last_error, 200) as err
    from public.diary_entries where status = 'failed' order by ended_at desc limit 5`;
  await db.close();
  let spool = 0;
  try {
    spool = readdirSync(PATHS.spool).filter((f) => f.endsWith(".json")).length;
  } catch {}
  console.log(JSON.stringify({ counts: Object.fromEntries(counts.map((c: { status: string; n: number }) => [c.status, c.n])), spool, failures, log: PATHS.log }, null, 2));
}

async function enqueue(paths: string[]) {
  if (paths.length === 0) throw new Error("トランスクリプトのパスを指定してください");
  mkdirSync(PATHS.spool, { recursive: true });
  for (const p of paths) {
    const d = await parseTranscript(p);
    const sid = d.sessionId ?? basename(p, ".jsonl");
    if (!d.lastEventAt) {
      console.error(`skip ${p}: メッセージがない`);
      continue;
    }
    const input = { session_id: sid, transcript_path: p, cwd: d.cwd ?? "", hook_event_name: "manual", reason: "manual" };
    const name = `${Date.now()}-${sid}.json`;
    const tmp = join(PATHS.spool, `.${name}.tmp`);
    writeFileSync(tmp, JSON.stringify({ received_at: d.lastEventAt, input }));
    renameSync(tmp, join(PATHS.spool, name));
    console.log(`queued ${sid} (${d.cwd}, last event ${d.lastEventAt})`);
  }
  await runWorker();
}

async function retry() {
  const db = requireDb();
  const r = await db`update public.diary_entries set status = 'pending', attempts = 0 where status = 'failed' returning id`;
  await db.close();
  console.log(`${r.length} 件を pending に戻した。agent-diary worker で再生成する。`);
}

const [cmd, ...rest] = process.argv.slice(2);
try {
switch (cmd) {
  case "hook":
    await runHook();
    break;
  case "worker":
    await runWorker();
    break;
  case "show":
    await show(rest[0]);
    break;
  case "status":
    await status();
    break;
  case "enqueue":
    await enqueue(rest);
    break;
  case "retry":
    await retry();
    break;
  case "site": {
    const db = requireDb();
    if (rest[0] === "reset") {
      // 持ち主の匿名ユーザーごと消す。site_owner は外部キーの ON DELETE CASCADE で消える
      const r = await db`
        delete from auth.users where id in (select user_id from public.site_owner) and is_anonymous
        returning id`;
      await db`delete from public.site_owner`;
      console.log(r.length ? `持ち主（${r[0].id}）を消した。次にサイトを開いたブラウザが持ち主になる。` : "持ち主はいなかった。");
    } else {
      const [o] = await db`select o.user_id, o.claimed_at from public.site_owner o`;
      console.log(o ? `持ち主: ${o.user_id}（${o.claimed_at.toISOString()} に登録）` : "持ち主: まだいない。最初にサイトを開いたブラウザが持ち主になる。");
    }
    await db.close();
    console.log(`URL: ${loadConfig().siteUrl}`);
    break;
  }
  case "db-url": {
    const url = refreshDatabaseUrl(loadConfig(), false);
    console.log(url ? `DATABASE_URL を更新した: ${url}` : "supabase status から DB_URL を取れなかった");
    break;
  }
  default:
    console.log(USAGE);
    if (cmd && cmd !== "help" && cmd !== "--help") process.exitCode = 1;
}
} catch (e) {
  const err = e as Error & { code?: string };
  if (err.code?.startsWith("ERR_POSTGRES_CONNECTION")) {
    console.error(`DB に接続できない（${err.code}）。~/Documents/agent-diary で supabase start してから再実行してください。`);
  } else {
    console.error(err.message);
  }
  process.exitCode = 1;
}
