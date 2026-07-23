-- anon(로그아웃) 키 권한을 코드가 실제로 쓰는 만큼으로 좁힌다. (2026-07-23)
--
-- 왜:
--   보안 어드바이저가 "anon 이 관리자 함수(is_admin·admin_all_orders)를
--   호출할 수 있다"고 경고했다. 코드상 로그아웃 사용자가 하는 일은
--   "상품 목록 읽기" 하나뿐이므로, 나머지는 전부 잠근다.
--
-- 적용 후 anon 이 할 수 있는 일:
--   - products SELECT (상점 둘러보기)  ← 유일하게 허용
--   - 그 외 전부 차단 (주문 조회·생성·관리자 함수)

-- 1) 주문 정책을 "로그인 사용자" 로 한정
--    anon 은 orders 에 정책 자체가 없어 기본 거부(빈 결과)가 되고,
--    정책 평가 과정에서 is_admin() 을 건드리지도 않는다.
drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_own_or_admin on public.orders
  for select to authenticated
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists orders_insert_own_pending on public.orders;
create policy orders_insert_own_pending on public.orders
  for insert to authenticated
  with check (auth.uid() = user_id and status = 'PENDING');

-- 2) 관리자 함수는 로그인 사용자만 호출 가능 (anon·public 차단)
--    - is_admin()        : orders SELECT 정책 평가에 필요하므로 authenticated 유지
--    - admin_all_orders(): 함수 내부에서 다시 is_admin() 으로 막는 이중 방어
revoke all on function public.is_admin()         from public, anon;
revoke all on function public.admin_all_orders() from public, anon;
grant execute on function public.is_admin()         to authenticated;
grant execute on function public.admin_all_orders() to authenticated;

-- products 는 그대로 둔다: 로그아웃 사용자도 상점을 봐야 하므로 public SELECT 유지.
--
-- 참고 — 어드바이저에 남는 항목과 이유(의도된 상태):
--   * admins 테이블 "RLS enabled, no policy" (INFO)
--       → 일부러 정책을 안 만들어 클라이언트 접근을 전면 차단. is_admin() 만 접근.
--   * is_admin / admin_all_orders 를 authenticated 가 실행 가능 (WARN)
--       → is_admin 은 RLS 평가에 필요, admin_all_orders 는 관리자(=로그인 사용자)가
--         써야 하고 내부에서 재검증하므로 둘 다 유지가 맞다.
