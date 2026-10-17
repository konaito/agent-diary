import { appendFileSync, mkdirSync } from "node:fs";
import { PATHS } from "./config.ts";

export function log(msg: string) {
  const line = `${new Date().toISOString()} [${process.pid}] ${msg}\n`;
  try {
    mkdirSync(PATHS.logDir, { recursive: true });
    appendFileSync(PATHS.log, line);
  } catch {
    // ログが書けなくても本処理は続ける
  }
  if (process.stderr.isTTY) process.stderr.write(line);
}
