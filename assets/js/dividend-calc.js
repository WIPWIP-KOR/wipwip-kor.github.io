/* 배당소득 과세방식 비교 계산기
 *
 * 기준 수치는 data/finance.yaml의 dividend_tax에서 레이아웃이 주입한다.
 *
 * 두 방식 모두 2,000만 원까지는 14% 원천징수로 같다. 갈리는 것은 초과분이다.
 *   종합과세 — 초과분을 다른 소득과 합산해 본인의 한계세율(6~45%)을 적용
 *   분리과세 — 초과분에 배당소득 전용 구간세율(20/25/30%)을 적용
 *
 * 분리과세 첫 구간이 20%이므로, 한계세율이 20%를 넘으면 분리과세가 유리하고
 * 그 아래면 종합과세가 유리하다. 갈림길이 딱 거기다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.finance || !W.finance.dividend_tax) return;
  var D = W.finance.dividend_tax;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var local = 1 + D.지방소득세율;

  /* 분리과세: 구간별 누진 적용 */
  function separateTax(amount) {
    var tax = 0, prev = 0;
    for (var k = 0; k < D.분리과세_구간.length; k++) {
      var cap = D.분리과세_구간[k][0], rate = D.분리과세_구간[k][1];
      var upper = (cap === null) ? amount : Math.min(amount, cap);
      if (upper > prev) tax += (upper - prev) * rate;
      prev = upper;
      if (cap !== null && amount <= cap) break;
    }
    return tax;
  }

  /* 종합과세: 기준금액까지 14%, 초과분에 한계세율 */
  function comprehensiveTax(amount, marginal) {
    var base = Math.min(amount, D.종합과세_기준);
    var over = Math.max(0, amount - D.종합과세_기준);
    return base * D.원천징수세율 + over * marginal;
  }

  var form = document.getElementById('div-form');
  var out = document.getElementById('div-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function render(amount, mname) {
    var marginal = D.종합과세_한계세율[mname];
    var sep = separateTax(amount) * local;
    var comp = comprehensiveTax(amount, marginal) * local;
    var sepBetter = sep < comp;
    var gap = Math.abs(comp - sep);

    var html = '';
    html += '<div class="calc-headline">';
    html += '<p class="calc-headline-label">' + (sepBetter ? '분리과세가 유리합니다' : '종합과세가 유리합니다') + '</p>';
    html += '<p class="calc-headline-value">' + won(gap) + ' 차이</p>';
    html += '<p class="calc-headline-note">배당소득 ' + won(amount) + ' · 한계세율 ' + mname + ' 기준</p></div>';

    html += '<table class="calc-table"><thead><tr><th>과세 방식</th><th>세금 (지방세 포함)</th><th>실수령</th></tr></thead><tbody>';
    html += '<tr class="' + (sepBetter ? 'is-over' : 'is-eligible') + '"><td>종합과세</td><td>' +
            won(comp) + '</td><td>' + won(amount - comp) + '</td></tr>';
    html += '<tr class="' + (sepBetter ? 'is-eligible' : 'is-over') + '"><td>분리과세</td><td>' +
            won(sep) + '</td><td>' + won(amount - sep) + '</td></tr>';
    html += '</tbody></table>';

    if (amount <= D.종합과세_기준) {
      html += '<p class="calc-note">배당·이자 합계가 ' + won(D.종합과세_기준) +
              ' 이하라 <strong>애초에 종합과세 대상이 아닙니다.</strong> ' +
              '14% 원천징수로 끝나므로 분리과세를 선택할 일이 없습니다.</p>';
    } else {
      html += '<p class="calc-note' + (sepBetter ? ' calc-note-good' : '') + '">' +
              '<strong>갈림길은 한계세율 20%입니다.</strong> 분리과세의 2,000만 원 초과 구간 세율이 20%라, ' +
              '한계세율이 그보다 높으면 분리과세가 유리하고 낮으면 종합과세가 유리합니다. ' +
              '과세표준으로는 <strong>5,000만 원</strong>이 경계입니다 — 그 아래는 15% 구간이라 ' +
              '분리과세를 고르면 오히려 손해입니다.</p>';
    }

    /* 한계세율별 전체 비교 */
    html += '<div class="calc-other"><p><strong>내 한계세율이 바뀌면 어떻게 되나</strong></p>';
    html += '<table class="calc-table"><thead><tr><th>한계세율</th><th>종합과세</th><th>분리과세</th><th>유리한 쪽</th></tr></thead><tbody>';
    D.종합과세_한계세율_순서.forEach(function (name) {
      var mr = D.종합과세_한계세율[name];
      var c = comprehensiveTax(amount, mr) * local;
      var better = sep < c;
      html += '<tr class="' + (name === mname ? 'is-eligible' : '') + '">';
      html += '<td>' + name + '</td><td>' + won(c) + '</td><td>' + won(sep) + '</td>';
      html += '<td>' + (c === sep ? '동일' : (better ? '분리과세' : '<strong>종합과세</strong>')) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="calc-dim">분리과세 세금은 한계세율과 무관하게 고정됩니다. 종합과세만 본인 소득에 따라 ' +
            '움직이므로, 배당 외 소득이 많아질수록 분리과세 쪽이 유리해집니다.</p></div>';

    html += '<div class="calc-supporter"><p><strong>계산 전에 확인할 것</strong></p><ul>' +
            '<li><strong>분리과세는 아무 배당에나 되지 않는다</strong> — 고배당 상장법인 요건(배당성향 등)을 충족한 법인의 배당이어야 한다</li>' +
            '<li><strong>자동 적용이 아니다</strong> — 종합소득세 신고 때 직접 선택해야 한다</li>' +
            '<li><strong>건강보험료는 별개다</strong> — 금융소득이 연 2,000만 원을 넘으면 과세 방식과 무관하게 보험료 산정에 반영될 수 있다</li>' +
            '</ul></div>';

    html += '<p class="calc-disclaimer">이 결과는 참고값입니다. 실제 세액은 다른 소득과 공제 항목, ' +
            '금융소득종합과세 비교과세 방식에 따라 달라집니다. 금액이 크다면 세무 전문가나 국세청(126) 상담으로 ' +
            '확인하는 편이 안전합니다.</p>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    render(num('dividend') * 10000, form.elements['marginal'].value);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('reset', function () {
    out.hidden = true;
    out.innerHTML = '';
  });
})();
