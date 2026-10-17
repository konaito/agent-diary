-- Claude Code のセッション1件につき1行。値はトランスクリプトから読み取って更新する。
CREATE TABLE public.cc_sessions (
  session_id uuid PRIMARY KEY,
  project_dir text NOT NULL,
  project_name text GENERATED ALWAYS AS (regexp_replace(project_dir, '^.*/', '')) STORED,
  git_branch text,
  entrypoint text,
  cc_version text,
  title text,
  transcript_path text NOT NULL,
  first_event_at timestamptz,
  last_event_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cc_sessions IS 'Claude Code のセッション。session_id は Claude Code が振る UUID';
COMMENT ON COLUMN public.cc_sessions.project_dir IS 'セッションを起動したディレクトリ（SessionEnd の cwd）';
COMMENT ON COLUMN public.cc_sessions.project_name IS 'project_dir の末尾のディレクトリ名';
COMMENT ON COLUMN public.cc_sessions.git_branch IS 'トランスクリプト最後のメッセージ時点の git ブランチ';
COMMENT ON COLUMN public.cc_sessions.entrypoint IS 'cli / claude-desktop / sdk-cli / sdk-py など。日記の対象かどうかの判定に使う';
COMMENT ON COLUMN public.cc_sessions.cc_version IS 'Claude Code のバージョン';
COMMENT ON COLUMN public.cc_sessions.title IS 'custom-title があればそれ、なければ ai-title';
COMMENT ON COLUMN public.cc_sessions.first_event_at IS 'トランスクリプト最初のメッセージ時刻';
COMMENT ON COLUMN public.cc_sessions.last_event_at IS 'トランスクリプト最後のメッセージ時刻';

CREATE INDEX cc_sessions_project_dir_idx ON public.cc_sessions (project_dir);

CREATE TRIGGER cc_sessions_set_updated_at
  BEFORE UPDATE ON public.cc_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ワーカーは postgres ロールで直接接続する。REST からは読ませない。
ALTER TABLE public.cc_sessions ENABLE ROW LEVEL SECURITY;
