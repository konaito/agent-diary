-- エージェントが MCP などから日記を1件書くための入口。持ち主だけが呼べる。
-- フックとワーカーを通さずに書く日記は、セッションも合わせてここで作る。
CREATE FUNCTION public.write_diary(
  p_title text,
  p_body text,
  p_project text DEFAULT NULL,
  p_agent text DEFAULT NULL,
  p_did text[] DEFAULT '{}',
  p_failed text[] DEFAULT '{}',
  p_learned text[] DEFAULT '{}',
  p_open_threads text[] DEFAULT '{}',
  p_tags text[] DEFAULT '{}',
  p_pr_urls text[] DEFAULT '{}',
  p_files_touched text[] DEFAULT '{}',
  p_git_branch text DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_started_at timestamptz DEFAULT NULL,
  p_ended_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session uuid := coalesce(p_session_id, gen_random_uuid());
  v_ended timestamptz := coalesce(p_ended_at, now());
  v_id bigint;
  v_date date;
BEGIN
  IF NOT public.is_site_owner() THEN
    RAISE EXCEPTION 'only the site owner can write diary entries' USING ERRCODE = '42501';
  END IF;
  IF coalesce(btrim(p_title), '') = '' OR coalesce(btrim(p_body), '') = '' THEN
    RAISE EXCEPTION 'title and body are required' USING ERRCODE = '22023';
  END IF;
  IF length(p_title) > 200 OR length(p_body) > 20000 THEN
    RAISE EXCEPTION 'title must be at most 200 characters and body at most 20000' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.cc_sessions (session_id, project_dir, transcript_path, entrypoint, git_branch, title, first_event_at, last_event_at)
  VALUES (
    v_session,
    coalesce(nullif(btrim(p_project), ''), 'unknown'),
    'mcp',
    'mcp' || coalesce(':' || nullif(btrim(p_agent), ''), ''),
    p_git_branch,
    p_title,
    coalesce(p_started_at, v_ended),
    v_ended
  )
  ON CONFLICT (session_id) DO UPDATE SET last_event_at = excluded.last_event_at;

  INSERT INTO public.diary_entries (
    session_id, end_reason, ended_at, hook_input, status,
    span_started_at, span_ended_at, title, body,
    did, failed, learned, open_threads, tags, pr_urls, files_touched,
    stats, model, written_at
  )
  VALUES (
    v_session, 'mcp', v_ended,
    jsonb_build_object('source', 'mcp', 'agent', p_agent, 'client_id', (SELECT auth.jwt() ->> 'client_id')),
    'written',
    p_started_at, v_ended, btrim(p_title), btrim(p_body),
    p_did, p_failed, p_learned, p_open_threads, p_tags, p_pr_urls, p_files_touched,
    '{}'::jsonb, p_agent, now()
  )
  RETURNING id, diary_date INTO v_id, v_date;

  RETURN jsonb_build_object('id', v_id, 'diary_date', v_date, 'session_id', v_session);
END;
$$;

COMMENT ON FUNCTION public.write_diary IS 'エージェントが日記を1件書く。持ち主のトークンでだけ呼べる。session_id を省くと新しいセッションとして書く';

REVOKE EXECUTE ON FUNCTION public.write_diary FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_diary TO authenticated;
