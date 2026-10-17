// 使い方:
//   bun run setup                  supabase を起動し、.env に DATABASE_URL を書く
//   bun run setup --install-hook   上に加えて ~/.claude/settings.json に SessionEnd フックを足す（バックアップを取る）
//   bun run setup --print-hook     足すフック定義を表示するだけ
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CLI_PATH, loadConfig } from "../src/config.ts";
import { refreshDatabaseUrl } from "../src/worker.ts";

const MARK = "# cc-diary";
const hookCommand = `${process.execPath} ${CLI_PATH} hook ${MARK}`;
const hookEntry = { hooks: [{ type: "command", command: hookCommand, timeout: 5 }] };

if (process.argv.includes("--print-hook")) {
  console.log(JSON.stringify({ hooks: { SessionEnd: [hookEntry] } }, null, 2));
  process.exit(0);
}

const url = refreshDatabaseUrl(loadConfig(), true);
if (!url) {
  console.error("supabase status から DB_URL を取れなかった。Docker が動いているか確認してください。");
  process.exit(1);
}
console.log(`.env に DATABASE_URL=${url} を書いた`);

if (process.argv.includes("--install-hook")) {
  const settingsPath = process.env.CC_DIARY_SETTINGS ?? join(homedir(), ".claude", "settings.json");
  const original = existsSync(settingsPath) ? readFileSync(settingsPath, "utf8") : "{}";
  if (!original.trim()) throw new Error(`${settingsPath} が空なので書き換えない`);
  const settings = JSON.parse(original);
  settings.hooks ??= {};
  const list: { hooks?: { command?: string }[] }[] = (settings.hooks.SessionEnd ??= []);
  const kept = list.filter((e) => !e.hooks?.some((h) => h.command?.includes(MARK)));
  settings.hooks.SessionEnd = [...kept, hookEntry];
  const backup = `${settingsPath}.bak-cc-diary-${Date.now()}`;
  copyFileSync(settingsPath, backup);
  const next = `${JSON.stringify(settings, null, 2)}\n`;
  JSON.parse(next);
  writeFileSync(settingsPath, next);
  console.log(`${settingsPath} に SessionEnd フックを足した（バックアップ: ${backup}）`);
  console.log(hookCommand);
}
