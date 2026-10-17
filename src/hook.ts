// SessionEnd フック。既定の持ち時間は1.5秒なので、受け取った JSON をスプールに置いてワーカーを切り離して起動するだけにする。
// ワーカーは detached（setsid）で起動するので、ターミナルを閉じた SIGHUP でも巻き込まれない。
import { spawn } from "node:child_process";
import { mkdirSync, openSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CHILD_ENV, CLI_PATH, loadConfig, PATHS } from "./config.ts";

export async function runHook(): Promise<void> {
  if (process.env[CHILD_ENV]) return;
  // sdk-py などの自動実行はここで捨てる。大量のバッチ実行でワーカーを起動しないため。ワーカー側でも同じ判定をする
  const ep = process.env.CLAUDE_CODE_ENTRYPOINT;
  if (ep && !loadConfig().entrypoints.includes(ep)) return;
  const raw = await Bun.stdin.text();
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(raw);
  } catch {
    input = { unparsable: raw };
  }
  mkdirSync(PATHS.spool, { recursive: true });
  const sid = typeof input.session_id === "string" ? input.session_id : "unknown";
  const name = `${Date.now()}-${sid}.json`;
  const tmp = join(PATHS.spool, `.${name}.tmp`);
  writeFileSync(tmp, JSON.stringify({ received_at: new Date().toISOString(), input }));
  renameSync(tmp, join(PATHS.spool, name));
  spawnWorker();
}

export function spawnWorker(): void {
  mkdirSync(PATHS.logDir, { recursive: true });
  const out = openSync(PATHS.log, "a");
  const child = spawn(process.execPath, [CLI_PATH, "worker"], {
    detached: true,
    stdio: ["ignore", out, out],
    env: { ...process.env, CC_DIARY_FROM_HOOK: "1" },
  });
  child.unref();
}
