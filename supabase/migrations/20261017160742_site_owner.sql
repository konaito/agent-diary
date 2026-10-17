SET local check_function_bodies = off;

CREATE TABLE "public"."site_owner" (
  "singleton"  boolean                  NOT NULL DEFAULT true,
  "user_id"    uuid                     NOT NULL,
  "claimed_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "site_owner_pkey" PRIMARY KEY (singleton),
  CONSTRAINT "site_owner_singleton_check" CHECK (singleton)
);

ALTER TABLE "public"."site_owner"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.claim_site()
  RETURNS boolean
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RETURN false;
  END IF;
  INSERT INTO public.site_owner (user_id) VALUES ((SELECT auth.uid()))
  ON CONFLICT (singleton) DO NOTHING;
  RETURN public.is_site_owner();
END;
$function$;

REVOKE ALL ON FUNCTION "public"."claim_site"() FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.is_site_owner()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  SELECT EXISTS (SELECT 1 FROM public.site_owner WHERE user_id = (SELECT auth.uid()));
$function$;

REVOKE ALL ON FUNCTION "public"."is_site_owner"() FROM PUBLIC, "anon";

ALTER TABLE "public"."site_owner"
  ADD CONSTRAINT "site_owner_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE POLICY "cc_sessions_owner_select" ON "public"."cc_sessions"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_site_owner() AS is_site_owner));

CREATE POLICY "diary_entries_owner_select" ON "public"."diary_entries"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_site_owner() AS is_site_owner));

COMMENT ON FUNCTION "public"."claim_site"() IS '持ち主が未登録なら呼び出したユーザーを持ち主にする';

COMMENT ON FUNCTION "public"."is_site_owner"() IS 'ログイン中のユーザーが日記サイトの持ち主かどうか';

COMMENT ON TABLE "public"."site_owner" IS '日記サイトを見られるユーザー。1行だけ。消すと次に訪れたユーザーが持ち主になる';

GRANT EXECUTE ON FUNCTION "public"."claim_site"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."claim_site"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_site"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."claim_site"() TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."is_site_owner"() TO "authenticated";

REVOKE ALL ON FUNCTION "public"."is_site_owner"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_site_owner"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_site_owner"() TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."site_owner" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."site_owner" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."site_owner" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."site_owner" TO "service_role";
