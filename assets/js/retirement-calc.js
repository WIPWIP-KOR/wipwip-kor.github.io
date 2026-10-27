/* 퇴직금·퇴직소득세 계산기
 *
 * 기준 수치는 data/finance.yaml의 retirement_tax에서 레이아웃이 주입한다.
 * 출처는 국세청 퇴직소득 안내와 소득세법 제48조(개정 2022-12-31)·제55조다.
 *
 * 퇴직소득세는 "연분연승"이라 부르는 구조로 계산한다. 근속연수로 나눠 1년치로
 * 만든 뒤 세율을 매기고 다시 근속연수를 곱한다. 오래 다닐수록 같은 금액이라도
 * 세율이 낮아지게 만드는 장치다.
 *
 *   ① 근속연수공제  — 근속연수 구간별 정액 (1년 미만은 1년으로 올림)
 *   ② 환산급여      = (퇴직금 − ①) ÷ 근속연수 × 12
 *   ③ 환산급여공제  — 환산급여 구간별, 800만까지는 전액
 *   ④ 과세표준      = ② − ③
 *   ⑤ 환산산출세액  = ④ × 기본세율 − 누진공제
 *   ⑥ 산출세액      = ⑤ ÷ 12 × 근속연수
 *
 * 홈택스 계산기는 ⑥만 보여주고 ①~⑤를 감춘다. 이 계산기의 존재 이유가 그 중간이다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.finance || !W.finance.retirement_tax) return;
  var R = W.finance.retirement_tax;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var pct = function (r) { return (r * 100).toFixed(2) + '%'; };

  function serviceDeduction(years) {
    for (var i = 0; i < R.근속연수공제.length; i++) {
      var b = R.근속연수공제[i];                 /* [상한, 기준연수, 기본액, 연당] */
      if (b[0] === null || years <= b[0]) return b[2] + (years - b[1]) * b[3];
    }
    return 0;
  }
  function convertedDeduction(conv) {
    for (var i = 0; i < R.환산급여공제.length; i++) {
      var b = R.환산급여공제[i];                 /* [상한, 하한, 기본액, 초과율] */
      if (b[0] === null || conv <= b[0]) return b[2] + (conv - b[1]) * b[3];
    }
    return 0;
  }
  function baseTax(base) {
    if (base <= 0) return 0;
    for (var i = 0; i < R.기본세율.length; i++) {
      var b = R.기본세율[i];                     /* [상한, 세율, 누진공제] */
      if (b[0] === null || base <= b[0]) return Math.max(0, base * b[1] - b[2]);
    }
    return 0;
  }

  function compute(pay, years, cutRate) {
    var sd = serviceDeduction(years);
    var taxable = Math.max(0, pay - sd);          /* 공제가 퇴직금보다 크면 0 (제48조 ②) */
    var conv = years > 0 ? taxable / years * 12 : 0;
    var cd = Math.min(conv, convertedDeduction(conv));
    var base = Math.max(0, conv - cd);
    var convTax = baseTax(base);
    var gross = convTax / 12 * years;
    var income = gross * (1 - cutRate);
    var local = income * R.지방소득세율;
    return {
      sd: sd, taxable: taxable, conv: conv, cd: cd, base: base,
      convTax: convTax, gross: gross, income: income, local: local,
      total: income + local, net: pay - income - local
    };
  }

  var form = document.getElementById('ret-form');
  var out = document.getElementById('ret-result');
  if (!form || !out) return;

  function render() {
    var j = form.elements.joined.value, l = form.elements.left.value;
    var salary = (parseFloat(String(form.elements.salary.value).replace(/[^0-9.]/g, '')) || 0) * 10000;
    var method = form.elements.method.value;
    var cutRate = R.수령방식_감면율[method] || 0;

    var dj = new Date(j), dl = new Date(l);
    if (isNaN(dj) || isNaN(dl) || dl <= dj) {
      out.innerHTML = '<p class="calc-note">퇴사일이 입사일보다 뒤여야 합니다.</p>';
      out.hidden = false; return;
    }
    var days = Math.round((dl - dj) / 86400000);
    var years = Math.ceil(days / 365);            /* 1년 미만의 기간은 1년으로 본다 */
    /* 퇴직금 = 평균임금(일) × 30일 × 재직일수/365. 평균임금(일)을 월급÷30으로 근사하면
     * 월 급여 × 재직일수 ÷ 365로 정리된다. */
    var pay = salary * days / 365;
    var r = compute(pay, years, cutRate);

    var html = '';
    html += '<div class="calc-headline">' +
            '<span class="calc-headline-label">세후 실수령액</span>' +
            '<span class="calc-headline-value">' + won(r.net) + '</span>' +
            '</div>';

    html += '<table><tbody>';
    html += '<tr><td>재직일수</td><td>' + days.toLocaleString('ko-KR') + '일 (' +
            Math.floor(days / 365) + '년 ' + Math.floor(days % 365 / 30) + '개월)</td></tr>';
    html += '<tr><td>근속연수 (1년 미만 올림)</td><td>' + years + '년</td></tr>';
    html += '<tr><td><strong>퇴직금</strong></td><td><strong>' + won(pay) + '</strong></td></tr>';
    html += '</tbody></table>';

    html += '<div class="calc-other"><h3>퇴직소득세가 나오는 과정</h3><table><tbody>';
    html += '<tr><td>① 근속연수공제</td><td>− ' + won(r.sd) + '</td></tr>';
    html += '<tr><td>　= 공제 후 금액</td><td>' + won(r.taxable) + '</td></tr>';
    html += '<tr><td>② 환산급여 (÷ ' + years + '년 × 12)</td><td>' + won(r.conv) + '</td></tr>';
    html += '<tr><td>③ 환산급여공제</td><td>− ' + won(r.cd) + '</td></tr>';
    html += '<tr><td>④ 과세표준</td><td>' + won(r.base) + '</td></tr>';
    html += '<tr><td>⑤ 환산산출세액 (기본세율)</td><td>' + won(r.convTax) + '</td></tr>';
    html += '<tr><td>⑥ 산출세액 (÷ 12 × ' + years + '년)</td><td><strong>' + won(r.gross) + '</strong></td></tr>';
    if (cutRate > 0) {
      html += '<tr><td>　연금 수령 감면 ' + (cutRate * 100).toFixed(0) + '%</td><td>− ' + won(r.gross * cutRate) + '</td></tr>';
      html += '<tr><td>　퇴직소득세</td><td>' + won(r.income) + '</td></tr>';
    }
    html += '<tr><td>지방소득세 (' + (R.지방소득세율 * 100).toFixed(0) + '%)</td><td>' + won(r.local) + '</td></tr>';
    html += '<tr><td><strong>세금 합계</strong></td><td><strong>' + won(r.total) + '</strong></td></tr>';
    html += '</tbody></table>';
    html += '<p class="calc-note">실효세율 <strong>' + (pay > 0 ? pct(r.total / pay) : '—') +
            '</strong>. ②에서 근속연수로 나누고 ⑥에서 다시 곱하는 것을 <strong>연분연승이라고</strong> 합니다. ' +
            '같은 퇴직금이라도 오래 다녔을수록 1년치로 환산한 금액이 작아져 낮은 세율 구간에 걸립니다.</p></div>';

    /* 수령 방식 비교 — 이 계산기의 두 번째 본론 */
    html += '<div class="calc-other"><h3>일시금과 연금, 세금이 얼마나 다른가</h3>' +
            '<table><thead><tr><th>수령 방식</th><th>세금 합계</th><th>실수령액</th><th>차이</th></tr></thead><tbody>';
    var baseTotal = compute(pay, years, 0).total;
    R.수령방식_순서.forEach(function (m) {
      var x = compute(pay, years, R.수령방식_감면율[m] || 0);
      var diff = baseTotal - x.total;
      html += '<tr><td>' + m + (m === method ? ' (선택)' : '') + '</td><td>' + won(x.total) + '</td>' +
              '<td>' + won(x.net) + '</td><td>' + (diff > 0 ? '+' + won(diff) : '—') + '</td></tr>';
    });
    html += '</tbody></table>' +
            '<p class="calc-note">퇴직금을 IRP로 옮기면 받는 시점까지 과세가 미뤄지고, 연금으로 나눠 받으면 ' +
            '이연퇴직소득세가 감면됩니다. 다만 연금은 만 55세 이후 10년 이상에 걸쳐 받아야 하므로 ' +
            '목돈이 당장 필요하면 선택지가 아닙니다.</p></div>';

    html += '<div class="calc-other"><h3>이 계산기가 못 하는 것</h3><ul>' +
            '<li><strong>평균임금을 근사합니다.</strong> 실제로는 퇴직 전 3개월 임금총액을 그 기간 ' +
            '총일수로 나누고, 그 값이 통상임금보다 적으면 통상임금을 씁니다. 실제 퇴직금이 더 많을 수 있습니다.</li>' +
            '<li><strong>퇴직연금(DB·DC)은 계산식이 다릅니다.</strong> DC형은 회사가 매년 납입한 금액과 ' +
            '운용 수익이 퇴직급여가 되므로 이 계산과 맞지 않습니다.</li>' +
            '<li><strong>중간정산·임원 퇴직금 한도는 반영하지 않았습니다.</strong> 중간정산을 받았으면 ' +
            '근속연수 계산이 달라집니다.</li>' +
            '<li>21년차 이후 연금 수령 감면은 자료마다 설명이 갈려 넣지 않았습니다.</li>' +
            '</ul>' +
            '<p class="calc-note">정확한 세액은 원천징수의무자(회사)가 발급하는 <strong>퇴직소득 원천징수영수증으로</strong> ' +
            '확인됩니다. 금액이 크거나 중간정산 이력이 있다면 ' +
            '<strong><a href="https://www.hometax.go.kr" target="_blank" rel="noopener">홈택스</a>나 ' +
            '국세청 세미래 상담센터(126)에 확인하세요.</strong></p></div>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
  form.addEventListener('reset', function () { out.hidden = true; out.innerHTML = ''; });
})();
