(function () {
  'use strict';

  var form = document.querySelector('.site-search');
  if (!form) return;

  var input = form.querySelector('.site-search-input');
  var list = form.querySelector('.site-search-results');
  var status = form.querySelector('.site-search-status');
  var url = form.getAttribute('data-index');

  var data = null;
  var loading = null;

  // 색인은 첫 입력 때 한 번만 받는다. 목록 페이지를 그냥 둘러보는 사람에게
  // 60KB를 미리 내려보낼 이유가 없다.
  function load() {
    if (data) return Promise.resolve(data);
    if (loading) return loading;
    loading = fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        data = j;
        return j;
      });
    return loading;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // 토큰 전부가 어딘가에 있어야 결과에 넣는다(AND). 어디서 맞았는지로 점수를 가른다 —
  // 제목에서 맞은 글이 본문 소제목에서 맞은 글보다 위로 와야 한다.
  function score(item, tokens) {
    var title = item.t.toLowerCase();
    var desc = (item.d || '').toLowerCase();
    var tags = (item.g || []).join(' ').toLowerCase();
    var total = 0;

    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      var hit = 0;
      if (title.indexOf(tk) === 0) hit += 15;
      else if (title.indexOf(tk) !== -1) hit += 10;
      if (tags.indexOf(tk) !== -1) hit += 6;
      if (desc.indexOf(tk) !== -1) hit += 3;
      if (item.x.indexOf(tk) !== -1) hit += 1;
      if (hit === 0) return 0;
      total += hit;
    }
    return total;
  }

  function mark(text, tokens) {
    var out = escapeHtml(text);
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (!tk) continue;
      var lower = out.toLowerCase();
      var at = lower.indexOf(tk);
      if (at === -1) continue;
      out = out.slice(0, at) + '<mark>' + out.slice(at, at + tk.length) + '</mark>' + out.slice(at + tk.length);
    }
    return out;
  }

  function render(q) {
    var tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) {
      list.hidden = true;
      list.innerHTML = '';
      status.textContent = '';
      return;
    }

    var hits = [];
    for (var i = 0; i < data.length; i++) {
      var s = score(data[i], tokens);
      if (s > 0) hits.push({ item: data[i], s: s });
    }
    hits.sort(function (a, b) {
      return b.s - a.s || a.item.t.localeCompare(b.item.t, 'ko');
    });

    if (!hits.length) {
      list.hidden = true;
      list.innerHTML = '';
      status.textContent = '"' + q + '"에 해당하는 글이 없습니다. 다른 낱말로 찾아보세요.';
      report(q, 0);
      return;
    }

    var shown = hits.slice(0, 20);
    var html = '';
    for (var j = 0; j < shown.length; j++) {
      var it = shown[j].item;
      html +=
        '<li class="site-search-hit">' +
        '<a href="' + escapeHtml(it.u) + '">' +
        '<span class="site-search-kind">' + escapeHtml(it.k) + '</span>' +
        '<span class="site-search-title">' + mark(it.t, tokens) + '</span>' +
        (it.d ? '<span class="site-search-desc">' + mark(it.d, tokens) + '</span>' : '') +
        '</a></li>';
    }
    list.innerHTML = html;
    list.hidden = false;
    status.textContent =
      hits.length + '건' + (hits.length > shown.length ? ' 중 ' + shown.length + '건 표시' : '');
    report(q, hits.length);
  }

  // 분석 쪽에 질의와 결과 건수를 넘긴다. GA 코드를 여기 두지 않는 이유는 검색이
  // 분석 도구 없이도 동작해야 하기 때문이다 — analytics.js가 이 이벤트를 듣는다.
  // 타자 중간 상태가 다 올라가지 않게, 입력이 멎은 뒤 한 번만 보낸다.
  var reportTimer = null;
  var lastReported = '';
  function report(q, hits) {
    clearTimeout(reportTimer);
    reportTimer = setTimeout(function () {
      if (!q || q === lastReported) return;
      lastReported = q;
      document.dispatchEvent(
        new CustomEvent('wipwip:search', { detail: { q: q, hits: hits } })
      );
    }, 900);
  }

  var timer = null;
  input.addEventListener('input', function () {
    var q = input.value.trim();
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (!q) {
        render('');
        return;
      }
      status.textContent = '찾는 중…';
      load()
        .then(function () {
          render(input.value.trim());
        })
        .catch(function () {
          status.textContent = '검색 색인을 불러오지 못했습니다. 새로 고친 뒤 다시 시도해 주세요.';
        });
    }, 120);
  });

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      input.value = '';
      render('');
    }
  });
})();
