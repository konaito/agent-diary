SET local check_function_bodies = off;

CREATE TABLE "public"."cc_sessions" (
  "session_id"      uuid                     NOT NULL,
  "project_dir"     text                     NOT NULL,
  "git_branch"      text,
  "entrypoint"      text,
  "cc_version"      text,
  "title"           text,
  "transcript_path" text                     NOT NULL,
  "first_event_at"  timestamp with time zone,
  "last_event_at"   timestamp with time zone,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cc_sessions_pkey" PRIMARY KEY (session_id)
);

ALTER TABLE "public"."cc_sessions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."diary_entries" (
  "id"                  bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "session_id"          uuid                     NOT NULL,
  "end_reason"          text                     NOT NULL,
  "ended_at"            timestamp with time zone NOT NULL,
  "hook_input"          jsonb                    NOT NULL,
  "attempts"            smallint                 NOT NULL DEFAULT 0,
  "last_error"          text,
  "skip_reason"         text,
  "span_started_at"     timestamp with time zone,
  "span_ended_at"       timestamp with time zone,
  "last_message_uuid"   text,
  "title"               text,
  "body"                text,
  "did"                 text[]                   NOT NULL DEFAULT '{}'::text[],
  "failed"              text[]                   NOT NULL DEFAULT '{}'::text[],
  "learned"             text[]                   NOT NULL DEFAULT '{}'::text[],
  "open_threads"        text[]                   NOT NULL DEFAULT '{}'::text[],
  "tags"                text[]                   NOT NULL DEFAULT '{}'::text[],
  "files_touched"       text[]                   NOT NULL DEFAULT '{}'::text[],
  "pr_urls"             text[]                   NOT NULL DEFAULT '{}'::text[],
  "stats"               jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "model"               text,
  "generation_cost_usd" numeric(10,6),
  "written_at"          timestamp with time zone,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "diary_entries_attempts_check" CHECK ((attempts >= 0)),
  CONSTRAINT "diary_entries_pkey" PRIMARY KEY (id),
  CONSTRAINT "diary_entries_session_ended_key" UNIQUE (session_id, ended_at)
);

ALTER TABLE "public"."diary_entries"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."cc_sessions"
  ADD COLUMN "project_name" text GENERATED ALWAYS AS (regexp_replace(project_dir, '^.*/'::text, ''::text)) STORED;

ALTER TABLE "public"."diary_entries"
  ADD COLUMN "diary_date" date GENERATED ALWAYS AS (((ended_at AT TIME ZONE 'Asia/Tokyo'::text))::date) STORED;

CREATE TYPE "public"."diary_entry_status" AS ENUM (
  'pending',
  'generating',
  'written',
  'skipped',
  'failed'
);

ALTER TABLE "public"."diary_entries"
  ADD COLUMN "status" public.diary_entry_status NOT NULL DEFAULT 'pending'::public.diary_entry_status;

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

ALTER TABLE "public"."diary_entries"
  ADD CONSTRAINT "diary_entries_session_id_fkey" FOREIGN KEY (session_id) REFERENCES public.cc_sessions(session_id) ON DELETE CASCADE;

ALTER TABLE "public"."diary_entries"
  ADD CONSTRAINT "diary_entries_skipped_check" CHECK (((status <> 'skipped'::public.diary_entry_status) OR (skip_reason IS NOT NULL)));

ALTER TABLE "public"."diary_entries"
  ADD CONSTRAINT "diary_entries_written_check" CHECK (((status <> 'written'::public.diary_entry_status) OR ((title IS NOT NULL) AND (body IS NOT NULL) AND (written_at IS
    NOT NULL))));

CREATE VIEW "public"."daily_diary" WITH (security_invoker=true) AS  SELECT e.diary_date,
    count(*) AS entry_count,
    array_agg(DISTINCT s.project_name ORDER BY s.project_name) AS projects,
    sum(COALESCE(((e.stats ->> 'user_prompts'::text))::integer, 0)) AS user_prompts,
    sum(COALESCE(((e.stats ->> 'tool_calls'::text))::integer, 0)) AS tool_calls,
    string_agg(format('## %s

%s · %s

%s'::text, e.title, s.project_name, to_char((e.ended_at AT TIME ZONE 'Asia/Tokyo'::text), 'HH24:MI'::text), e.body), '

'::text ORDER BY e.ended_at) AS markdown
   FROM (public.diary_entries e
     JOIN public.cc_sessions s USING (session_id))
  WHERE (e.status = 'written'::public.diary_entry_status)
  GROUP BY e.diary_date;

CREATE INDEX cc_sessions_project_dir_idx ON public.cc_sessions USING btree (project_dir);

CREATE INDEX diary_entries_diary_date_idx ON public.diary_entries USING btree (diary_date DESC, ended_at);

CREATE INDEX diary_entries_queue_idx ON public.diary_entries USING btree (ended_at)
  WHERE (status = ANY (ARRAY['pending'::public.diary_entry_status, 'generating'::public.diary_entry_status, 'failed'::public.diary_entry_status]));

CREATE INDEX diary_entries_session_id_idx ON public.diary_entries USING btree (session_id, ended_at);

CREATE INDEX diary_entries_tags_idx ON public.diary_entries USING gin (tags);

CREATE TRIGGER cc_sessions_set_updated_at
  BEFORE UPDATE ON public.cc_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER diary_entries_set_updated_at
  BEFORE UPDATE ON public.diary_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

COMMENT ON COLUMN "public"."cc_sessions"."cc_version" IS 'Claude Code のバージョン';

COMMENT ON COLUMN "public"."cc_sessions"."entrypoint" IS 'cli / claude-desktop / sdk-cli / sdk-py など。日記の対象かどうかの判定に使う';

COMMENT ON COLUMN "public"."cc_sessions"."first_event_at" IS 'トランスクリプト最初のメッセージ時刻';

COMMENT ON COLUMN "public"."cc_sessions"."git_branch" IS 'トランスクリプト最後のメッセージ時点の git ブランチ';

COMMENT ON COLUMN "public"."cc_sessions"."last_event_at" IS 'トランスクリプト最後のメッセージ時刻';

COMMENT ON COLUMN "public"."cc_sessions"."project_dir" IS 'セッションを起動したディレクトリ（SessionEnd の cwd）';

COMMENT ON COLUMN "public"."cc_sessions"."project_name" IS 'project_dir の末尾のディレクトリ名';

COMMENT ON COLUMN "public"."cc_sessions"."title" IS 'custom-title があればそれ、なければ ai-title';

COMMENT ON COLUMN "public"."diary_entries"."attempts" IS '生成を試みた回数';

COMMENT ON COLUMN "public"."diary_entries"."body" IS '日記本文。常体、一人称は自分';

COMMENT ON COLUMN "public"."diary_entries"."diary_date" IS 'ended_at の東京の日付。日記の日付';

COMMENT ON COLUMN "public"."diary_entries"."did" IS '終わったこと';

COMMENT ON COLUMN "public"."diary_entries"."end_reason" IS 'SessionEnd の reason。clear / resume / logout / prompt_input_exit / other。Claude Code が値を増やしても受け取れるよう enum にしない';

COMMENT ON COLUMN "public"."diary_entries"."ended_at" IS 'フックが SessionEnd を受け取った時刻';

COMMENT ON COLUMN "public"."diary_entries"."failed" IS 'うまくいかなかったこと、訂正されたこと';

COMMENT ON COLUMN "public"."diary_entries"."files_touched" IS 'Edit / Write / NotebookEdit で書き込んだファイル。トランスクリプトから機械的に抽出';

COMMENT ON COLUMN "public"."diary_entries"."hook_input" IS 'SessionEnd フックが受け取った JSON そのまま';

COMMENT ON COLUMN "public"."diary_entries"."last_message_uuid" IS 'この日記が読んだ最後のメッセージの uuid。次の SessionEnd はこの後ろから読む';

COMMENT ON COLUMN "public"."diary_entries"."learned" IS 'このセッションで分かったこと';

COMMENT ON COLUMN "public"."diary_entries"."model" IS '日記を書いたモデル';

COMMENT ON COLUMN "public"."diary_entries"."open_threads" IS '未完了、保留、次にやること';

COMMENT ON COLUMN "public"."diary_entries"."pr_urls" IS '範囲内で作成・更新された PR の URL';

COMMENT ON COLUMN "public"."diary_entries"."skip_reason" IS 'skipped にした理由。entrypoint:sdk-py、no_user_prompt など';

COMMENT ON COLUMN "public"."diary_entries"."span_ended_at" IS 'この日記が扱う範囲の最後のメッセージ時刻';

COMMENT ON COLUMN "public"."diary_entries"."span_started_at" IS 'この日記が扱う範囲の最初のメッセージ時刻';

COMMENT ON COLUMN "public"."diary_entries"."stats" IS '依頼数、ツール呼び出し数などの集計。トランスクリプトから機械的に抽出';

COMMENT ON TABLE "public"."cc_sessions" IS 'Claude Code のセッション。session_id は Claude Code が振る UUID';

COMMENT ON TABLE "public"."diary_entries" IS 'Claude Code が書いたセッションごとの日記。SessionEnd フックの受信キューも兼ねる';

COMMENT ON VIEW "public"."daily_diary" IS '書き終えた日記を東京の日付ごとにまとめたもの';

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO "service_role";

REVOKE ALL ON SEQUENCE "public"."diary_entries_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."diary_entries_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."diary_entries_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."diary_entries_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."diary_entries_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."diary_entries_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."diary_entries_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."diary_entries_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cc_sessions" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."cc_sessions" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cc_sessions" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cc_sessions" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."diary_entries" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."diary_entries" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."diary_entries" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."diary_entries" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."daily_diary" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."daily_diary" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."daily_diary" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."daily_diary" TO "service_role";
