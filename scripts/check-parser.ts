// ~/.claude/projects 配下の全トランスクリプトをパーサーに通し、想定外の形式を一覧する。
// 使い方: bun scripts/check-parser.ts [--limit N]
import { Glob } from "bun";
import { homedir } from "node:os";
import { parseTranscript, renderDigest } from "../src/transcript.ts";

const root = `${homedir()}/.claude/projects`;
const limitArg = process.argv.indexOf("--limit");
const limit = limitArg > 0 ? Number(process.argv[limitArg + 1]) : Infinity;

const anomalies: Record<string, number> = {};
const anomalyFiles: Record<string, string> = {};
const promptHeads: Record<string, number> = {};
const entry: Record<string, number> = {};
let files = 0, failed = 0, withPrompts = 0, overBudget = 0, maxRender = 0;
const errors: string[] = [];
const t0 = performance.now();

for await (const rel of new Glob("*/*.jsonl").scan({ cwd: root, dot: true })) {
  if (files >= limit) break;
  files++;
  const path = `${root}/${rel}`;
  try {
    const d = await parseTranscript(path);
    for (const [k, v] of Object.entries(d.anomalies)) {
      anomalies[k] = (anomalies[k] ?? 0) + v;
      anomalyFiles[k] ??= path;
    }
    entry[d.entrypoint ?? "(none)"] = (entry[d.entrypoint ?? "(none)"] ?? 0) + 1;
    if (d.stats.user_prompts > 0) withPrompts++;
    for (const it of d.items) {
      if (it.kind !== "prompt") continue;
      const h = it.text.slice(0, 24).replace(/\s+/g, " ");
      promptHeads[h] = (promptHeads[h] ?? 0) + 1;
    }
    const r = renderDigest(d);
    maxRender = Math.max(maxRender, r.length);
    if (r.length > 82_000) overBudget++;
  } catch (e) {
    failed++;
    if (errors.length < 10) errors.push(`${path}: ${(e as Error).message}`);
  }
}

const top = (o: Record<string, number>, n: number) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(JSON.stringify({
  files, failed, withPrompts, overBudget, maxRender,
  seconds: Math.round((performance.now() - t0) / 1000),
  entrypoints: entry,
  anomalies: Object.fromEntries(top(anomalies, 50).map(([k, v]) => [k, { count: v, example: anomalyFiles[k] }])),
  frequentPromptHeads: top(promptHeads, 25),
  errors,
}, null, 2));
