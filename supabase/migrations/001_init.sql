-- 굿즈 판매 사이트 초기 스키마
-- 실행: Supabase Management API /database/query 또는 대시보드 SQL Editor

-- ============================================================
-- 1. 상품
-- ============================================================
create table if not exists public.products (
  id          uuid primary key default gen_random_uuid(),
  name        text    not null,
  description text,
  price       integer not null check (price >= 0),   -- 원 단위 정수
  emoji       text,                                   -- 이미지 대신 이모지
  stock       integer not null default 100 check (stock >= 0),
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. 주문 / 결제
-- ============================================================
create table if not exists public.orders (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  product_id  uuid not null references public.products(id),
  order_id    text unique not null,          -- 토스에 넘기는 주문번호
  quantity    integer not null default 1 check (quantity > 0),
  amount      integer not null check (amount >= 0),
  status      text not null default 'PENDING'
              check (status in ('PENDING', 'PAID', 'FAILED')),
  payment_key text,                          -- 토스 결제 키 (승인 후 기록)
  toss_raw    jsonb,                         -- 토스 응답 원본
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

create index if not exists orders_user_id_idx    on public.orders (user_id);
create index if not exists orders_created_at_idx on public.orders (created_at desc);

-- ============================================================
-- 3. 관리자 판별 함수
--    JWT 안의 이메일을 보고 관리자인지 판단한다.
--    프론트 JS 의 if 문은 개발자도구로 우회되지만, 이건 DB 가 판단하므로 우회 불가.
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@admin.com'
$$;

-- ============================================================
-- 4. RLS (Row Level Security)
-- ============================================================
alter table public.products enable row level security;
alter table public.orders   enable row level security;

-- 상품: 누구나 읽기. 쓰기 정책이 없으므로 클라이언트는 수정/삭제 불가.
drop policy if exists products_read_all on public.products;
create policy products_read_all on public.products
  for select using (true);

-- 주문 조회: 본인 것만. 단 관리자는 전체.
drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_own_or_admin on public.orders
  for select using (auth.uid() = user_id or public.is_admin());

-- 주문 생성: 본인 user_id 로, PENDING 상태로만 만들 수 있다.
-- (amount 를 조작해서 넣어도 Edge Function 이 products.price 와 대조해 걸러낸다)
drop policy if exists orders_insert_own_pending on public.orders;
create policy orders_insert_own_pending on public.orders
  for insert with check (auth.uid() = user_id and status = 'PENDING');

-- update / delete 정책은 일부러 만들지 않는다.
-- → 클라이언트는 status 나 payment_key 를 절대 바꿀 수 없다.
-- → Edge Function 은 service_role 키를 쓰므로 RLS 를 우회해서 갱신한다.
