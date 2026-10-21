/* 대출 한도·이자 계산기
 *
 * 기준 수치는 data/finance.yaml의 stress_dsr에서 레이아웃이 주입한다.
 *
 * 스트레스 DSR은 빌리는 금리를 올리는 게 아니라 "심사할 때만" 더 높은 금리로
 * 계산해 한도를 줄이는 장치다. 그래서 한도는 스트레스 금리로, 실제 상환액과
 * 총이자는 약정 금리로 계산해야 한다. 두 금리를 섞으면 결과가 틀린다.
 *
 *   심사금리 = 약정금리 + (스트레스금리 × 기본적용비율)
 *   연간 상환 여력 = 연소득 × DSR 한도 − 기존 대출 연간 원리금
 *   한도 = 상환 여력으로 심사금리·기간에 맞춰 갚을 수 있는 원금
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.finance || !W.finance.stress_dsr) return;
  var S = W.finance.stress_dsr;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var eok = function (n) {
    var v = Math.round(n / 1000000) * 1000000;
    if (v >= 100000000) {
      var e = Math.floor(v / 100000000), m = Math.round((v % 100000000) / 10000);
      return e + '억' + (m ? ' ' + m.toLocaleString('ko-KR') + '만' : '') + '원';
    }
    return Math.round(v / 10000).toLocaleString('ko-KR') + '만원';
  };

  /* 원리금균등: 월 상환액으로 빌릴 수 있는 원금 */
  function principalFor(monthly, rate, years) {
    var r = rate / 12, n = years * 12;
    if (r === 0) return monthly * n;
    return monthly * (1 - Math.pow(1 + r, -n)) / r;
  }
  /* 원리금균등: 원금에 대한 월 상환액 */
  function paymentFor(principal, rate, years) {
    var r = rate / 12, n = years * 12;
    if (r === 0) return principal / n;
    return principal * r / (1 - Math.pow(1 + r, -n));
  }

  function calculate(i) {
    var reg = S.지역[i.region];
    var addon = reg.스트레스금리 * reg.기본적용비율;
    var reviewRate = i.rate + addon;

    var capacity = Math.max(0, i.income * S.dsr_한도[i.dsr] - i.existing);
    var monthly = capacity / 12;
    var limit = principalFor(monthly, reviewRate, i.years);

    /* 비교: 다른 지역 단계를 적용하면 한도가 얼마나 달라지나 */
    var byRegion = S.지역_순서.map(function (name) {
      var g = S.지역[name];
      var rr = i.rate + g.스트레스금리 * g.기본적용비율;
      return { name: name, stage: g.단계, rate: rr, limit: principalFor(monthly, rr, i.years) };
    });

    /* 총이자 — 약정 금리로 계산한다 (스트레스 금리는 한도 계산에만 쓴다) */
    var amount = i.amount > 0 ? i.amount : limit;
    var pay1 = paymentFor(amount, i.rate, i.years);
    var total1 = pay1 * i.years * 12;
    var cmp = null;
    if (i.rate2 > 0) {
      var pay2 = paymentFor(amount, i.rate2, i.years);
      cmp = { rate: i.rate2, monthly: pay2, total: pay2 * i.years * 12, interest: pay2 * i.years * 12 - amount };
    }

    return {
      addon: addon, stage: reg.단계, reviewRate: reviewRate,
      capacity: capacity, monthly: monthly, limit: limit, byRegion: byRegion,
      amount: amount, usedLimit: i.amount <= 0,
      pay1: pay1, total1: total1, interest1: total1 - amount, cmp: cmp
    };
  }

  /* ── 화면 ────────────────────────────────────────────────── */

  var form = document.getElementById('loan-form');
  var out = document.getElementById('loan-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function render(r, i) {
    var html = '';

    html += '<div class="calc-headline">';
    html += '<p class="calc-headline-label">대출 한도</p>';
    html += '<p class="calc-headline-value">' + eok(r.limit) + '</p>';
    html += '<p class="calc-headline-note">' + i.region + ' ' + r.stage + ' · 심사금리 ' +
            (r.reviewRate * 100).toFixed(2) + '% (약정 ' + (i.rate * 100).toFixed(2) + '% + 스트레스 ' +
            (r.addon * 100).toFixed(2) + '%p)</p></div>';

    if (r.capacity <= 0) {
      html += '<p class="calc-note">기존 대출의 연간 원리금이 DSR 한도를 이미 채우고 있어 추가 대출 여력이 없습니다. ' +
              '기존 대출을 줄이면 그만큼 한도가 생깁니다.</p>';
    }

    html += '<table class="calc-table"><thead><tr><th>지역 구분</th><th>심사금리</th><th>한도</th></tr></thead><tbody>';
    r.byRegion.forEach(function (g) {
      html += '<tr class="' + (g.name === i.region ? 'is-eligible' : '') + '">';
      html += '<td>' + g.name + '<span class="calc-ratio">' + g.stage + '</span></td>';
      html += '<td>' + (g.rate * 100).toFixed(2) + '%</td>';
      html += '<td>' + eok(g.limit) + '</td></tr>';
    });
    html += '</tbody></table>';

    var diff = Math.abs(r.byRegion[0].limit - r.byRegion[1].limit);
    html += '<p class="calc-note">같은 소득·같은 금리인데 <strong>주택이 어디 있느냐에 따라 ' +
            eok(diff) + '</strong> 차이가 납니다. 스트레스 금리는 실제로 내는 이자를 올리는 것이 아니라, ' +
            '<strong>심사할 때만 더 높은 금리로 계산해 한도를 줄이는</strong> 장치입니다.</p>';

    html += '<div class="calc-other"><p><strong>총이자 — ' + eok(r.amount) +
            (r.usedLimit ? ' (위 한도 기준)' : '') + ', ' + i.years + '년 원리금균등</strong></p>';
    html += '<table class="calc-table"><thead><tr><th>금리</th><th>월 상환액</th><th>총이자</th></tr></thead><tbody>';
    html += '<tr><td>' + (i.rate * 100).toFixed(2) + '%</td><td>' + won(r.pay1) + '</td><td>' + won(r.interest1) + '</td></tr>';
    if (r.cmp) {
      html += '<tr class="is-eligible"><td>' + (r.cmp.rate * 100).toFixed(2) + '%</td><td>' +
              won(r.cmp.monthly) + '</td><td>' + won(r.cmp.interest) + '</td></tr>';
    }
    html += '</tbody></table>';
    if (r.cmp) {
      var gapM = Math.abs(r.pay1 - r.cmp.monthly), gapT = Math.abs(r.interest1 - r.cmp.interest);
      html += '<p class="calc-dim">월 <strong>' + won(gapM) + '</strong>, ' + i.years +
              '년 총이자 <strong>' + won(gapT) + '</strong> 차이입니다. ' +
              '금리 1%포인트가 장기 대출에서 어떻게 불어나는지 보여주는 숫자입니다.</p>';
    } else {
      html += '<p class="calc-dim">"비교할 금리"에 다른 상품의 금리를 넣으면 총이자 차이를 함께 보여줍니다.</p>';
    }
    html += '</div>';

    html += '<div class="calc-supporter"><p><strong>한도가 모자랄 때 손댈 수 있는 것</strong></p><ul>' +
            '<li><strong>상환 기간을 늘린다</strong> — 연간 원리금이 줄어 한도가 올라간다. 대신 총이자는 늘어난다. 위에서 기간을 바꿔 보면 바로 보인다</li>' +
            '<li><strong>기존 대출을 줄인다</strong> — DSR은 모든 대출의 원리금을 합산한다. 신용대출을 갚으면 주담대 한도가 직접 늘어난다</li>' +
            '<li><strong>금리 유형을 확인한다</strong> — 스트레스 금리는 변동금리의 상승 위험을 반영하는 장치라 상품 구조에 따라 반영 폭이 달라질 수 있다</li>' +
            '</ul></div>';

    html += '<p class="calc-disclaimer">이 결과는 참고값입니다. 실제 한도는 LTV·DTI, 담보 평가액, 신용등급, ' +
            '은행별 가산금리와 상품 조건에 따라 달라지고, 스트레스 DSR 단계는 반기마다 조정됩니다. ' +
            '<strong>실행 가능 여부와 금액은 은행 상담으로 확인해야 합니다.</strong></p>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var i = {
      income: num('income') * 10000,
      region: form.elements['region'].value,
      dsr: form.elements['dsr'].value,
      rate: num('rate') / 100,
      years: Math.max(1, Math.round(num('years')) || 30),
      existing: num('existing') * 10000,
      amount: num('amount') * 10000,
      rate2: num('rate2') / 100
    };
    render(calculate(i), i);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('reset', function () {
    out.hidden = true;
    out.innerHTML = '';
  });
})();
