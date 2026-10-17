// スプールに溜まった SessionEnd を DB に取り込み、未処理の行について日記を書く。
// 同時に1プロセスだけ動く（ロックディレクトリ）。DB に届かないときはスプールを残して終わり、次の起動で取り込む。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SQL } from "bun";
import { type Config, loadConfig, PATHS, PROJECT_ROOT } from "./config.ts";
import { generateDiary } from "./generate.ts";
import { log } from "./log.ts";
import { CursorNotFoundError, parseTranscript, renderDigest } from "./transcript.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_LOCK_MS = 30 * 60_000;

// ---------- ロック ----------

function acquireLock(): boolean {
  mkdirSync(PATHS.home, { recursive: true });
  try {
    mkdirSync(PATHS.lock);
  } catch {
    // 持ち主が死んでいるか、古すぎるロックは奪う
    let owner = 0;
    try {
      owner = Number(readFileSync(join(PATHS.lock, "pid"), "utf8"));
    } catch {}
    let alive = false;
    if (owner > 0) {
      try {
        process.kill(owner, 0);
        alive = true;
      } catch {}
    }
    const age = Date.now() - statSync(PATHS.lock).mtimeMs;
    if (alive && age < STALE_LOCK_MS) return false;
    log(`stealing lock from pid ${owner} (alive=${alive}, age=${Math.round(age / 1000)}s)`);
    rmSync(PATHS.lock, { recursive: true, force: true });
    try {
      mkdirSync(PATHS.lock);
    } catch {
      return false;
    }
  }
  writeFileSync(join(PATHS.lock, "pid"), String(process.pid));
  return true;
}

function releaseLock() {
  try {
    if (readFileSync(join(PATHS.lock, "pid"), "utf8") === String(process.pid)) rmSync(PATHS.lock, { recursive: true, force: true });
  } catch {}
}

// ---------- DB 接続 ----------

export function openDb(url: string): SQL {
  return new SQL({ url, max: 2, idleTimeout: 10, connectionTimeout: 5 });
}

async function ping(url: string): Promise<SQL | null> {
  const db = openDb(url);
  try {
    await db`select 1`;
    return db;
  } catch {
    await db.close().catch(() => {});
    return null;
  }
}

/** supabase status から DB_URL を読み、.env の DATABASE_URL を書き換える */
export function refreshDatabaseUrl(cfg: Config, start: boolean): string | null {
  if (start) {
    const r = spawnSync(cfg.supabaseBin, ["start"], { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 180_000 });
    if (r.status !== 0) log(`supabase start failed: ${(r.stderr || r.stdout || "").slice(0, 400)}`);
  }
  const s = spawnSync(cfg.supabaseBin, ["status", "--env", "--output-format", "text"], { cwd: PROJECT_ROOT, encoding: "utf8", timeout: 60_000 });
  const m = /^DB_URL=['"]?([^'"\n]+)['"]?$/m.exec(s.stdout ?? "");
  if (!m?.[1]) return null;
  const envPath = join(PROJECT_ROOT, ".env");
  const lines = existsSync(envPath) ? readFileSync(envPath, "utf8").split("\n").filter((l) => l && !l.startsWith("DATABASE_URL=")) : [];
  lines.push(`DATABASE_URL=${m[1]}`);
  writeFileSync(envPath, `${lines.join("\n")}\n`);
  return m[1];
}

async function connectWithAutostart(cfg: Config): Promise<SQL | null> {
  if (cfg.databaseUrl) {
    const db = await ping(cfg.databaseUrl);
    if (db) return db;
    log(`database not reachable at ${cfg.databaseUrl.replace(/:[^:@/]*@/, ":***@")}; trying supabase start`);
  }
  const url = refreshDatabaseUrl(cfg, true);
  if (!url) return null;
  return ping(url);
}

// ---------- スプールの取り込み ----------

export async function ingestSpool(db: SQL): Promise<number> {
  mkdirSync(PATHS.spool, { recursive: true });
  const files = readdirSync(PATHS.spool).filter((f) => f.endsWith(".json") && !f.startsWith(".")).sort();
  let n = 0;
  for (const f of files) {
    const p = join(PATHS.spool, f);
    let rec: { received_at?: string; input?: Record<string, unknown> };
    try {
      rec = JSON.parse(readFileSync(p, "utf8"));
    } catch (e) {
      quarantine(p, f, `bad json: ${(e as Error).message}`);
      continue;
    }
    const input = rec.input ?? {};
    const sid = input.session_id;
    const tp = input.transcript_path;
    if (typeof sid !== "string" || !UUID_RE.test(sid) || typeof tp !== "string" || !rec.received_at) {
      quarantine(p, f, "missing session_id / transcript_path / received_at");
      continue;
    }
    const cwd = typeof input.cwd === "string" ? input.cwd : "";
    const reason = typeof input.reason === "string" ? input.reason : "unknown";
    await db.begin(async (tx) => {
      await tx`
        insert into public.cc_sessions (session_id, project_dir, transcript_path)
        values (${sid}, ${cwd}, ${tp})
        on conflict (session_id) do update set transcript_path = excluded.transcript_path`;
      await tx`
        insert into public.diary_entries (session_id, end_reason, ended_at, hook_input)
        values (${sid}, ${reason}, ${rec.received_at}, ${input})
        on conflict (session_id, ended_at) do nothing`;
    });
    unlinkSync(p);
    n++;
  }
  return n;
}

function quarantine(path: string, name: string, why: string) {
  mkdirSync(PATHS.spoolBad, { recursive: true });
  renameSync(path, join(PATHS.spoolBad, name));
  log(`quarantined spool file ${name}: ${why}`);
}

// ---------- 日記の生成 ----------

interface QueueRow {
  id: number;
  session_id: string;
  ended_at: Date;
  attempts: number;
  transcript_path: string;
}

export async function processQueue(db: SQL, cfg: Config, seen = new Set<number>()): Promise<number> {
  // 生成中のままワーカーが死んだ行を戻す
  await db`
    update public.diary_entries set status = 'pending'
    where status = 'generating' and updated_at < now() - interval '15 minutes'`;

  const rows: QueueRow[] = await db`
    select e.id, e.session_id, e.ended_at, e.attempts, s.transcript_path
    from public.diary_entries e join public.cc_sessions s using (session_id)
    where e.status = 'pending' or (e.status = 'failed' and e.attempts < ${cfg.maxAttempts})
    order by e.ended_at
    limit 50`;
  let done = 0;
  for (const row of rows) {
    // 1回の実行で同じ行を2度試さない。失敗した行は次の起動で再試行する
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    await processEntry(db, cfg, row);
    done++;
  }
  return done;
}

async function processEntry(db: SQL, cfg: Config, row: QueueRow) {
  const claimed = await db`
    update public.diary_entries set status = 'generating', attempts = attempts + 1
    where id = ${row.id} and status in ('pending', 'failed')
    returning id`;
  if (claimed.length === 0) return;

  try {
    const [prev] = await db`
      select last_message_uuid, title, body from public.diary_entries
      where session_id = ${row.session_id} and ended_at < ${row.ended_at}
        and status in ('written', 'skipped') and last_message_uuid is not null
      order by ended_at desc limit 1`;
    const afterUuid: string | null = prev?.last_message_uuid ?? null;

    if (!existsSync(row.transcript_path)) throw new Error(`transcript not found: ${row.transcript_path}`);
    const d = await parseTranscript(row.transcript_path, { afterUuid });

    await db`
      update public.cc_sessions set
        project_dir = coalesce(${d.cwd}, project_dir),
        git_branch = coalesce(${d.gitBranch}, git_branch),
        entrypoint = coalesce(${d.entrypoint}, entrypoint),
        cc_version = coalesce(${d.version}, cc_version),
        title = coalesce(${d.title}, title),
        first_event_at = coalesce(first_event_at, ${d.firstEventAt}),
        last_event_at = coalesce(${d.lastEventAt}, last_event_at)
      where session_id = ${row.session_id}`;

    const stats = { ...d.stats, anomalies: d.anomalies, cost_state: d.costState };
    const common = {
      span_started_at: d.spanStartAt,
      span_ended_at: d.spanEndAt,
      last_message_uuid: d.lastUuid ?? afterUuid,
    };

    let skip: string | null = null;
    if (d.entrypoint && !cfg.entrypoints.includes(d.entrypoint)) skip = `entrypoint:${d.entrypoint}`;
    else if (d.stats.user_prompts === 0) skip = "no_user_prompt";

    if (skip) {
      await db`
        update public.diary_entries set
          status = 'skipped', skip_reason = ${skip}, last_error = null,
          span_started_at = ${common.span_started_at}, span_ended_at = ${common.span_ended_at},
          last_message_uuid = ${common.last_message_uuid}, stats = ${stats},
          files_touched = ${db.array(d.filesTouched, "text")}, pr_urls = ${db.array(d.prUrls, "text")}
        where id = ${row.id}`;
      log(`entry ${row.id} skipped (${skip})`);
    } else {
      // /resume で続いたセッションは、前回の日記を前提として渡す（繰り返させない）
      const before = prev?.body
        ? `# 同じセッションの前回までの日記（参考。ここに書いた内容は繰り返さない）\n## ${prev.title}\n${prev.body}\n\n`
        : "";
      const g = await generateDiary(before + renderDigest(d), cfg);
      await db`
        update public.diary_entries set
          status = 'written', skip_reason = null, last_error = null,
          span_started_at = ${common.span_started_at}, span_ended_at = ${common.span_ended_at},
          last_message_uuid = ${common.last_message_uuid}, stats = ${stats},
          files_touched = ${db.array(d.filesTouched, "text")}, pr_urls = ${db.array(d.prUrls, "text")},
          title = ${g.diary.title}, body = ${g.diary.body},
          did = ${db.array(g.diary.did, "text")}, failed = ${db.array(g.diary.failed, "text")},
          learned = ${db.array(g.diary.learned, "text")}, open_threads = ${db.array(g.diary.open_threads, "text")},
          tags = ${db.array(g.diary.tags, "text")},
          model = ${g.model}, generation_cost_usd = ${g.costUsd}, written_at = now()
        where id = ${row.id}`;
      log(`entry ${row.id} written: ${g.diary.title} (${g.model}, $${g.costUsd ?? "?"})`);
    }

    // 同じセッションで先に失敗していた行は、この行が範囲ごと書いたので打ち切る
    await db`
      update public.diary_entries set status = 'skipped', skip_reason = ${`superseded_by:${row.id}`}
      where session_id = ${row.session_id} and ended_at < ${row.ended_at} and status = 'failed'`;
  } catch (e) {
    const msg = e instanceof CursorNotFoundError ? `cursor lost: ${e.message}` : (e as Error).message;
    await db`
      update public.diary_entries set status = 'failed', last_error = ${msg.slice(0, 2000)}
      where id = ${row.id}`;
    log(`entry ${row.id} failed (attempt ${row.attempts + 1}): ${msg.slice(0, 300)}`);
  }
}

export async function runWorker(): Promise<void> {
  if (!acquireLock()) return;
  const cfg = loadConfig();
  try {
    const db = await connectWithAutostart(cfg);
    if (!db) {
      log("database unavailable; spool kept for next run");
      return;
    }
    try {
      // 生成中に次の SessionEnd が届くことがあるので、スプールが空になるまで回す
      const seen = new Set<number>();
      for (let round = 0; round < 10; round++) {
        const ingested = await ingestSpool(db);
        const processed = await processQueue(db, cfg, seen);
        if (ingested === 0 && processed === 0) break;
      }
    } finally {
      await db.close();
    }
  } catch (e) {
    log(`worker crashed: ${(e as Error).stack ?? e}`);
    process.exitCode = 1;
  } finally {
    releaseLock();
  }
}
