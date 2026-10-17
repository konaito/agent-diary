-- 日記エントリの処理状態。この値は cc-diary のワーカーだけが書く。
CREATE TYPE public.diary_entry_status AS ENUM (
  'pending',     -- SessionEnd を受け取り、日記の生成待ち
  'generating',  -- ワーカーが claude -p で生成中
  'written',     -- 日記を書き終えた
  'skipped',     -- 書く対象ではないと判断した（skip_reason に理由）
  'failed'       -- 生成に失敗した（last_error に理由、attempts で再試行回数を管理）
);

CREATE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
