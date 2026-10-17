import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CursorNotFoundError, parseTranscript, parseUserText, renderDigest } from "../src/transcript.ts";

const base = { sessionId: "s1", cwd: "/w/proj", gitBranch: "main", version: "2.1.301", entrypoint: "cli", isSidechain: false };
const user = (uuid: string, content: unknown, extra: Record<string, unknown> = {}) =>
  ({ ...base, type: "user", uuid, timestamp: `2026-10-17T0${uuid.length}:00:00Z`, message: { role: "user", content }, ...extra });
const asst = (uuid: string, content: unknown[]) =>
  ({ ...base, type: "assistant", uuid, timestamp: "2026-10-17T05:00:00Z", message: { role: "assistant", content } });

function fixture(lines: unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ccd-"));
  const p = join(dir, "t.jsonl");
  writeFileSync(p, lines.map((l) => JSON.stringify(l)).join("\n"));
  return p;
}

describe("parseUserText", () => {
  test("slash command with caveat and stdout", () => {
    const r = parseUserText("<local-command-caveat>x</local-command-caveat>\n<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>");
    expect(r.commands).toEqual(["/model opus"]);
    expect(r.prompt).toBeNull();
  });
  test("system-reminder is stripped and remaining text is the prompt", () => {
    const r = parseUserText("<system-reminder>\nnoise\n</system-reminder>\nこれ直して");
    expect(r.prompt).toBe("これ直して");
  });
  test("task notification with trailing boilerplate is dropped", () => {
    const r = parseUserText("<task-notification>\n<status>completed</status>\n</task-notification>\nRead the output file to retrieve the result: /x");
    expect(r.prompt).toBeNull();
  });
  test("interrupt marker", () => {
    expect(parseUserText("[Request interrupted by user for tool use]").interrupt).toBe(true);
  });
  test("pasted html counts as prompt but flags the tag", () => {
    const r = parseUserText("<div>hello</div>");
    expect(r.prompt).toBe("<div>hello</div>");
    expect(r.unknownTag).toBe("div");
  });
});

describe("parseTranscript", () => {
  const lines = [
    { type: "ai-title", aiTitle: "テスト", sessionId: "s1" },
    user("u1", "最初の依頼"),
    asst("a1", [{ type: "thinking", thinking: "..." }, { type: "text", text: "やります" }, { type: "tool_use", id: "t1", name: "Edit", input: { file_path: "/w/proj/a.ts" } }]),
    user("u22", [{ type: "tool_result", tool_use_id: "t1", is_error: true, content: "boom" }]),
    user("u333", "要約", { isCompactSummary: true }),
    user("u4444", "<task-notification>x</task-notification>", { origin: { kind: "task-notification" } }),
    { type: "pr-link", sessionId: "s1", prUrl: "https://github.com/x/y/pull/1" },
    user("u55555", "次の依頼"),
    asst("a2", [{ type: "tool_use", id: "t2", name: "Bash", input: { command: "ls", description: "List files" } }]),
  ];

  test("whole file", async () => {
    const d = await parseTranscript(fixture(lines));
    expect(d.title).toBe("テスト");
    expect(d.stats.user_prompts).toBe(2);
    expect(d.stats.tool_calls).toBe(2);
    expect(d.stats.tool_errors).toBe(1);
    expect(d.filesTouched).toEqual(["/w/proj/a.ts"]);
    expect(d.prUrls).toEqual(["https://github.com/x/y/pull/1"]);
    expect(d.lastUuid).toBe("a2");
    expect(d.anomalies["skip:compact-summary"]).toBe(1);
    expect(d.anomalies["skip:origin:task-notification"]).toBe(1);
    const text = renderDigest(d);
    expect(text).toContain("Edit「/w/proj/a.ts」（エラー）");
    expect(text).toContain("konaito: 次の依頼");
  });

  test("afterUuid reads only the part after the cursor", async () => {
    const d = await parseTranscript(fixture(lines), { afterUuid: "u22" });
    expect(d.stats.user_prompts).toBe(1);
    expect(d.items.find((i) => i.kind === "prompt")).toMatchObject({ text: "次の依頼" });
    expect(d.filesTouched).toEqual([]);
    expect(d.prUrls).toEqual(["https://github.com/x/y/pull/1"]);
    // セッション全体のメタ情報は範囲に関係なく取る
    expect(d.title).toBe("テスト");
    expect(d.firstEventAt).not.toBeNull();
  });

  test("afterUuid at the last message yields an empty span", async () => {
    const d = await parseTranscript(fixture(lines), { afterUuid: "a2" });
    expect(d.items).toEqual([]);
    expect(d.lastUuid).toBeNull();
  });

  test("missing cursor throws", async () => {
    expect(parseTranscript(fixture(lines), { afterUuid: "nope" })).rejects.toBeInstanceOf(CursorNotFoundError);
  });

  test("render respects the budget by eliding the middle", async () => {
    const many = [user("u1", "始め"), ...Array.from({ length: 400 }, (_, i) => asst(`a${i}`, [{ type: "text", text: "x".repeat(3000) }])), user("u2", "終わり")];
    const text = renderDigest(await parseTranscript(fixture(many)), 20_000);
    expect(text.length).toBeLessThanOrEqual(20_000);
    expect(text).toContain("中略");
    expect(text).toContain("終わり");
  });
});
