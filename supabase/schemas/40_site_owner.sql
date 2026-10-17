-- 日記サイトの持ち主。最初に訪れて claim_site() を呼んだユーザー1人だけが入る。
-- singleton を主キーにして常に true に固定し、2行目が入らないようにしている。
CREATE TABLE public.site_owner (
  singleton boolean PRIMARY KEY DEFAULT true,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_owner_singleton_check CHECK (singleton)
);

COMMENT ON TABLE public.site_owner IS '日記サイトを見られるユーザー。1行だけ。消すと次に訪れたユーザーが持ち主になる';

-- 行はポリシーを付けず、関数経由でだけ読み書きする
ALTER TABLE public.site_owner ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.is_site_owner()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_owner WHERE user_id = (SELECT auth.uid()));
$$;

COMMENT ON FUNCTION public.is_site_owner() IS 'ログイン中のユーザーが日記サイトの持ち主かどうか';

-- 持ち主がまだいなければ呼んだユーザーを持ち主にする。戻り値は呼んだユーザーが持ち主かどうか
CREATE FUNCTION public.claim_site()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.site_owner (user_id) VALUES ((SELECT auth.uid()))
  ON CONFLICT (singleton) DO NOTHING;
  RETURN public.is_site_owner();
END;
$$;

COMMENT ON FUNCTION public.claim_site() IS '持ち主が未登録なら呼び出したユーザーを持ち主にする';

REVOKE EXECUTE ON FUNCTION public.is_site_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_site_owner() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_site() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_site() TO authenticated;

CREATE POLICY cc_sessions_owner_select ON public.cc_sessions
  FOR SELECT TO authenticated
  USING ((SELECT public.is_site_owner()));

CREATE POLICY diary_entries_owner_select ON public.diary_entries
  FOR SELECT TO authenticated
  USING ((SELECT public.is_site_owner()));

-- 持ち主が決まっているかだけを返す。未ログインでも呼べる。
-- ページはこれを見て、持ち主が決まった後の訪問者には匿名ログインさせない（匿名ユーザーを増やさない）
CREATE FUNCTION public.site_is_claimed()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (SELECT 1 FROM public.site_owner);
$$;

COMMENT ON FUNCTION public.site_is_claimed() IS '日記サイトの持ち主が登録済みかどうか';

REVOKE EXECUTE ON FUNCTION public.site_is_claimed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.site_is_claimed() TO anon, authenticated;
