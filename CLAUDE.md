# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

굿즈를 파는 작은 웹사이트. 정적 HTML/CSS/JS를 GitHub Pages에 올리고, 데이터·인증·결제 승인은 Supabase가 담당한다. 결제는 토스페이먼츠 **테스트 모드**라 실제 돈은 움직이지 않는다.

만든 사람은 입문자다. 코드를 고칠 때 **왜 그렇게 하는지**를 주석과 문서에 남긴다. 세부 구조는 [ARCH.md](ARCH.md)에 있다.

| 항목 | 값 |
|---|---|
| 배포 주소 | https://phjboys18bb-cloud.github.io/goods-shop/ |
| GitHub | `phjboys18bb-cloud/goods-shop` (public) |
| Supabase 프로젝트 | `goods-shop` · ref `yotgbllpqcjhrmmhqsep` · 서울(ap-northeast-2) |
| 관리자 계정 | `admin@admin.com` |

## 빌드·테스트 없음

빌드 도구, 패키지 매니저, 테스트 스위트가 없다. 파일을 고치고 브라우저로 열면 끝이다.

```powershell
start index.html      # 브라우저로 열기 (결제까지 테스트하려면 배포본을 써야 함)
```

**로컬 `file://` 로는 결제 흐름을 끝까지 테스트할 수 없다.** 토스가 리다이렉트로 돌려보내는 `successUrl`이 `file://`을 허용하지 않기 때문이다. 결제 검증은 배포된 Pages 주소에서 한다.

## 절대 하면 안 되는 것

**시크릿 키를 이 저장소에 넣지 않는다.** 공개 저장소다.

이 폴더에 있어도 되는 값(전부 `assets/config.js`에 있음):
- `SUPABASE_ANON_KEY` — 익명 키. 이 키로 뭘 할 수 있는지는 RLS가 통제한다.
- `TOSS_CLIENT_KEY` (`test_ck_...`) — 결제창을 띄우는 용도.

절대 넣으면 안 되는 값:
- `service_role` 키, `sb_secret_...` — RLS를 무시하는 마스터 키
- 토스 시크릿 키 (`test_sk_...`, `live_sk_...`) — 결제 승인 권한

시크릿 키는 **Supabase Edge Function 환경변수**에만 있다 (`TOSS_SECRET_KEY`). 대시보드 → Edge Functions → Secrets에서 관리한다.

**보안 판단을 프론트엔드에 맡기지 않는다.** `admin.html`의 `if (!App.isAdmin(user))`는 화면 편의용이다. 실제 차단은 DB의 `is_admin()`과 RLS 정책이 한다. 프론트의 if문은 개발자도구로 지울 수 있지만 RLS는 못 지운다.

**결제 금액을 브라우저 값으로 믿지 않는다.** Edge Function이 `products.price × quantity`로 다시 계산해서 대조한다. 이 검증을 지우면 5만원짜리를 100원에 살 수 있게 된다.

## 코드 관례

- **CSS 변수로만 색을 쓴다.** 인라인에 색상값을 직접 적지 않고 `assets/style.css`의 `:root`에 토큰을 추가한다. 라이트 모드가 기본, 다크는 `@media (prefers-color-scheme: dark)`로 덮는다. **양쪽 다 확인**한다.
- **JS는 ES5 스타일 IIFE.** `var`, `function`, 문자열 결합을 쓴다. 빌드 도구가 없어서 트랜스파일이 안 되기 때문이다.
- **`innerHTML`에 넣는 값은 반드시 `Fmt.escape()`를 통과시킨다.** 상품명·이메일처럼 사람이 넣은 값이 그냥 들어가면 XSS가 된다.
- **클래스명은 짧고 평평하게.** `.card`, `.order`, `.status.paid` 식. BEM 안 쓴다.
- **`prefers-reduced-motion`을 존중한다.** 새 애니메이션을 넣으면 그 미디어쿼리에도 대응한다.
- 아이콘은 이모지를 쓴다. 아이콘 폰트나 SVG 스프라이트 없다.

## 자주 하는 작업

**상품 추가·수정** — Supabase 대시보드 → Table Editor → `products`. 또는 `supabase/migrations/002_seed_products.sql`을 고쳐서 SQL Editor에 붙여넣는다.

**DB 스키마 변경** — `supabase/migrations/`에 새 `.sql` 파일을 만들고 대시보드 SQL Editor에서 실행한다. 이 폴더는 기록용이며 자동 적용되지 않는다.

**Edge Function 수정** — `supabase/functions/confirm-payment/index.ts`를 고친 뒤 재배포해야 반영된다. 로컬 파일만 고치면 아무 일도 안 일어난다.

**토스 키를 본인 것으로 교체** — 클라이언트 키는 `assets/config.js`, 시크릿 키는 Supabase 대시보드 Secrets. 두 키는 **같은 상점의 쌍이어야** 한다. 섞으면 승인이 실패한다.

## 배포

`main`에 push하면 GitHub Pages가 약 30초 뒤 반영한다. 성공을 가정하지 말고 URL이 200을 주는지 확인한다.

```powershell
git add -A; git commit -m "메시지"; git push
```

## 미완성 · 범위 밖

의도적으로 안 만든 것들이다. 버그가 아니다.

- **재고가 줄지 않는다.** 결제해도 `products.stock`은 그대로다.
- **환불·주문취소 없다.** 토스 취소 API를 연동하지 않았다.
- **장바구니 없다.** 한 번에 한 상품, 수량 1개 고정이다.
- **관리자가 상품을 수정하는 화면이 없다.** 조회만 된다.
- **결제창을 닫으면 `PENDING` 주문이 남는다.** 정리 로직이 없다.
