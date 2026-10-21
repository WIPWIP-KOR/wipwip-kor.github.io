/* 장기요양 본인부담금 계산기
 *
 * 기준 수치는 data/welfare.yaml의 long_term_care에서 레이아웃이 주입한다.
 *
 * 본인부담금 = 급여비용 × 본인부담률 × (1 − 경감률) + 한도 초과분(전액) + 비급여(전액)
 *
 * 경감은 자동 적용이 아니라 공단 신청이 필요하다. 한도 초과분과 비급여는
 * 본인부담률이 적용되지 않고 전액 본인이 낸다 — 요양원 비용을 20%로만
 * 계산하면 실제 청구서와 어긋나는 이유가 여기에 있다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.long_term_care) return;
  var P = W.long_term_care;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var pct = function (n) { return (Math.round(n * 1000) / 10) + '%'; };

  function calculate(i) {
    var isHome = i.kind === '재가';
    var limit = P.재가_월한도액[i.grade] || 0;
    var facility = (P.시설_30일_급여비용 || {})[i.grade];

    /* 시설급여는 30일 수가가 정액이고 이용률 개념이 없다 */
    var covered, over = 0;
    if (isHome) {
      var used = limit * (i.usage / 100);
      covered = Math.min(used, limit);
      over = Math.max(0, used - limit);
    } else {
      covered = facility || 0;
    }

    var baseRate = P.본인부담률[isHome ? '재가' : '시설'];
    var cut = P.경감률[i.reduction] || 0;
    var effRate = baseRate * (1 - cut);
    var share = covered * effRate;

    return {
      isHome: isHome,
      available: isHome || facility != null,
      limit: limit, facility: facility,
      covered: covered, over: over,
      baseRate: baseRate, cut: cut, effRate: effRate,
      share: share,
      noncovered: i.noncovered,
      total: share + over + i.noncovered
    };
  }

  /* ── 화면 ────────────────────────────────────────────────── */

  var form = document.getElementById('ltc-form');
  var out = document.getElementById('ltc-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function render(r, i) {
    var html = '';

    if (!r.available) {
      html += '<div class="calc-headline"><p class="calc-headline-label">시설급여 이용 불가</p>' +
              '<p class="calc-headline-note"><strong>' + i.grade + '</strong>은 시설급여 대상이 아닙니다. ' +
              '인지지원등급은 주야간보호 중심으로 운영됩니다. 재가급여로 다시 계산해 보세요.</p></div>';
      out.innerHTML = html;
      out.hidden = false;
      return;
    }

    html += '<div class="calc-headline">';
    html += '<p class="calc-headline-label">월 본인부담금 (비급여 포함)</p>';
    html += '<p class="calc-headline-value">' + won(r.total) + '</p>';
    html += '<p class="calc-headline-note">' + i.grade + ' · ' + i.kind + '급여 · 본인부담률 ' +
            pct(r.effRate) + (r.cut > 0 ? ' (경감 적용)' : '') + '</p></div>';

    html += '<table class="calc-table"><tbody>';
    html += '<tr><td>급여비용' + (r.isHome ? ' (한도 내 이용분)' : ' (30일 기준)') + '</td><td>' + won(r.covered) + '</td></tr>';
    html += '<tr><td>본인부담률 ' + pct(r.effRate) + ' 적용</td><td>' + won(r.share) + '</td></tr>';
    if (r.over > 0) {
      html += '<tr><td>월 한도 초과분 <strong>전액</strong></td><td>' + won(r.over) + '</td></tr>';
    }
    if (r.noncovered > 0) {
      html += '<tr><td>비급여 <strong>전액</strong></td><td>' + won(r.noncovered) + '</td></tr>';
    }
    html += '<tr class="is-eligible"><td><strong>합계 (월)</strong></td><td><strong>' + won(r.total) + '</strong></td></tr>';
    html += '<tr><td>연간 환산</td><td>' + won(r.total * 12) + '</td></tr>';
    html += '</tbody></table>';

    if (r.over > 0) {
      html += '<p class="calc-note">월 한도(' + won(r.limit) + ')를 ' + won(r.over) +
              ' 넘겼습니다. <strong>초과분은 본인부담률이 적용되지 않고 전액 본인 부담</strong>입니다. ' +
              '한도 안에서 쓰는 것과 넘기는 것의 차이가 큽니다.</p>';
    }

    /* 경감 구간별 비교 — 신청 안 해서 못 받는 경우가 많다 */
    html += '<div class="calc-other"><p><strong>경감 구간별로 얼마나 달라지나</strong></p>';
    html += '<table class="calc-table"><thead><tr><th>구간</th><th>본인부담률</th><th>월 부담금</th></tr></thead><tbody>';
    (P.경감_순서 || []).forEach(function (name) {
      var rate = P.본인부담률[r.isHome ? '재가' : '시설'] * (1 - (P.경감률[name] || 0));
      var t = r.covered * rate + r.over + r.noncovered;
      html += '<tr class="' + (name === i.reduction ? 'is-eligible' : '') + '">';
      html += '<td>' + name + '</td><td>' + pct(rate) + '</td><td>' + won(t) + '</td></tr>';
    });
    html += '</tbody></table>';
    html += '<p class="calc-dim"><strong>경감은 자동으로 붙지 않습니다.</strong> 소득·재산이 기준 이하여도 ' +
            '공단에 신청해야 적용됩니다. 이미 이용 중인데 신청한 적이 없다면 국민건강보험공단(1577-1000)에 ' +
            '확인해 보세요.</p></div>';

    html += '<p class="calc-disclaimer">이 결과는 참고값입니다. 월 한도액과 수가는 매년 고시로 조정되고, ' +
            '비급여 금액은 시설마다 다릅니다. 시설 입소를 검토 중이라면 <strong>해당 시설의 비급여 내역을 ' +
            '따로 받아 보는 것이 순서입니다.</strong> 실제 금액은 국민건강보험공단에서 확인하세요.</p>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var i = {
      grade: form.elements['grade'].value,
      kind: form.elements['kind'].value,
      reduction: form.elements['reduction'].value,
      usage: Math.max(0, num('usage')),
      noncovered: num('noncovered') * 10000
    };
    render(calculate(i), i);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('reset', function () {
    out.hidden = true;
    out.innerHTML = '';
  });
})();
