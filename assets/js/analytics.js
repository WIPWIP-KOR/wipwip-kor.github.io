(function () {
  'use strict';

  // GA4 기본 집계(페이지뷰·체류시간) 외에 이 사이트에서만 의미 있는 두 가지를 더 보낸다.
  // 계산기를 실제로 돌리는지, 검색에서 무엇을 찾다가 못 찾는지.
  //
  // 계산기 쪽은 JS 9개를 건드리지 않는다 — 전부 <form id="calc-form">을 쓰므로
  // 전역에서 submit 하나만 듣는다.

  function send(name, params) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', name, params || {});
  }

  // ── 계산기 사용 ────────────────────────────────────────────────────
  // 어느 계산기를 몇 번 돌렸는지. 다음 계산기를 뭘 만들지 정하는 근거가 된다.
  var calcForm = document.getElementById('calc-form');
  if (calcForm) {
    var slug = window.location.pathname.replace(/^\/|\/$/g, '').split('/').pop();
    calcForm.addEventListener('submit', function () {
      send('calculator_run', { calculator: slug });
    });
    calcForm.addEventListener('reset', function () {
      send('calculator_reset', { calculator: slug });
    });
  }

  // ── 사이트 내 검색 ──────────────────────────────────────────────────
  // search.js가 결과 건수까지 실어 보낸다. 0건 질의가 가장 값진 데이터다 —
  // 사람들이 찾는데 우리에게 없는 것이 바로 다음에 쓸 글이다.
  document.addEventListener('wipwip:search', function (e) {
    var d = e.detail || {};
    if (!d.q) return;
    send('search', { search_term: d.q, results: d.hits });
    if (d.hits === 0) send('search_no_results', { search_term: d.q });
  });

  // ── 오류 제보 클릭 ──────────────────────────────────────────────────
  // 댓글 대신 둔 창구가 실제로 눌리는지.
  var cta = document.querySelector('.post-feedback-cta');
  if (cta) {
    cta.addEventListener('click', function () {
      send('feedback_click', { page: window.location.pathname });
    });
  }
})();
