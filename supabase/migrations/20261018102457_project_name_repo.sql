-- pg-delta はビューと列を消して作り直す差分を出したが、PG17 の SET EXPRESSION なら列とビューを残したまま式だけ変えられる
ALTER TABLE "public"."cc_sessions"
  ALTER COLUMN "project_name" SET EXPRESSION AS
    (regexp_replace(regexp_replace(regexp_replace(project_dir, '/\.claude/worktrees/.*$'::text, ''::text), '^(/private)?/tmp/claude-[0-9]+/[^/]+/[0-9a-f-]{36}/scratchpad'::text,
    '/tmp'::text), '^.*/'::text, ''::text));

COMMENT ON COLUMN "public"."cc_sessions"."project_name" IS 'project_dir の末尾のディレクトリ名。.claude/worktrees/ の下ならリポジトリのディレクトリ名、一時フォルダの scratchpad なら tmp';
