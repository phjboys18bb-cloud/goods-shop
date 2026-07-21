/* ---- 표시용 포맷 헬퍼 ----------------------------------------------------
   페이지마다 반복되는 "원화 표기 · 날짜 표기 · 상태 배지"를 한곳에 모았다.
------------------------------------------------------------------------- */
(function () {
  'use strict';

  var STATUS_LABEL = {
    PAID:    { text: '결제완료', cls: 'paid' },
    PENDING: { text: '결제대기', cls: 'pending' },
    FAILED:  { text: '결제실패', cls: 'failed' }
  };

  window.Fmt = {
    /* 12000 → "12,000원" */
    won: function (n) {
      var v = Number(n);
      if (!isFinite(v)) return '-';
      return v.toLocaleString('ko-KR') + '원';
    },

    /* ISO 문자열 → "2026. 7. 21. 오후 3:04" */
    date: function (iso) {
      if (!iso) return '-';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleString('ko-KR', {
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      });
    },

    /* 상태 배지 HTML. 알 수 없는 값이 와도 화면이 깨지지 않게 처리한다. */
    statusBadge: function (status) {
      var s = STATUS_LABEL[status] || { text: String(status || '알수없음'), cls: 'pending' };
      return '<span class="status ' + s.cls + '">' + window.Fmt.escape(s.text) + '</span>';
    },

    /* HTML 삽입 전 이스케이프.
       상품명·이메일처럼 사람이 넣은 값을 innerHTML 에 넣을 때 반드시 통과시킨다.
       (이걸 빼먹으면 상품명에 <script> 를 넣는 식의 XSS 가 가능해진다) */
    escape: function (str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  };
})();
