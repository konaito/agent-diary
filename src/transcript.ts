// Claude Code のトランスクリプト（JSONL）を読み、日記を書くための経過記録に縮める。
// 形式は 2026-10 時点の ~/.claude/projects 配下 7029 ファイルを走査して決めた。
// 想定外の形式は捨てずに anomalies に数え、scripts/check-parser.ts で一覧できるようにしている。

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

export type DigestItem =
  | { kind: "prompt"; at: string; text: string }
  | { kind: "command"; at: string; text: string }
  | { kind: "shell"; at: string; text: string }
  | { kind: "interrupt"; at: string }
  | { kind: "reply"; at: string; text: string }
  | { kind: "tool"; at: string; name: string; summary: string; isError?: boolean };

export interface DigestStats {
  user_prompts: number;
  slash_commands: number;
  assistant_replies: number;
  tool_calls: number;
  tool_errors: number;
  interrupts: number;
  images: number;
  tools: Record<string, number>;
}

export interface Digest {
  sessionId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  entrypoint: string | null;
  version: string | null;
  title: string | null;
  firstEventAt: string | null;
  lastEventAt: string | null;
  spanStartAt: string | null;
  spanEndAt: string | null;
  lastUuid: string | null;
  items: DigestItem[];
  filesTouched: string[];
  prUrls: string[];
  stats: DigestStats;
  costState: Record<string, unknown> | null;
  anomalies: Record<string, number>;
}

// 調査で見つかったエントリ種別。user / assistant 以外は本文を持たない。
const KNOWN_ENTRY_TYPES = new Set([
  "user", "assistant", "attachment", "last-prompt", "permission-mode", "ai-title", "progress",
  "mode", "system", "queue-operation", "file-history-snapshot", "pr-link", "atis-latch",
  "worktree-state", "bridge-session", "file-history-delta", "api-request-blob", "api-request",
  "frame-link", "agent-name", "cost-state", "relocated", "artifact-autoreact-ledger",
  "artifact-comment-monitor", "custom-title", "api-request-shape", "summary",
]);

const KNOWN_USER_BLOCKS = new Set(["text", "tool_result", "image", "document"]);
const KNOWN_ASSISTANT_BLOCKS = new Set([
  "text", "tool_use", "thinking", "redacted_thinking", "server_tool_use", "advisor_tool_result",
  "fallback", "web_search_tool_result", "web_fetch_tool_result",
]);

// ユーザー発話に Claude Code が差し込むタグ。丸ごと捨てるもの。
const DROP_TAGS = [
  "system-reminder", "local-command-caveat", "local-command-stdout", "local-command-stderr",
  "bash-stdout", "bash-stderr", "task-notification",
];
// pasted_content は konaito が貼り付けた本文なので依頼として残す
const KNOWN_TAGS = new Set([...DROP_TAGS, "command-name", "command-message", "command-args", "bash-input", "pasted_content"]);

const WRITE_TOOLS = new Set(["Edit", "Write", "NotebookEdit", "MultiEdit"]);

function emptyStats(): DigestStats {
  return {
    user_prompts: 0, slash_commands: 0, assistant_replies: 0, tool_calls: 0,
    tool_errors: 0, interrupts: 0, images: 0, tools: {},
  };
}

function bump(rec: Record<string, number>, key: string, n = 1) {
  rec[key] = (rec[key] ?? 0) + n;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function tagBlock(tag: string): RegExp {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`, "g");
}

export interface ParsedUserText {
  commands: string[];
  shells: string[];
  prompt: string | null;
  interrupt: boolean;
  unknownTag: string | null;
}

export function parseUserText(raw: string): ParsedUserText {
  // バックグラウンドタスクの完了通知。後ろに「Read the output file…」などの定型文が付くので丸ごと捨てる
  if (raw.includes("<task-notification>")) {
    return { commands: [], shells: [], prompt: null, interrupt: false, unknownTag: null };
  }
  let text = raw;
  for (const tag of DROP_TAGS) text = text.replace(tagBlock(tag), "");

  const commands: string[] = [];
  const nameRe = /<command-name>([\s\S]*?)<\/command-name>/g;
  for (const m of text.matchAll(nameRe)) {
    const name = (m[1] ?? "").trim();
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim() ?? "";
    commands.push(oneLine(`${name.startsWith("/") ? name : `/${name}`} ${args}`, 300));
  }
  for (const tag of ["command-name", "command-message", "command-args"]) text = text.replace(tagBlock(tag), "");

  const shells: string[] = [];
  for (const m of text.matchAll(/<bash-input>([\s\S]*?)<\/bash-input>/g)) shells.push(oneLine(m[1] ?? "", 300));
  text = text.replace(tagBlock("bash-input"), "").trim();

  let interrupt = false;
  if (/^\[Request interrupted by user[^\]]*\]$/.test(text)) {
    interrupt = true;
    text = "";
  }

  let unknownTag: string | null = null;
  const lead = /^<([a-z][a-z0-9_-]*)[\s>]/.exec(text);
  if (lead?.[1] && !KNOWN_TAGS.has(lead[1])) unknownTag = lead[1];

  return { commands, shells, prompt: text.length > 0 ? text : null, interrupt, unknownTag };
}

function summarizeTool(name: string, input: Record<string, unknown>): string {
  const s = (k: string) => str(input[k]);
  switch (name) {
    case "Bash":
      return oneLine(s("description") ?? s("command") ?? "", 140);
    case "Edit": case "Write": case "NotebookEdit": case "MultiEdit": case "Read":
      return s("file_path") ?? s("notebook_path") ?? "";
    case "Grep": case "Glob":
      return oneLine(s("pattern") ?? "", 100);
    case "Agent": case "Task":
      return oneLine(s("description") ?? "", 100);
    case "Skill":
      return s("skill") ?? "";
    case "WebSearch":
      return oneLine(s("query") ?? "", 120);
    case "WebFetch":
      return s("url") ?? "";
    case "AskUserQuestion": {
      const q = Array.isArray(input.questions) ? (input.questions[0] as Record<string, unknown> | undefined) : undefined;
      return oneLine(str(q?.question) ?? "", 140);
    }
    default:
      return "";
  }
}

export interface ParseOptions {
  /** この uuid のメッセージより後ろだけを範囲にする（/resume 後の再 SessionEnd 用） */
  afterUuid?: string | null;
}

export class CursorNotFoundError extends Error {}

export async function parseTranscript(path: string, opts: ParseOptions = {}): Promise<Digest> {
  const d: Digest = {
    sessionId: null, cwd: null, gitBranch: null, entrypoint: null, version: null, title: null,
    firstEventAt: null, lastEventAt: null, spanStartAt: null, spanEndAt: null, lastUuid: null,
    items: [], filesTouched: [], prUrls: [], stats: emptyStats(), costState: null, anomalies: {},
  };
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  const files = new Set<string>();
  const prs = new Set<string>();
  const pendingTools = new Map<string, DigestItem & { kind: "tool" }>();
  let inSpan = !opts.afterUuid;
  let cursorFound = !opts.afterUuid;

  const rl = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        bump(d.anomalies, "line:not-object");
        continue;
      }
      o = parsed as Record<string, unknown>;
    } catch {
      bump(d.anomalies, "line:bad-json");
      continue;
    }

    const type = str(o.type) ?? "(none)";
    if (!KNOWN_ENTRY_TYPES.has(type)) bump(d.anomalies, `entry:${type}`);

    if (type === "ai-title") aiTitle = str(o.aiTitle) ?? aiTitle;
    if (type === "custom-title") customTitle = str(o.customTitle) ?? customTitle;
    if (type === "cost-state") d.costState = o;
    if (type === "pr-link" && inSpan && str(o.prUrl)) prs.add(o.prUrl as string);

    if (type !== "user" && type !== "assistant") continue;

    const uuid = str(o.uuid);
    const at = str(o.timestamp) ?? "";
    d.sessionId ??= str(o.sessionId);
    d.cwd = str(o.cwd) ?? d.cwd;
    d.gitBranch = str(o.gitBranch) ?? d.gitBranch;
    d.entrypoint ??= str(o.entrypoint);
    d.version = str(o.version) ?? d.version;
    if (at) {
      d.firstEventAt ??= at;
      d.lastEventAt = at;
    }

    if (!inSpan) {
      if (uuid && uuid === opts.afterUuid) {
        inSpan = true;
        cursorFound = true;
      }
      continue;
    }

    if (o.isSidechain === true) {
      bump(d.anomalies, "skip:sidechain");
      continue;
    }
    if (uuid) d.lastUuid = uuid;
    if (at) {
      d.spanStartAt ??= at;
      d.spanEndAt = at;
    }
    if (o.isMeta === true) continue;
    if (o.isCompactSummary === true) {
      bump(d.anomalies, "skip:compact-summary");
      continue;
    }
    // 新しめのトランスクリプトには発話の出どころが入る。人間以外（タスク通知、coordinator、自動継続）は依頼として数えない
    const originKind = str((o.origin as Record<string, unknown> | undefined)?.kind);
    if (type === "user" && originKind && originKind !== "human") {
      bump(d.anomalies, `skip:origin:${originKind}`);
      continue;
    }

    const msg = o.message as Record<string, unknown> | undefined;
    const content = msg?.content;

    if (type === "user") {
      const texts: string[] = [];
      if (typeof content === "string") texts.push(content);
      else if (Array.isArray(content)) {
        for (const b of content as Record<string, unknown>[]) {
          const bt = str(b?.type) ?? "(none)";
          if (!KNOWN_USER_BLOCKS.has(bt)) bump(d.anomalies, `user-block:${bt}`);
          if (bt === "text" && typeof b.text === "string") texts.push(b.text);
          else if (bt === "image") d.stats.images++;
          else if (bt === "document") texts.push("[文書を添付]");
          else if (bt === "tool_result" && b.is_error === true) {
            d.stats.tool_errors++;
            const t = pendingTools.get(str(b.tool_use_id) ?? "");
            if (t) t.isError = true;
          }
        }
      } else bump(d.anomalies, "user-content:non-string");

      for (const raw of texts) {
        const p = parseUserText(raw);
        if (p.unknownTag) bump(d.anomalies, `tag:${p.unknownTag}`);
        for (const c of p.commands) {
          d.items.push({ kind: "command", at, text: c });
          d.stats.slash_commands++;
        }
        for (const s of p.shells) d.items.push({ kind: "shell", at, text: s });
        if (p.interrupt) {
          d.items.push({ kind: "interrupt", at });
          d.stats.interrupts++;
        }
        if (p.prompt) {
          d.items.push({ kind: "prompt", at, text: p.prompt });
          d.stats.user_prompts++;
        }
      }
      continue;
    }

    // assistant
    if (o.isApiErrorMessage === true) {
      bump(d.anomalies, "skip:api-error-message");
      continue;
    }
    if (!Array.isArray(content)) {
      bump(d.anomalies, "assistant-content:non-array");
      continue;
    }
    for (const b of content as Record<string, unknown>[]) {
      const bt = str(b?.type) ?? "(none)";
      if (!KNOWN_ASSISTANT_BLOCKS.has(bt)) bump(d.anomalies, `assistant-block:${bt}`);
      if (bt === "text" && typeof b.text === "string" && b.text.trim()) {
        d.items.push({ kind: "reply", at, text: b.text.trim() });
        d.stats.assistant_replies++;
      } else if (bt === "tool_use" || bt === "server_tool_use") {
        const name = str(b.name) ?? "(unknown)";
        const input = (b.input && typeof b.input === "object" ? b.input : {}) as Record<string, unknown>;
        const item = { kind: "tool" as const, at, name, summary: summarizeTool(name, input) };
        d.items.push(item);
        if (str(b.id)) pendingTools.set(b.id as string, item);
        d.stats.tool_calls++;
        bump(d.stats.tools, name);
        if (WRITE_TOOLS.has(name)) {
          const fp = str(input.file_path) ?? str(input.notebook_path);
          if (fp) files.add(fp);
        }
      }
    }
  }

  if (!cursorFound) throw new CursorNotFoundError(`cursor uuid ${opts.afterUuid} not found in ${path}`);
  d.title = customTitle ?? aiTitle;
  d.filesTouched = [...files];
  d.prUrls = [...prs];
  return d;
}

// ---------- 経過記録のテキスト化 ----------

const tokyoTime = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
});
const hm = (iso: string) => (iso ? tokyoTime.format(new Date(iso)) : "--:--");

function minutesBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.round((Date.parse(b) - Date.parse(a)) / 60000);
}

interface RenderLimits {
  prompt: number;
  reply: number;
  toolsPerGroup: number;
}

function renderItems(items: DigestItem[], lim: RenderLimits): string[] {
  const out: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    switch (it.kind) {
      case "prompt":
        out.push(`[${hm(it.at)}] konaito: ${it.text.length > lim.prompt ? `${it.text.slice(0, lim.prompt)}…（以下略）` : it.text}`);
        break;
      case "command":
        out.push(`[${hm(it.at)}] konaito がコマンド実行: ${it.text}`);
        break;
      case "shell":
        out.push(`[${hm(it.at)}] konaito がシェル実行: ! ${it.text}`);
        break;
      case "interrupt":
        out.push(`[${hm(it.at)}] konaito が中断した`);
        break;
      case "reply":
        out.push(`[${hm(it.at)}] Claude: ${it.text.length > lim.reply ? `${it.text.slice(0, lim.reply)}…（以下略）` : it.text}`);
        break;
      case "tool": {
        // 連続するツール呼び出しは1行にまとめる
        const group: (DigestItem & { kind: "tool" })[] = [it];
        while (items[i + 1]?.kind === "tool") group.push(items[++i] as DigestItem & { kind: "tool" });
        const parts = group.slice(0, lim.toolsPerGroup).map((t) => {
          const s = t.summary ? `${t.name}「${t.summary}」` : t.name;
          return t.isError ? `${s}（エラー）` : s;
        });
        const rest = group.length - parts.length;
        out.push(`[${hm(it.at)}] ツール: ${parts.join(" / ")}${rest > 0 ? ` ほか${rest}件` : ""}`);
        break;
      }
    }
  }
  return out;
}

export function renderDigest(d: Digest, budgetChars = 80_000): string {
  const meta: string[] = [];
  meta.push("# 確定情報");
  meta.push(`- プロジェクト: ${d.cwd ?? "不明"}`);
  if (d.gitBranch) meta.push(`- ブランチ: ${d.gitBranch}`);
  if (d.title) meta.push(`- セッション名（自動生成）: ${d.title}`);
  const mins = minutesBetween(d.spanStartAt, d.spanEndAt);
  meta.push(`- 範囲: ${hm(d.spanStartAt ?? "")} 〜 ${hm(d.spanEndAt ?? "")}（東京時間${mins !== null ? `、約${mins}分` : ""}）`);
  meta.push(`- konaito の依頼: ${d.stats.user_prompts}件、スラッシュコマンド: ${d.stats.slash_commands}件、中断: ${d.stats.interrupts}件`);
  const toolTop = Object.entries(d.stats.tools).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${v}`).join("、");
  meta.push(`- ツール呼び出し: ${d.stats.tool_calls}件（${toolTop || "なし"}）、うちエラー ${d.stats.tool_errors}件`);
  if (d.filesTouched.length) meta.push(`- 書き込んだファイル: ${d.filesTouched.slice(0, 30).join("、")}${d.filesTouched.length > 30 ? ` ほか${d.filesTouched.length - 30}件` : ""}`);
  if (d.prUrls.length) meta.push(`- PR: ${d.prUrls.join("、")}`);
  const head = `${meta.join("\n")}\n\n# 経過\n`;

  const tiers: RenderLimits[] = [
    { prompt: 4000, reply: 2500, toolsPerGroup: 8 },
    { prompt: 1500, reply: 700, toolsPerGroup: 4 },
    { prompt: 600, reply: 250, toolsPerGroup: 2 },
  ];
  let lines: string[] = [];
  for (const lim of tiers) {
    lines = renderItems(d.items, lim);
    if (head.length + lines.join("\n").length <= budgetChars) return head + lines.join("\n");
  }
  // それでも長いときは、冒頭と終盤を残して中ほどを省く
  const keepHead = Math.floor(lines.length * 0.3);
  const room = budgetChars - head.length;
  const top: string[] = [];
  let used = 0;
  for (const l of lines.slice(0, keepHead)) {
    if (used + l.length > room * 0.35) break;
    top.push(l);
    used += l.length + 1;
  }
  const tail: string[] = [];
  for (let i = lines.length - 1; i >= top.length; i--) {
    const l = lines[i]!;
    if (used + l.length > room - 40) break;
    tail.unshift(l);
    used += l.length + 1;
  }
  const omitted = lines.length - top.length - tail.length;
  return `${head}${top.join("\n")}\n（中略：${omitted}件）\n${tail.join("\n")}`;
}
