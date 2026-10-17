SET local check_function_bodies = off;

CREATE TABLE "public"."site_visits" (
  "id"         bigint                   GENERATED ALWAYS AS IDENTITY NOT NULL,
  "user_id"    uuid,
  "view"       text                     NOT NULL,
  "visited_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "site_visits_pkey" PRIMARY KEY (id),
  CONSTRAINT "site_visits_view_check" CHECK ((view = ANY (ARRAY['owner'::text, 'locked'::text, 'demo'::text])))
);

ALTER TABLE "public"."site_visits"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_visit (
  p_view text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'record_visit requires a signed-in user';
  END IF;
  INSERT INTO public.site_visits (user_id, view) VALUES ((SELECT auth.uid()), p_view);
  RETURN public.visit_stats();
END;
$function$;

REVOKE ALL ON FUNCTION "public"."record_visit"(text) FROM PUBLIC, "anon";

CREATE OR REPLACE FUNCTION public.visit_stats()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  SELECT jsonb_build_object('visitors', count(DISTINCT user_id), 'visits', count(*))
  FROM public.site_visits;
$function$;

ALTER TABLE "public"."site_visits"
  ADD CONSTRAINT "site_visits_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX site_visits_user_id_idx ON public.site_visits USING btree (user_id);

CREATE INDEX site_visits_visited_at_idx ON public.site_visits USING btree (visited_at DESC);

CREATE POLICY "site_visits_owner_select" ON "public"."site_visits"
  FOR SELECT
  TO "authenticated"
  USING (( SELECT public.is_site_owner() AS is_site_owner));

COMMENT ON COLUMN "public"."site_visits"."user_id" IS '開いた匿名ユーザー。ユーザーを消しても訪問の行は残す';

COMMENT ON COLUMN "public"."site_visits"."view" IS 'owner は日記、locked は閉じた画面、demo はデモを見た';

COMMENT ON FUNCTION "public"."record_visit"(text) IS 'ページを開いた記録を1行足し、visit_stats() を返す';

COMMENT ON FUNCTION "public"."visit_stats"() IS '訪れた人数（匿名ユーザーの種類数）と訪問回数';

COMMENT ON TABLE "public"."site_visits" IS '日記のページを開いた記録。ページを読み込むたびに1行';

GRANT EXECUTE ON FUNCTION "public"."record_visit"(text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."record_visit"(text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_visit"(text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."record_visit"(text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."visit_stats"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."visit_stats"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."visit_stats"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."visit_stats"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."visit_stats"() TO "service_role";

REVOKE ALL ON SEQUENCE "public"."site_visits_id_seq" FROM "anon";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."site_visits_id_seq" TO "anon";

REVOKE ALL ON SEQUENCE "public"."site_visits_id_seq" FROM "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."site_visits_id_seq" TO "authenticated";

REVOKE ALL ON SEQUENCE "public"."site_visits_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."site_visits_id_seq" TO "postgres";

REVOKE ALL ON SEQUENCE "public"."site_visits_id_seq" FROM "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."site_visits_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."site_visits" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."site_visits" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."site_visits" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."site_visits" TO "service_role";
