SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.site_is_claimed()
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  SELECT EXISTS (SELECT 1 FROM public.site_owner);
$function$;

COMMENT ON FUNCTION "public"."site_is_claimed"() IS '日記サイトの持ち主が登録済みかどうか';

REVOKE ALL ON FUNCTION "public"."site_is_claimed"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."site_is_claimed"() TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."site_is_claimed"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."site_is_claimed"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."site_is_claimed"() TO "service_role";
