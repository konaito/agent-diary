import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PROJECT_ROOT = dirname(import.meta.dir);
export const CLI_PATH = join(import.meta.dir, "cli.ts");

const home = process.env.AGENT_DIARY_HOME ?? join(homedir(), ".agent-diary");
export const PATHS = {
  home,
  spool: join(home, "spool"),
  spoolBad: join(home, "spool-bad"),
  lock: join(home, "worker.lock"),
  logDir: join(home, "logs"),
  log: join(home, "logs", "worker.log"),
  // claude -p を起動するときの作業ディレクトリ。プロジェクトの CLAUDE.md を読ませないために空のディレクトリを使う
  work: join(home, "work"),
};

/** 日記生成の claude -p にこの環境変数を付ける。フックはこれを見て何もしない（再帰防止の二重化） */
export const CHILD_ENV = "AGENT_DIARY_CHILD";

function readDotEnv(): Record<string, string> {
  const p = join(PROJECT_ROOT, ".env");
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m?.[1]) out[m[1]] = (m[2] ?? "").replace(/^(['"])(.*)\1$/, "$2");
  }
  return out;
}

export function loadConfig() {
  const env = { ...readDotEnv(), ...process.env };
  return {
    databaseUrl: env.DATABASE_URL ?? null,
    model: env.AGENT_DIARY_MODEL ?? "sonnet",
    entrypoints: (env.AGENT_DIARY_ENTRYPOINTS ?? "cli,claude-desktop").split(",").map((s) => s.trim()).filter(Boolean),
    maxAttempts: Number(env.AGENT_DIARY_MAX_ATTEMPTS ?? 3),
    claudeBin: env.AGENT_DIARY_CLAUDE_BIN ?? Bun.which("claude") ?? join(homedir(), ".local/bin/claude"),
    supabaseBin: env.AGENT_DIARY_SUPABASE_BIN ?? Bun.which("supabase") ?? "/opt/homebrew/bin/supabase",
    generateTimeoutMs: Number(env.AGENT_DIARY_TIMEOUT_MS ?? 300_000),
    siteUrl: env.AGENT_DIARY_SITE_URL ?? "https://konaito.github.io/agent-diary/",
  };
}
export type Config = ReturnType<typeof loadConfig>;

/** 接続先がこのマシンのローカル Supabase かどうか */
export function isLocalDatabase(url: string | null): boolean {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost", "::1"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
