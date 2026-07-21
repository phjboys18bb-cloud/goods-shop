/* ---- 프로젝트 설정 ------------------------------------------------------
   여기 있는 값은 전부 "브라우저에 공개돼도 안전한" 값이다.
   공개 저장소에 올라가도 문제없다.

   - SUPABASE_ANON_KEY : 익명 키. 이 키로 할 수 있는 일은 RLS 정책이 통제한다.
                         (남의 주문을 조회하거나 주문 상태를 바꾸는 건 불가능)
   - TOSS_CLIENT_KEY   : 토스 클라이언트 키. 결제창을 띄우는 용도로만 쓴다.

   절대 여기에 넣으면 안 되는 것:
   - service_role 키 / sb_secret_ 로 시작하는 키  → RLS 를 무시하는 마스터 키
   - TOSS 시크릿 키 (test_sk_ / live_sk_)         → 결제 승인 권한
   두 키는 Supabase Edge Function 환경변수에만 있고, 이 폴더 어디에도 없다.
------------------------------------------------------------------------- */
window.APP_CONFIG = {
  SUPABASE_URL: 'https://yotgbllpqcjhrmmhqsep.supabase.co',
  SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlvdGdibGxwcWNqaHJtbWhxc2VwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MTMxMzksImV4cCI6MjEwMDE4OTEzOX0.WTzumQxF9kHzz8fPlDU_vwhAucFSYfayBV0rfoN7sp8',

  /* 토스페이먼츠 공개 문서용 테스트 키.
     본인 키로 바꾸려면 developers.tosspayments.com 에서 발급받아 이 값만 교체하면 된다.
     (시크릿 키는 Supabase 대시보드 > Edge Functions > Secrets 에서 교체) */
  TOSS_CLIENT_KEY: 'test_ck_D5GePWvyJnrK0W0k6q8gLzN97Eoq',

  /* 관리자 이메일. DB 의 is_admin() 함수와 반드시 같은 값이어야 한다. */
  ADMIN_EMAIL: 'admin@admin.com'
};
