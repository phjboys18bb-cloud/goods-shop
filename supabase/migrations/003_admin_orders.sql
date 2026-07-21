-- 관리자 전용: 전체 주문 + 구매자 이메일 조회
--
-- 왜 함수로 만드나:
--   구매자 이메일은 auth.users 테이블에 있는데, 이 테이블은 보안상
--   클라이언트에서 직접 조회할 수 없다. 그래서 "관리자일 때만" 필요한 열만
--   골라서 돌려주는 함수를 따로 만든다.
--
-- security definer = 함수를 만든 사람(관리자) 권한으로 실행된다.
--   → auth.users 를 읽을 수 있다.
--   → 그래서 함수 첫 줄에서 반드시 is_admin() 을 직접 확인해야 한다.
--     (이 확인을 빼먹으면 아무나 전체 주문을 볼 수 있게 된다)

create or replace function public.admin_all_orders()
returns table (
  order_id      text,
  amount        integer,
  status        text,
  created_at    timestamptz,
  paid_at       timestamptz,
  buyer_email   text,
  product_name  text,
  product_emoji text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception '관리자만 조회할 수 있습니다.' using errcode = '42501';
  end if;

  return query
    select o.order_id,
           o.amount,
           o.status,
           o.created_at,
           o.paid_at,
           u.email::text,
           p.name,
           p.emoji
    from public.orders o
    join auth.users u        on u.id = o.user_id
    left join public.products p on p.id = o.product_id
    order by o.created_at desc;
end;
$$;

-- 로그인한 사용자만 호출 시도라도 할 수 있게 하고,
-- 실제 통과 여부는 함수 안의 is_admin() 이 결정한다.
revoke all on function public.admin_all_orders() from public;
grant execute on function public.admin_all_orders() to authenticated;
