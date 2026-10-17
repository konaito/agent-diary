// claude -p に経過記録を渡し、構造化出力で日記を受け取る。
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { CHILD_ENV, type Config, PATHS } from "./config.ts";
import { DIARY_JSON_SCHEMA, DIARY_SYSTEM_PROMPT, type DiaryJson } from "./prompt.ts";

// フックから引き継ぐと、子の claude が親セッションの一部として振る舞う環境変数
const INHERITED_SESSION_VARS = [
  "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_PROJECT_DIR", "CLAUDE_PID",
  "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_SESSION_ID",
];

export interface GenerateResult {
  diary: DiaryJson;
  model: string;
  costUsd: number | null;
}

export async function generateDiary(digest: string, cfg: Config): Promise<GenerateResult> {
  mkdirSync(PATHS.work, { recursive: true });
  const env: Record<string, string | undefined> = { ...process.env, [CHILD_ENV]: "1" };
  for (const k of INHERITED_SESSION_VARS) delete env[k];

  const args = [
    "-p",
    "--model", cfg.model,
    "--output-format", "json",
    "--json-schema", JSON.stringify(DIARY_JSON_SCHEMA),
    "--system-prompt", DIARY_SYSTEM_PROMPT,
    "--tools", "",
    "--no-session-persistence",
    "--strict-mcp-config",
    // 日記生成のセッションでユーザーのフック（SessionEnd を含む）を動かさない
    "--settings", JSON.stringify({ disableAllHooks: true }),
  ];

  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>((resolve, reject) => {
    const child = spawn(cfg.claudeBin, args, { cwd: PATHS.work, env, stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), cfg.generateTimeoutMs);
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (c) => {
      clearTimeout(timer);
      resolve({ stdout: out, stderr: err, code: c });
    });
    child.stdin.end(`以下のセッション記録から日記を書いてください。\n\n${digest}`);
  });

  let res: Record<string, unknown>;
  try {
    res = JSON.parse(stdout);
  } catch {
    throw new Error(`claude -p exited ${code}; stdout is not JSON: ${stdout.slice(0, 500)} stderr: ${stderr.slice(0, 500)}`);
  }
  if (res.is_error || res.subtype !== "success") {
    throw new Error(`claude -p failed (${res.subtype}): ${String(res.result ?? "").slice(0, 800)}`);
  }
  const d = res.structured_output as DiaryJson | undefined;
  if (!d || typeof d.title !== "string" || typeof d.body !== "string" || !d.title.trim() || !d.body.trim()) {
    throw new Error(`structured_output missing or empty: ${JSON.stringify(res.structured_output).slice(0, 500)}`);
  }
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : []);
  const usage = res.modelUsage as Record<string, unknown> | undefined;
  return {
    diary: {
      title: d.title.trim(),
      body: d.body.trim(),
      did: arr(d.did),
      failed: arr(d.failed),
      learned: arr(d.learned),
      open_threads: arr(d.open_threads),
      tags: arr(d.tags),
    },
    model: usage ? Object.keys(usage).join(",") : cfg.model,
    costUsd: typeof res.total_cost_usd === "number" ? res.total_cost_usd : null,
  };
}
