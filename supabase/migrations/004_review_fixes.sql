-- 코드 리뷰 지적사항 반영 (2026-07-21)
--
-- 1) 관리자 판별을 "이메일 문자열" 에서 "admins 테이블 등록" 으로 바꾼다
-- 2) 주문에 PROCESSING 상태를 추가한다 (동시 승인 경쟁 조건 차단용)
-- 3) products.name 에 unique 를 걸어 시드 재실행 시 중복을 막는다

-- ============================================================
-- 1. 관리자 테이블
--
-- 기존 방식은 is_admin() 이 JWT 의 email == 'admin@admin.com' 인지만 봤다.
-- 이메일 인증을 꺼둔 상태라, 만약 그 계정이 삭제되면 아무나 그 주소로
-- 가입해서 전체 주문과 구매자 이메일을 볼 수 있었다.
-- 이제는 "이 UUID 가 admins 에 등록돼 있는가" 로 판단한다.
-- 이메일을 새로 선점해도 admins 에 없으면 관리자가 아니다.
-- ============================================================
create table if not exists public.admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;
-- 정책을 하나도 만들지 않는다 → 클라이언트는 이 테이블을 읽지도 쓰지도 못한다.
-- is_admin() 은 security definer 라 함수 안에서만 읽을 수 있다.

-- 현재 admin@admin.com 계정을 관리자로 등록
insert into public.admins (user_id)
select id from auth.users where email = 'admin@admin.com'
on conflict (user_id) do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  )
$$;

-- ============================================================
-- 2. PROCESSING 상태 추가
--
-- 왜 필요한가:
--   결제 확인 페이지를 두 탭에서 동시에 열면, 두 요청이 모두 주문을
--   PENDING 으로 읽는다. 하나가 승인에 성공해 PAID 로 바꿔도, 다른 하나는
--   토스에서 "이미 처리됨" 거부를 받고 그 주문을 FAILED 로 덮어썼다.
--   → 실제로는 결제됐는데 화면에는 실패로 보이는 상태.
--
--   이제 Edge Function 이 PENDING → PROCESSING 으로 먼저 "선점" 한다.
--   선점에 실패한(= 이미 다른 요청이 처리 중인) 쪽은 즉시 물러난다.
-- ============================================================
alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('PENDING', 'PROCESSING', 'PAID', 'FAILED'));

-- 주문 생성은 여전히 PENDING 으로만 가능하다 (기존 정책 유지 확인용)
drop policy if exists orders_insert_own_pending on public.orders;
create policy orders_insert_own_pending on public.orders
  for insert with check (auth.uid() = user_id and status = 'PENDING');

-- ============================================================
-- 3. 상품명 중복 방지
--
-- 002_seed_products.sql 의 on conflict do nothing 은 unique 제약이 없어서
-- 아무것도 막지 못했다. 시드를 두 번 실행하면 같은 상품이 6개 더 생겼다.
-- ============================================================
delete from public.products a
using public.products b
where a.name = b.name and a.ctid > b.ctid;

alter table public.products drop constraint if exists products_name_key;
alter table public.products add constraint products_name_key unique (name);
