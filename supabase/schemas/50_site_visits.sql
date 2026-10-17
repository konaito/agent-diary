-- 日記のページを開いた記録。訪問者は全員匿名ログインするので、user_id の種類数が訪れた人数になる
CREATE TABLE public.site_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  view text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_visits_view_check CHECK (view IN ('owner', 'locked', 'demo'))
);

COMMENT ON TABLE public.site_visits IS '日記のページを開いた記録。ページを読み込むたびに1行';
COMMENT ON COLUMN public.site_visits.user_id IS '開いた匿名ユーザー。ユーザーを消しても訪問の行は残す';
COMMENT ON COLUMN public.site_visits.view IS 'owner は日記、locked は閉じた画面、demo はデモを見た';

CREATE INDEX site_visits_user_id_idx ON public.site_visits (user_id);
CREATE INDEX site_visits_visited_at_idx ON public.site_visits (visited_at DESC);

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;

-- 明細は持ち主だけが読める。書き込みは record_visit() 経由だけ
CREATE POLICY site_visits_owner_select ON public.site_visits
  FOR SELECT TO authenticated
  USING ((SELECT public.is_site_owner()));

CREATE FUNCTION public.visit_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object('visitors', count(DISTINCT user_id), 'visits', count(*))
  FROM public.site_visits;
$$;

COMMENT ON FUNCTION public.visit_stats() IS '訪れた人数（匿名ユーザーの種類数）と訪問回数';

CREATE FUNCTION public.record_visit(p_view text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'record_visit requires a signed-in user';
  END IF;
  INSERT INTO public.site_visits (user_id, view) VALUES ((SELECT auth.uid()), p_view);
  RETURN public.visit_stats();
END;
$$;

COMMENT ON FUNCTION public.record_visit(text) IS 'ページを開いた記録を1行足し、visit_stats() を返す';

REVOKE EXECUTE ON FUNCTION public.visit_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.visit_stats() TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_visit(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_visit(text) TO authenticated;
