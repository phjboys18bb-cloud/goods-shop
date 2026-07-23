/* ---- Supabase 클라이언트 + 로그인 상태 관리 -------------------------------
   모든 페이지가 이 파일을 읽는다.
   로드 순서: supabase CDN → config.js → format.js → auth.js
   (auth.js 는 renderHeader 에서 Fmt.escape 를 쓰므로 format.js 뒤여야 한다)
------------------------------------------------------------------------- */
(function () {
  'use strict';

  var cfg = window.APP_CONFIG;

  /* Supabase 라이브러리(CDN)가 안 실려오면 App 이 아예 없어서, 각 페이지의
     App.getUser() 가 'App is not defined' 로 죽고 화면엔 스피너만 남는다.
     그런 상황에서도 사용자에게 원인을 알리도록, 모든 메서드가 안내를 띄우는
     "실패 스텁" 으로 App 을 정의해 둔다. */
  if (!window.supabase || !window.supabase.createClient) {
    console.error('Supabase 라이브러리를 불러오지 못했습니다.');
    var msg = '네트워크 문제로 필요한 라이브러리를 불러오지 못했습니다. 새로고침하거나 잠시 후 다시 시도해 주세요.';
    var rejected = function () { return Promise.reject(new Error(msg)); };
    window.App = {
      sb: null,
      getUser: function () { return Promise.resolve(null); },
      getToken: function () { return Promise.resolve(null); },
      isAdmin: function () { return false; },
      requireLogin: rejected,
      logout: function () { location.reload(); },
      markActiveNav: function () {},
      renderHeader: function () {
        var box = document.getElementById('authBox');
        if (box) box.textContent = '연결 오류';
      }
    };
    return;
  }

  var sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  window.App = {
    sb: sb,

    /* 현재 로그인한 사용자. 없으면 null */
    getUser: function () {
      return sb.auth.getUser().then(function (res) {
        return (res && res.data && res.data.user) || null;
      }).catch(function () { return null; });
    },

    /* 현재 세션의 액세스 토큰. Edge Function 호출할 때 필요하다. */
    getToken: function () {
      return sb.auth.getSession().then(function (res) {
        return (res && res.data && res.data.session && res.data.session.access_token) || null;
      }).catch(function () { return null; });
    },

    /* 이 사용자가 관리자인가.
       화면 편의용 판단일 뿐이고, 실제 차단은 DB 의 RLS 정책이 한다. */
    isAdmin: function (user) {
      return !!user && user.email === cfg.ADMIN_EMAIL;
    },

    /* 로그인이 필요한 페이지에서 호출. 비로그인이면 login.html 로 보낸다. */
    requireLogin: function () {
      return window.App.getUser().then(function (user) {
        if (!user) {
          var back = encodeURIComponent(location.pathname.split('/').pop() || 'index.html');
          location.replace('login.html?next=' + back);
          return null;
        }
        return user;
      });
    },

    logout: function () {
      return sb.auth.signOut().then(function () { location.href = 'index.html'; });
    },

    /* 헤더의 로그인 영역을 상태에 맞게 그린다. */
    renderHeader: function (user) {
      var box = document.getElementById('authBox');
      if (!box) return;

      if (!user) {
        box.innerHTML = '<a class="btn btn-sm" href="login.html">로그인</a>';
        return;
      }

      var adminLink = window.App.isAdmin(user)
        ? '<a href="admin.html">관리자</a>'
        : '';

      box.innerHTML =
        adminLink +
        '<a href="orders.html">결제내역</a>' +
        '<span class="who">' + window.Fmt.escape(user.email) + '</span>' +
        '<button type="button" class="btn btn-ghost btn-sm" id="logoutBtn">로그아웃</button>';

      var btn = document.getElementById('logoutBtn');
      if (btn) btn.addEventListener('click', window.App.logout);
    },

    /* 현재 페이지에 해당하는 내비 링크에 표시를 준다. */
    markActiveNav: function () {
      var here = location.pathname.split('/').pop() || 'index.html';
      var links = document.querySelectorAll('nav.site a');
      Array.prototype.forEach.call(links, function (a) {
        if (a.getAttribute('href') === here) a.classList.add('active');
      });
    }
  };
})();
