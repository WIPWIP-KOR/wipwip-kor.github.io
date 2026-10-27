/* 실업급여(구직급여) 계산기
 *
 * 기준 수치는 data/welfare.yaml의 unemployment_benefit에서 레이아웃이 주입한다.
 *
 * 계산은 두 갈래가 따로 돌아간다.
 *   ① 1일 수령액 = 평균임금 × 60%, 단 상한(68,100)과 하한(최저임금×80%×소정근로시간) 사이로 자른다
 *   ② 소정급여일수 = 연령 × 피보험기간 표(고용보험법 별표1) 조회
 * 총액은 ① × ②다. 둘은 서로 영향을 주지 않는다.
 *
 * 이 계산기의 핵심은 금액 자체가 아니라 "상·하한에 걸리는지"다. 2026년 상한과
 * 하한의 차이가 2,052원(3.1%)뿐이라, 평균임금 60%가 실제로 작동하는 구간은
 * 월 급여 330.2만~340.5만 원 사이뿐이고 그 밖은 전부 상한 또는 하한이다.
 * 공식 모의계산은 결과 금액만 주고 이 사실을 보여주지 않는다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.unemployment_benefit) return;
  var U = W.unemployment_benefit;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var pct = function (r) { return (r * 100).toFixed(0) + '%'; };

  /* 하한액은 소정근로시간에 비례한다. 8시간이면 yaml의 일액_하한과 같아야 한다. */
  function floorFor(hours) {
    return Math.floor(U.최저임금_시급 * U.하한_산정비율 * hours);
  }

  function days(age, insured) {
    var t = U.소정급여일수[age];
    return (t && t[insured]) || 0;
  }

  var form = document.getElementById('ub-form');
  var out = document.getElementById('ub-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }
  function val(id) {
    var el = form.elements[id];
    return el ? el.value : '';
  }

  function render() {
    var monthly = num('monthly') * 10000;
    var hours = Math.min(Math.max(num('hours') || U.하한_기준_소정근로시간, 1), U.하한_기준_소정근로시간);
    var age = val('age'), insured = val('insured');

    var avgDaily = monthly / 30;                 /* 평균임금(일) 근사 */
    var raw = avgDaily * U.지급률;               /* 60% */
    var lo = floorFor(hours), hi = U.일액_상한;
    var daily = Math.min(Math.max(raw, lo), hi);
    var capped = raw > hi ? 'high' : (raw < lo ? 'low' : 'mid');

    var n = days(age, insured);
    var total = daily * n;

    /* 상·하한이 갈리는 월 급여 경계 */
    var loMonthly = lo / U.지급률 * 30;
    var hiMonthly = U.기초일액_상한 * 30;

    var html = '';
    html += '<div class="calc-headline">' +
            '<span class="calc-headline-label">1일 수령액</span>' +
            '<span class="calc-headline-value">' + won(daily) + '</span>' +
            '</div>';

    html += '<table><tbody>';
    html += '<tr><td>평균임금 (일)</td><td>' + won(avgDaily) + '</td></tr>';
    html += '<tr><td>× 지급률 ' + pct(U.지급률) + '</td><td>' + won(raw) + '</td></tr>';
    if (capped === 'high') {
      html += '<tr><td>상한 적용</td><td>→ ' + won(hi) + '</td></tr>';
    } else if (capped === 'low') {
      html += '<tr><td>하한 적용 (' + hours + '시간 기준)</td><td>→ ' + won(lo) + '</td></tr>';
    } else {
      html += '<tr><td>상한 ' + won(hi) + ' / 하한 ' + won(lo) + '</td><td>해당 없음</td></tr>';
    }
    html += '<tr><td><strong>1일 수령액</strong></td><td><strong>' + won(daily) + '</strong></td></tr>';
    html += '<tr><td>소정급여일수 (' + age + ' · ' + insured + ')</td><td><strong>' + n + '일</strong></td></tr>';
    html += '<tr><td>월 환산 (30일)</td><td>' + won(daily * 30) + '</td></tr>';
    html += '<tr><td><strong>총 예상 수령액</strong></td><td><strong>' + won(total) + '</strong></td></tr>';
    html += '</tbody></table>';

    /* 이 계산기의 본론 — 상·하한 폭 */
    if (capped === 'high') {
      html += '<p class="calc-note"><strong>상한에 걸렸습니다.</strong> 월 급여가 ' +
              won(hiMonthly) + '을 넘으면 더 받지 못하고 ' + won(hi) + '으로 고정됩니다. ' +
              '급여가 얼마나 더 높든 수령액은 같습니다.</p>';
    } else if (capped === 'low') {
      html += '<p class="calc-note calc-note-good"><strong>하한이 적용됐습니다.</strong> 계산상 ' +
              won(raw) + '이지만 하한 ' + won(lo) + '을 보장받습니다. ' +
              '월 급여가 ' + won(loMonthly) + ' 이하면 모두 이 금액입니다.</p>';
    } else {
      html += '<p class="calc-note">평균임금 ' + pct(U.지급률) + '가 그대로 적용되는 구간입니다. ' +
              '이 구간은 월 급여 ' + won(loMonthly) + ' ~ ' + won(hiMonthly) + ' 사이로, ' +
              '폭이 ' + won(hiMonthly - loMonthly) + '밖에 안 됩니다.</p>';
    }

    html += '<div class="calc-other"><h3>상한과 하한의 차이가 ' + won(hi - U.일액_하한) + '뿐입니다</h3>' +
            '<table><thead><tr><th>이직 전 월 급여</th><th>1일 수령액</th></tr></thead><tbody>';
    [250, 300, 330, 335, 340, 345, 400, 600].forEach(function (m) {
      var r = m * 10000 / 30 * U.지급률;
      var d = Math.min(Math.max(r, U.일액_하한), hi);
      var tag = r > hi ? ' (상한)' : (r < U.일액_하한 ? ' (하한)' : '');
      html += '<tr><td>' + m + '만원</td><td>' + won(d) + tag + '</td></tr>';
    });
    html += '</tbody></table>' +
            '<p class="calc-note">월 250만 원과 월 600만 원의 차이가 ' + won(hi - U.일액_하한) + '입니다. ' +
            '급여가 2.4배인데 실업급여는 ' + ((hi / U.일액_하한 - 1) * 100).toFixed(1) + '% 더 받습니다.</p>' +
            '</div>';

    html += '<div class="calc-other"><h3>이 계산기가 못 하는 것</h3><ul>' +
            '<li><strong>수급 자격 판정을 하지 않습니다.</strong> 이직 사유가 자발적 퇴사면 원칙적으로 받을 수 없고, ' +
            '이직 전 18개월 중 피보험 단위기간 180일 이상이라는 요건도 따로 충족해야 합니다.</li>' +
            '<li><strong>평균임금을 근사합니다.</strong> 실제로는 3개월 임금총액을 그 기간 총일수(89~92일)로 나누므로 ' +
            '몇백 원 차이가 납니다.</li>' +
            '<li><strong>대기기간 ' + U.대기기간_일 + '일은 빼지 않았습니다.</strong> 신청 후 ' + U.대기기간_일 +
            '일은 지급되지 않고, 첫 지급은 그 다음날부터 계산됩니다.</li>' +
            '<li>반복수급 감액, 조기재취업수당, 연장급여는 반영하지 않습니다.</li>' +
            '</ul>' +
            '<p class="calc-note">경계선이거나 이직 사유가 애매하면 포기하지 말고 ' +
            '<strong><a href="https://www.work24.go.kr" target="_blank" rel="noopener">고용24</a>나 ' +
            '거주지 고용센터(1350)에 확인하세요.</strong> 자발적 퇴사로 보이는 경우에도 ' +
            '정당한 이직 사유로 인정되는 유형이 있습니다.</p></div>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
  form.addEventListener('reset', function () {
    out.hidden = true;
    out.innerHTML = '';
  });
})();
