-- SessionEnd 1回につき1行。/resume で同じセッションが再び終わると、その差分だけを書いた行が増える。
CREATE TABLE public.diary_entries (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES public.cc_sessions (session_id) ON DELETE CASCADE,
  end_reason text NOT NULL,
  ended_at timestamptz NOT NULL,
  diary_date date GENERATED ALWAYS AS ((ended_at AT TIME ZONE 'Asia/Tokyo')::date) STORED,
  hook_input jsonb NOT NULL,
  status public.diary_entry_status NOT NULL DEFAULT 'pending',
  attempts smallint NOT NULL DEFAULT 0,
  last_error text,
  skip_reason text,
  span_started_at timestamptz,
  span_ended_at timestamptz,
  last_message_uuid text,
  title text,
  body text,
  did text[] NOT NULL DEFAULT '{}',
  failed text[] NOT NULL DEFAULT '{}',
  learned text[] NOT NULL DEFAULT '{}',
  open_threads text[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  files_touched text[] NOT NULL DEFAULT '{}',
  pr_urls text[] NOT NULL DEFAULT '{}',
  stats jsonb NOT NULL DEFAULT '{}',
  model text,
  generation_cost_usd numeric(10, 6),
  written_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diary_entries_session_ended_key UNIQUE (session_id, ended_at),
  CONSTRAINT diary_entries_attempts_check CHECK (attempts >= 0),
  CONSTRAINT diary_entries_written_check CHECK (status <> 'written' OR (title IS NOT NULL AND body IS NOT NULL AND written_at IS NOT NULL)),
  CONSTRAINT diary_entries_skipped_check CHECK (status <> 'skipped' OR skip_reason IS NOT NULL)
);

COMMENT ON TABLE public.diary_entries IS 'Claude Code が書いたセッションごとの日記。SessionEnd フックの受信キューも兼ねる';
COMMENT ON COLUMN public.diary_entries.end_reason IS 'SessionEnd の reason。clear / resume / logout / prompt_input_exit / other。Claude Code が値を増やしても受け取れるよう enum にしない';
COMMENT ON COLUMN public.diary_entries.ended_at IS 'フックが SessionEnd を受け取った時刻';
COMMENT ON COLUMN public.diary_entries.diary_date IS 'ended_at の東京の日付。日記の日付';
COMMENT ON COLUMN public.diary_entries.hook_input IS 'SessionEnd フックが受け取った JSON そのまま';
COMMENT ON COLUMN public.diary_entries.attempts IS '生成を試みた回数';
COMMENT ON COLUMN public.diary_entries.skip_reason IS 'skipped にした理由。entrypoint:sdk-py、no_user_prompt など';
COMMENT ON COLUMN public.diary_entries.span_started_at IS 'この日記が扱う範囲の最初のメッセージ時刻';
COMMENT ON COLUMN public.diary_entries.span_ended_at IS 'この日記が扱う範囲の最後のメッセージ時刻';
COMMENT ON COLUMN public.diary_entries.last_message_uuid IS 'この日記が読んだ最後のメッセージの uuid。次の SessionEnd はこの後ろから読む';
COMMENT ON COLUMN public.diary_entries.body IS '日記本文。常体、一人称は自分';
COMMENT ON COLUMN public.diary_entries.did IS '終わったこと';
COMMENT ON COLUMN public.diary_entries.failed IS 'うまくいかなかったこと、訂正されたこと';
COMMENT ON COLUMN public.diary_entries.learned IS 'このセッションで分かったこと';
COMMENT ON COLUMN public.diary_entries.open_threads IS '未完了、保留、次にやること';
COMMENT ON COLUMN public.diary_entries.files_touched IS 'Edit / Write / NotebookEdit で書き込んだファイル。トランスクリプトから機械的に抽出';
COMMENT ON COLUMN public.diary_entries.pr_urls IS '範囲内で作成・更新された PR の URL';
COMMENT ON COLUMN public.diary_entries.stats IS '依頼数、ツール呼び出し数などの集計。トランスクリプトから機械的に抽出';
COMMENT ON COLUMN public.diary_entries.model IS '日記を書いたモデル';

CREATE INDEX diary_entries_diary_date_idx ON public.diary_entries (diary_date DESC, ended_at);
CREATE INDEX diary_entries_session_id_idx ON public.diary_entries (session_id, ended_at);
CREATE INDEX diary_entries_queue_idx ON public.diary_entries (ended_at) WHERE status IN ('pending', 'generating', 'failed');
CREATE INDEX diary_entries_tags_idx ON public.diary_entries USING gin (tags);

CREATE TRIGGER diary_entries_set_updated_at
  BEFORE UPDATE ON public.diary_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.diary_entries ENABLE ROW LEVEL SECURITY;
