// 使い方:
//   bun run setup                  supabase を起動し、.env に DATABASE_URL を書く
//   bun run setup --install-hook   上に加えて ~/.claude/settings.json に SessionEnd フックを足す（バックアップを取る）
//   bun run setup --print-hook     足すフック定義を表示するだけ
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLI_PATH, isLocalDatabase, loadConfig } from "../src/config.ts";
import { refreshDatabaseUrl } from "../src/worker.ts";

const MARK = "# agent-diary";
// 改名前のフックの印。--install-hook で古い定義を置き換えるために見る
const OLD_MARKS = ["# cc-diary"];
const hookCommand = `${process.execPath} ${CLI_PATH} hook ${MARK}`;
const hookEntry = { hooks: [{ type: "command", command: hookCommand, timeout: 5 }] };

if (process.argv.includes("--print-hook")) {
  console.log(JSON.stringify({ hooks: { SessionEnd: [hookEntry] } }, null, 2));
  process.exit(0);
}

const current = loadConfig().databaseUrl;
if (current && !isLocalDatabase(current)) {
  // ホスト版の Supabase を使っているときは .env をそのままにする
  console.log("DATABASE_URL はホスト版の Supabase を指しているので変更しない");
} else {
  const url = refreshDatabaseUrl(loadConfig(), true);
  if (!url) {
    console.error("supabase status から DB_URL を取れなかった。Docker が動いているか確認してください。");
    process.exit(1);
  }
  console.log(`.env に DATABASE_URL=${url} を書いた`);
}

if (process.argv.includes("--install-hook")) {
  const settingsPath = process.env.AGENT_DIARY_SETTINGS ?? join(homedir(), ".claude", "settings.json");
  const original = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "{}";
  if (!original.trim()) throw new Error(`${settingsPath} が空なので書き換えない`);
  const settings = JSON.parse(original);
  settings.hooks ??= {};
  const list: { hooks?: { command?: string }[] }[] = (settings.hooks.SessionEnd ??= []);
  const kept = list.filter((e) => !e.hooks?.some((h) => [MARK, ...OLD_MARKS].some((m) => h.command?.includes(m))));
  settings.hooks.SessionEnd = [...kept, hookEntry];
  const backup = `${settingsPath}.bak-agent-diary-${Date.now()}`;
  copyFileSync(settingsPath, backup);
  const next = `${JSON.stringify(settings, null, 2)}\n`;
  JSON.parse(next);
  writeFileSync(settingsPath, next);
  console.log(`${settingsPath} に SessionEnd フックを足した（バックアップ: ${backup}）`);
  console.log(hookCommand);
}
