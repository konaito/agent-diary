-- 1日分の日記をまとめて読むためのビュー
CREATE VIEW public.daily_diary
WITH (security_invoker = true)
AS
SELECT
  e.diary_date,
  count(*) AS entry_count,
  array_agg(DISTINCT s.project_name ORDER BY s.project_name) AS projects,
  sum(coalesce((e.stats ->> 'user_prompts')::int, 0)) AS user_prompts,
  sum(coalesce((e.stats ->> 'tool_calls')::int, 0)) AS tool_calls,
  string_agg(
    format(E'## %s\n\n%s · %s\n\n%s', e.title, s.project_name, to_char(e.ended_at AT TIME ZONE 'Asia/Tokyo', 'HH24:MI'), e.body),
    E'\n\n' ORDER BY e.ended_at
  ) AS markdown
FROM public.diary_entries AS e
JOIN public.cc_sessions AS s USING (session_id)
WHERE e.status = 'written'
GROUP BY e.diary_date;

COMMENT ON VIEW public.daily_diary IS '書き終えた日記を東京の日付ごとにまとめたもの';
