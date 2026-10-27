/* 청년미래적금 만기 수령액 계산기
 *
 * 기준 수치는 data/finance.yaml의 youth_savings에서 레이아웃이 주입한다.
 *
 * 만기 수령액 = 원금 + 이자 + 정부기여금 이고, 세 항목의 계산 방식이 전부 다르다.
 *
 *   원금   = 월 납입액 × 36
 *   이자   = 월 납입액 × (연이율 ÷ 12) × (36 × 37 ÷ 2)      ← 단리, 월 적립식
 *   기여금 = min(월 납입액 × 비율, 월 상한) × 36
 *
 * 이자 식의 36×37÷2는 첫 달 납입분이 36개월, 마지막 달 납입분이 1개월 예치되는
 * 것을 모두 더한 값이다. 결과적으로 평균 예치기간이 18.5개월이라, 이자는
 * "원금 × 금리 × 3년"의 51.4%밖에 안 된다. 금리와 무관하게 늘 51.4%다.
 * 적금 계산에서 가장 자주 오해되는 지점이고, 이 계산기의 본론이다.
 *
 * 기여금은 만기에 일시 지급되므로 이자가 붙지 않는다. 기여금에도 이자를
 * 붙여 계산하는 다른 계산기와는 수십만 원 차이가 난다 (이쪽이 보수적인 값).
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.finance || !W.finance.youth_savings) return;
  var Y = W.finance.youth_savings;
  var N = Y.만기_개월;
  var FACTOR = N * (N + 1) / 2;          /* 36개월이면 666 */

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };

  function compute(monthly, rate, kind) {
    var k = Y.유형[kind] || { 비율: 0, 월상한: 0 };
    var principal = monthly * N;
    var interest = monthly * (rate / 100 / 12) * FACTOR;
    var perMonth = k.월상한 > 0 ? Math.min(monthly * k.비율, k.월상한) : 0;
    var grant = perMonth * N;
    return {
      principal: principal, interest: interest, grant: grant,
      perMonth: perMonth, capped: k.월상한 > 0 && monthly * k.비율 > k.월상한,
      total: principal + interest + grant,
      naive: principal * (rate / 100) * (N / 12)
    };
  }

  var form = document.getElementById('ys-form');
  var out = document.getElementById('ys-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function render() {
    var monthly = num('monthly') * 10000;
    var over = monthly > Y.월_납입한도;
    if (over) monthly = Y.월_납입한도;
    var rate = num('rate');
    var kind = form.elements.kind.value;
    var r = compute(monthly, rate, kind);

    var html = '';
    html += '<div class="calc-headline">' +
            '<span class="calc-headline-label">만기 수령액 (' + N + '개월 후)</span>' +
            '<span class="calc-headline-value">' + won(r.total) + '</span>' +
            '</div>';

    if (over) {
      html += '<p class="calc-note">월 납입한도가 ' + won(Y.월_납입한도) + '이므로 한도로 계산했습니다.</p>';
    }

    html += '<table><tbody>';
    html += '<tr><td>원금 (' + won(monthly) + ' × ' + N + '개월)</td><td>' + won(r.principal) + '</td></tr>';
    html += '<tr><td>이자 (연 ' + rate + '%, 이자소득세 면제)</td><td>' + won(r.interest) + '</td></tr>';
    if (r.grant > 0) {
      html += '<tr><td>정부기여금 (월 ' + won(r.perMonth) + ' × ' + N + '개월)</td><td>' + won(r.grant) + '</td></tr>';
    } else {
      html += '<tr><td>정부기여금</td><td>없음</td></tr>';
    }
    html += '<tr><td><strong>만기 수령액</strong></td><td><strong>' + won(r.total) + '</strong></td></tr>';
    html += '<tr><td>원금 대비 수익</td><td>' + won(r.total - r.principal) +
            ' (' + ((r.total / r.principal - 1) * 100).toFixed(1) + '%)</td></tr>';
    html += '</tbody></table>';

    if (r.capped) {
      html += '<p class="calc-note">정부기여금이 <strong>월 상한 ' + won(r.perMonth) + '에</strong> 걸렸습니다. ' +
              '납입액을 더 늘려도 기여금은 늘지 않습니다.</p>';
    }

    /* 본론 — 적금 이자는 단순 기대의 절반이다 */
    html += '<div class="calc-other"><h3>이자가 생각보다 적은 이유</h3><table><tbody>';
    html += '<tr><td>원금 × 금리 × 3년 (흔한 오해)</td><td>' + won(r.naive) + '</td></tr>';
    html += '<tr><td>실제 이자</td><td><strong>' + won(r.interest) + '</strong></td></tr>';
    html += '<tr><td>비율</td><td>' + (r.naive > 0 ? (r.interest / r.naive * 100).toFixed(1) + '%' : '—') + '</td></tr>';
    html += '</tbody></table>';
    html += '<p class="calc-note">월 적립식이라 <strong>첫 달 납입분만 ' + N + '개월을 채우고 마지막 달 납입분은 1개월만</strong> ' +
            '예치됩니다. 평균 예치기간이 ' + ((N + 1) / 2).toFixed(1) + '개월이어서 이자가 늘 단순 기대의 ' +
            (FACTOR / (N * N) * 100).toFixed(1) + '%가 됩니다. 금리가 몇 %든 이 비율은 같습니다.</p></div>';

    /* 금리·유형별 비교 */
    html += '<div class="calc-other"><h3>금리와 유형별 만기 수령액</h3>' +
            '<table><thead><tr><th>연 금리</th>';
    Y.유형_순서.forEach(function (k) { html += '<th>' + k.split(' ')[0] + '</th>'; });
    html += '</tr></thead><tbody>';
    [3, 4, 5, 6, 7, 8].forEach(function (rr) {
      html += '<tr><td>' + rr + '%</td>';
      Y.유형_순서.forEach(function (k) {
        html += '<td>' + won(compute(monthly, rr, k).total) + '</td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>' +
            '<p class="calc-note">월 ' + won(monthly) + ' 납입 기준입니다. ' +
            '<strong>금리 1%p보다 우대형 판정이 훨씬 큽니다</strong> — 금리를 1%p 올리는 효과가 ' +
            won(compute(monthly, rate + 1, kind).total - r.total) + '인데, ' +
            '일반형에서 우대형으로 바뀌는 효과는 ' +
            won(compute(monthly, rate, Y.유형_순서[0]).total - compute(monthly, rate, Y.유형_순서[1]).total) + '입니다.</p></div>';

    html += '<div class="calc-other"><h3>이 계산기가 못 하는 것</h3><ul>' +
            '<li><strong>기여금에 이자를 붙이지 않았습니다.</strong> 만기 일시 지급이라는 전제입니다. ' +
            '기여금에도 이자를 붙이는 계산기와는 수십만 원 차이가 나며, 이쪽이 더 보수적인 값입니다.</li>' +
            '<li><strong>우대형 유지 요건을 판정하지 않습니다.</strong> 중소기업 재직자는 가입부터 만기 1개월 전까지 ' +
            '총 ' + Y.우대형_재직요건_개월 + '개월 이상 재직해야 하고(이직 2회까지 허용), 미충족 시 ' +
            '<strong>만기에 일반형으로 전환될 수 있습니다.</strong></li>' +
            '<li><strong>중도해지는 반영하지 않았습니다.</strong> 해지 사유에 따라 기여금과 비과세 혜택이 달라집니다.</li>' +
            '<li>은행별 우대금리 조건(급여이체·카드실적·마케팅 동의 등)은 각 은행 상품설명서를 봐야 합니다.</li>' +
            '</ul>' +
            '<p class="calc-note">가입 요건과 회차 일정은 ' +
            '<strong><a href="https://www.fsc.go.kr" target="_blank" rel="noopener">금융위원회</a>와 ' +
            '서민금융진흥원 공지로</strong> 확인하세요. 2차 가입은 2026년 12월로 잠정 안내된 상태이고 ' +
            '정확한 접수일은 확정되지 않았습니다.</p></div>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
  form.addEventListener('reset', function () { out.hidden = true; out.innerHTML = ''; });
})();
