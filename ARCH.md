# ARCH.md — 구조 문서

[CLAUDE.md](CLAUDE.md)가 "무엇을 하면 안 되는지"라면, 이 문서는 "어떻게 돌아가는지"다.

---

## 1. 전체 그림

```
   브라우저 (GitHub Pages · 정적 파일)
        │
        ├── Supabase Auth        로그인 / 회원가입
        ├── Supabase DB          상품 조회, 주문 기록  ← RLS가 접근을 통제
        └── Supabase Edge Function ─── 토스 승인 API
                (여기에만 시크릿 키)
```

GitHub Pages는 **서버가 없다.** HTML 파일을 그대로 내려줄 뿐이라 비밀을 숨길 곳이 없다. 그래서 비밀이 필요한 일(결제 승인)은 전부 Edge Function이 맡는다.

---

## 2. 파일 구조

| 파일 | 역할 |
|---|---|
| `index.html` | 상품 목록. 결제 시작점 |
| `login.html` | 로그인 / 회원가입 (탭 전환) |
| `orders.html` | 내 결제 내역 |
| `admin.html` | 관리자 — 전체 결제 내역 |
| `payment-success.html` | 토스가 돌려보내는 착지점. **여기서 승인 요청을 보낸다** |
| `payment-fail.html` | 결제 취소·실패 안내 |
| `assets/config.js` | 공개해도 되는 설정값 (Supabase URL, anon key, 토스 클라이언트 키) |
| `assets/auth.js` | Supabase 클라이언트 생성, 로그인 상태, 헤더 렌더 |
| `assets/format.js` | 원화·날짜 포맷, 상태 배지, **HTML 이스케이프** |
| `assets/style.css` | 전체 디자인. 색은 전부 CSS 변수 |
| `supabase/migrations/*.sql` | DB 스키마 기록 (자동 적용 안 됨) |
| `supabase/functions/confirm-payment/index.ts` | 결제 승인 서버 |

스크립트 로딩 순서는 고정이다: `supabase CDN` → `config.js` → `format.js` → `auth.js` → 페이지 스크립트.

---

## 3. 데이터베이스

### products

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | PK |
| `name` | text | 상품명 |
| `description` | text | 설명 |
| `price` | integer | 원 단위 정수. **가격의 기준점** |
| `emoji` | text | 이미지 대신 쓰는 이모지 |
| `stock` | integer | 재고 (현재 자동 차감 안 함) |

### orders

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | `auth.users` 참조 |
| `product_id` | uuid | `products` 참조 |
| `order_id` | text | 토스에 넘기는 주문번호. `od_<시각>_<난수>` |
| `quantity` | integer | 수량 (현재 항상 1) |
| `amount` | integer | 결제 요청 금액. **서버가 다시 검증한다** |
| `status` | text | `PENDING` / `PAID` / `FAILED` |
| `payment_key` | text | 토스 결제 키. 승인 성공 시 기록 |
| `toss_raw` | jsonb | 토스 응답 원본 (문제 생겼을 때 추적용) |
| `paid_at` | timestamptz | 승인 완료 시각 |

---

## 4. 보안 — RLS

RLS(Row Level Security)는 "이 행을 누가 볼 수 있는가"를 **DB가 직접 판단**하는 기능이다. 프론트엔드 JS의 조건문은 개발자도구로 지울 수 있지만, RLS는 지울 수 없다.

```sql
-- 관리자 판별: JWT 안의 이메일을 본다
create function is_admin() returns boolean language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@admin.com'
$$;
```

| 테이블 | 동작 | 정책 |
|---|---|---|
| `products` | SELECT | 누구나 (`using (true)`) |
| `products` | INSERT/UPDATE/DELETE | **정책 없음 → 전부 차단** |
| `orders` | SELECT | `auth.uid() = user_id or is_admin()` |
| `orders` | INSERT | `auth.uid() = user_id and status = 'PENDING'` |
| `orders` | UPDATE/DELETE | **정책 없음 → 전부 차단** |

`orders`에 UPDATE 정책을 **일부러 안 만든 것**이 핵심이다. 클라이언트는 `status`를 `PAID`로 바꿀 수 없다. 오직 Edge Function만 (service_role 키로 RLS를 우회해서) 바꿀 수 있다.

### admin_all_orders()

구매자 이메일은 `auth.users`에 있는데 이 테이블은 클라이언트가 직접 못 읽는다. 그래서 `security definer` 함수로 필요한 열만 골라 돌려준다.

`security definer`는 **함수 소유자 권한으로 실행**된다는 뜻이라, 함수 첫 줄에서 `is_admin()`을 직접 확인하지 않으면 아무나 전체 주문을 보게 된다. 그 확인이 들어있다.

---

## 5. 결제 흐름

```
① index.html
   상품 클릭 → 로그인 확인
   orders에 PENDING 삽입 (order_id 발급)
        │
② 토스 결제창  TossPayments(clientKey).payment({customerKey}).requestPayment({...})
   SDK: https://js.tosspayments.com/v2/standard
        │  결제 인증 완료
        ↓  successUrl 로 리다이렉트 (?paymentKey=..&orderId=..&amount=..)
③ payment-success.html
   쿼리에서 값 추출 → Edge Function 호출
   헤더: Authorization: Bearer <사용자 액세스 토큰>
        │
④ confirm-payment (Edge Function)
   1. 사용자 확인          로그인 안 했으면 401
   2. 주문 조회            없으면 404
   3. 본인 주문인가?       아니면 403   ← 남의 주문 승인 차단
   4. 이미 PAID인가?       맞으면 그대로 성공 반환  ← 중복 승인 차단
   5. 금액 대조            products.price × quantity ≠ amount 면 400 + FAILED 기록
                                              ↑ 가장 중요한 방어선
   6. 토스 승인 API 호출   POST https://api.tosspayments.com/v1/payments/confirm
                          Authorization: Basic base64(시크릿키 + ":")
   7. 결과 기록            성공 → PAID / 실패 → FAILED
        │
⑤ orders.html 에서 확인
```

### Edge Function 계약

`POST {SUPABASE_URL}/functions/v1/confirm-payment`

요청 헤더 — `Authorization: Bearer <access_token>`, `apikey: <anon key>`

```json
{ "paymentKey": "...", "orderId": "od_...", "amount": 18000 }
```

| 응답 | 의미 |
|---|---|
| `200 {ok:true}` | 승인 완료 |
| `200 {ok:true, alreadyPaid:true}` | 이미 결제됨 (중복 호출) |
| `400` | 금액 불일치 또는 토스 승인 거부 |
| `401` | 로그인 필요 |
| `403` | 본인 주문 아님 |
| `404` | 없는 주문 |
| `409` | 진행할 수 없는 상태 |

환경변수: `TOSS_SECRET_KEY`(직접 등록), `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY`(자동 주입)

---

## 6. 알려진 한계

| 항목 | 현재 상태 |
|---|---|
| 재고 차감 | 결제해도 `stock`이 안 줄어든다 |
| 환불 | 미구현 |
| 장바구니 | 없음. 1상품 1개 고정 |
| 버려진 PENDING | 결제창을 닫으면 그대로 남는다 |
| 상품 관리 UI | 없음. 대시보드에서 직접 수정 |
| `customerKey` | 사용자 UUID를 쓴다 (이메일 같은 유추 가능한 값 금지 규칙 준수) |
