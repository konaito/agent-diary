// agent-diary の MCP サーバー。
// MCP クライアントは Supabase Auth の OAuth 2.1 でログインする。ログイン画面は GitHub Pages の docs/oauth/consent.html で、
// 持ち主はメールに届く数字のコード（OTP）でログインして許可する。ツールはログインしたユーザーの権限で動き、RLS がそのまま効く。
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { pipeline } from "@supabase/middleware";
import { withOAuthProtectedResource, withSupabase } from "@supabase/server";
import { z } from "zod";

import type { Database } from "./database.types.ts";

const ENTRY_COLUMNS =
  "id, diary_date, ended_at, span_started_at, title, body, did, failed, learned, open_threads, tags, pr_urls, files_touched, cc_sessions(project_name, git_branch, entrypoint)";

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

const tokyoDate = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(d);

const WRITE_GUIDE = [
  "このセッションで自分がした作業の日記を1件書く。",
  "書くのはセッションで実際に起きた事実だけ。起きていない結果、数値、理由を足さない。終わったか分からないことは終わったと書かない。",
  "一人称は「自分」、相手は名前で呼び、文末は常体（だ・である）でそろえる。感情の演技や締めの決まり文句は書かない。",
  "body は依頼、やったこと、結果を時系列で書く。did は終わったこと、failed はうまくいかなかったことや訂正されたこと、",
  "learned は分かった事実、open_threads は未完了や次にやること。該当がなければ空配列にする。",
].join("");

Deno.serve(
  pipeline(
    [withOAuthProtectedResource(), withSupabase<Database>({ auth: "user" })],
    async (req, { supabase }) => {
      // Edge Function は状態を持たないので、リクエストごとにサーバーを作る
      const handler = createMcpHandler(() => {
        const server = new McpServer({ name: "agent-diary", version: "0.1.0" });

        server.registerTool(
          "whoami",
          {
            description: "ログインしているユーザーと、日記の持ち主かどうかを返す。書き込みは持ち主だけができる。",
            inputSchema: z.object({}),
            annotations: { readOnlyHint: true },
          },
          async () => {
            const { data: { user } } = await supabase.auth.getUser();
            const { data: isOwner } = await supabase.rpc("is_site_owner");
            return json({ user_id: user?.id ?? null, email: user?.email ?? null, is_owner: isOwner === true });
          },
        );

        server.registerTool(
          "write_diary",
          {
            description: WRITE_GUIDE,
            inputSchema: z.object({
              title: z.string().min(1).max(200).describe("一番大きかった出来事を20字前後で"),
              body: z.string().min(1).max(20000).describe("日記本文。段落は空行で区切る"),
              project: z.string().max(200).optional().describe("作業したプロジェクト名（ディレクトリ名）"),
              agent: z.string().max(100).optional().describe("書いているエージェントの名前（例: claude-code, codex）"),
              did: z.array(z.string()).max(50).default([]),
              failed: z.array(z.string()).max(50).default([]),
              learned: z.array(z.string()).max(50).default([]),
              open_threads: z.array(z.string()).max(50).default([]),
              tags: z.array(z.string()).max(10).default([]),
              pr_urls: z.array(z.string()).max(20).default([]),
              files_touched: z.array(z.string()).max(200).default([]),
              git_branch: z.string().max(200).optional(),
              session_id: z.string().uuid().optional().describe("同じセッションの続きとして書くときだけ指定する"),
              started_at: z.string().datetime({ offset: true }).optional().describe("作業を始めた時刻（ISO 8601）"),
              ended_at: z.string().datetime({ offset: true }).optional().describe("作業を終えた時刻（ISO 8601）。省くと今"),
            }),
          },
          async (a) => {
            const { data, error } = await supabase.rpc("write_diary", {
              p_title: a.title,
              p_body: a.body,
              p_project: a.project,
              p_agent: a.agent,
              p_did: a.did,
              p_failed: a.failed,
              p_learned: a.learned,
              p_open_threads: a.open_threads,
              p_tags: a.tags,
              p_pr_urls: a.pr_urls,
              p_files_touched: a.files_touched,
              p_git_branch: a.git_branch,
              p_session_id: a.session_id,
              p_started_at: a.started_at,
              p_ended_at: a.ended_at,
            });
            if (error) throw new Error(error.message);
            return json(data);
          },
        );

        server.registerTool(
          "list_diary",
          {
            description: "書き終えた日記を新しい順に返す。date を指定するとその日（東京の日付）だけ、指定しなければ直近 days 日分。",
            inputSchema: z.object({
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD"),
              days: z.number().int().min(1).max(90).default(7),
              project: z.string().optional().describe("プロジェクト名で絞る"),
              limit: z.number().int().min(1).max(100).default(20),
            }),
            annotations: { readOnlyHint: true },
          },
          async ({ date, days, project, limit }) => {
            let q = supabase.from("diary_entries").select(ENTRY_COLUMNS).eq("status", "written");
            if (date) q = q.eq("diary_date", date);
            else q = q.gte("diary_date", tokyoDate(new Date(Date.now() - (days - 1) * 86_400_000)));
            const { data, error } = await q.order("ended_at", { ascending: false }).limit(project ? 200 : limit);
            if (error) throw new Error(error.message);
            const rows = project ? (data ?? []).filter((r) => r.cc_sessions?.project_name === project).slice(0, limit) : data;
            return json(rows);
          },
        );

        server.registerTool(
          "search_diary",
          {
            description: "題と本文に言葉が含まれる日記を新しい順に返す。",
            inputSchema: z.object({
              query: z.string().min(1).max(100),
              limit: z.number().int().min(1).max(50).default(10),
            }),
            annotations: { readOnlyHint: true },
          },
          async ({ query, limit }) => {
            // PostgREST の or 構文で意味を持つ文字を外す
            const term = query.replace(/[,()*\\%_]/g, " ").trim();
            if (!term) return json([]);
            const { data, error } = await supabase
              .from("diary_entries")
              .select(ENTRY_COLUMNS)
              .eq("status", "written")
              .or(`title.ilike.*${term}*,body.ilike.*${term}*`)
              .order("ended_at", { ascending: false })
              .limit(limit);
            if (error) throw new Error(error.message);
            return json(data);
          },
        );

        return server;
      });

      return handler.fetch(req);
    },
  ),
);
