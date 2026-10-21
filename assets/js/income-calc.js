/* 소득인정액 계산기
 *
 * 기준 수치는 data/welfare.yaml에서 레이아웃이 주입한다 (window.WELFARE).
 * 계산 로직을 고칠 일은 드물지만, 수치가 바뀌면 이 파일이 아니라 yaml을 고친다.
 *
 * 소득인정액 = 소득평가액 + 재산의 소득환산액
 *   소득평가액      = 근로소득 × (1 − 공제율) + 기타소득
 *   재산의 소득환산액 = (재산 − 기본재산액 − 부채) × 종류별 환산율
 *
 * 기본재산액은 주거용 → 일반 → 금융 순서로 공제한다. 순서가 결과를 바꾸므로
 * 주거용(환산율 1.04%)에서 먼저 소진시키는 이 순서를 지켜야 한다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W) return;

  var won = function (n) {
    return Math.round(n).toLocaleString('ko-KR') + '원';
  };
  var man = function (n) {
    return (n || 0) * 10000;
  };

  function medianIncome(size) {
    var table = W.median_income[W.year];
    if (size <= 6) return table[String(size)];
    return table['6'] + W.median_income_increment[W.year] * (size - 6);
  }

  /* 기본재산액을 주거용 → 일반 → 금융 순서로 공제하고 각 구간의 환산액을 반환 */
  function convertProperty(prop, region) {
    var remain = W.basic_property_deduction[region] || 0;
    var order = ['주거용', '일반', '금융'];
    var detail = [];
    var total = 0;

    order.forEach(function (kind) {
      var value = prop[kind] || 0;
      var used = Math.min(remain, value);
      remain -= used;
      var taxable = value - used;
      var rate = W.conversion_rate[kind];
      var amount = taxable * rate;
      total += amount;
      if (value > 0) {
        detail.push({
          kind: kind, value: value, deducted: used,
          taxable: taxable, rate: rate, amount: amount
        });
      }
    });

    /* 자동차는 기본재산액 공제 대상이 아니다. 차량 가액이 그대로 월소득으로 잡힌다. */
    var car = prop['자동차'] || 0;
    if (car > 0) {
      var carAmount = car * W.conversion_rate['자동차'];
      total += carAmount;
      detail.push({
        kind: '자동차', value: car, deducted: 0,
        taxable: car, rate: W.conversion_rate['자동차'], amount: carAmount
      });
    }

    return { total: total, detail: detail, unusedDeduction: remain };
  }

  function calculate(input) {
    var rate = W.earned_income_deduction_rate;
    var earned = input.earnedIncome * (1 - rate);
    var evaluated = earned + input.otherIncome;

    var debt = input.debt || 0;
    var prop = {
      주거용: Math.max(0, (input.housing || 0) - debt),
      일반: input.general || 0,
      금융: input.financial || 0,
      자동차: input.car || 0
    };

    var converted = convertProperty(prop, input.region);
    var recognized = evaluated + converted.total;
    var size = input.householdSize;
    var median = medianIncome(size);

    /* 비율 오름차순으로 고정한다. yaml/JSON의 키 순서는 가나다순이 되므로
       그대로 쓰면 생계급여가 첫 번째가 아니게 된다. */
    var results = Object.keys(W.benefit_ratio).map(function (name) {
      var ratio = W.benefit_ratio[name];
      var line = Math.round(median * ratio);
      return {
        name: name,
        ratio: ratio,
        line: line,
        eligible: recognized <= line,
        gap: line - recognized,
        supporter: W.supporter_criteria[name]
      };
    }).sort(function (a, b) { return a.ratio - b.ratio; });

    return {
      evaluated: evaluated,
      earnedAfterDeduction: earned,
      converted: converted,
      recognized: recognized,
      median: median,
      results: results
    };
  }

  /* ── 화면 ────────────────────────────────────────────────── */

  var form = document.getElementById('calc-form');
  var out = document.getElementById('calc-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function render(r, input) {
    var pass = r.results.filter(function (x) { return x.eligible; });

    var html = '';

    html += '<div class="calc-headline">';
    html += '<p class="calc-headline-label">소득인정액</p>';
    html += '<p class="calc-headline-value">' + won(r.recognized) + '</p>';
    if (pass.length === 0) {
      html += '<p class="calc-headline-note">네 급여 모두 기준선을 넘습니다.</p>';
    } else if (pass.length === 4) {
      html += '<p class="calc-headline-note">네 급여 모두 기준선 이하입니다.</p>';
    } else {
      html += '<p class="calc-headline-note">' + pass.length + '개 급여가 기준선 이하입니다.</p>';
    }
    html += '</div>';

    html += '<table class="calc-table"><thead><tr>' +
            '<th>급여</th><th>기준선</th><th>판정</th><th>차이</th>' +
            '</tr></thead><tbody>';
    r.results.forEach(function (x) {
      html += '<tr class="' + (x.eligible ? 'is-eligible' : 'is-over') + '">';
      html += '<td>' + x.name + '<span class="calc-ratio">중위 ' + Math.round(x.ratio * 100) + '%</span></td>';
      html += '<td>' + won(x.line) + '</td>';
      html += '<td>' + (x.eligible ? '<strong>대상</strong>' : '초과') + '</td>';
      html += '<td>' + (x.eligible ? won(x.gap) + ' 여유' : won(-x.gap) + ' 초과') + '</td>';
      html += '</tr>';
    });
    html += '</tbody></table>';

    /* 생계급여 예상 지급액 — 기준선에서 소득인정액을 뺀 차액.
       순서에 의존하지 않도록 이름으로 찾는다. */
    var life = r.results.filter(function (x) { return x.name === '생계급여'; })[0];
    if (life && life.eligible) {
      html += '<p class="calc-note calc-note-good">생계급여는 정액이 아니라 ' +
              '<strong>기준선 − 소득인정액</strong>만큼 지급됩니다. ' +
              '위 값대로면 월 <strong>' + won(life.gap) + '</strong> 수준입니다.</p>';
    }

    /* 계산 과정 */
    html += '<details class="calc-steps"><summary>계산 과정 보기</summary>';
    html += '<p><strong>① 소득평가액</strong></p><ul>';
    if (input.earnedIncome > 0) {
      html += '<li>근로소득 ' + won(input.earnedIncome) + ' × ' +
              Math.round((1 - W.earned_income_deduction_rate) * 100) + '% = ' +
              won(r.earnedAfterDeduction) +
              ' <span class="calc-dim">(근로소득 ' +
              Math.round(W.earned_income_deduction_rate * 100) + '% 공제)</span></li>';
    }
    if (input.otherIncome > 0) {
      html += '<li>기타소득 ' + won(input.otherIncome) + ' <span class="calc-dim">(공제 없음)</span></li>';
    }
    html += '<li>합계 <strong>' + won(r.evaluated) + '</strong></li></ul>';

    html += '<p><strong>② 재산의 소득환산액</strong></p>';
    html += '<p class="calc-dim">' + input.region + ' 기본재산액 ' +
            won(W.basic_property_deduction[input.region]) +
            '을 주거용 → 일반 → 금융 순서로 공제합니다.</p><ul>';
    if (r.converted.detail.length === 0) {
      html += '<li>해당 재산 없음</li>';
    }
    r.converted.detail.forEach(function (d) {
      html += '<li>' + d.kind + ' ' + won(d.value);
      if (d.deducted > 0) html += ' − 공제 ' + won(d.deducted);
      html += ' = ' + won(d.taxable) + ' × ' +
              (d.rate === 1 ? '100%' : (d.rate * 100).toFixed(2) + '%') +
              ' = <strong>' + won(d.amount) + '</strong></li>';
    });
    html += '<li>합계 <strong>' + won(r.converted.total) + '</strong></li></ul>';
    html += '<p><strong>③ 소득인정액 = ' + won(r.evaluated) + ' + ' +
            won(r.converted.total) + ' = ' + won(r.recognized) + '</strong></p>';
    html += '<p class="calc-dim">' + W.year + '년 ' + input.householdSize +
            '인 가구 기준 중위소득 ' + won(r.median) + ' 기준입니다.</p>';
    html += '</details>';

    /* 부양의무자 — 자녀 소득이 걱정인 경우가 가장 많다 */
    html += '<div class="calc-supporter"><p><strong>자녀 소득이 영향을 주나요?</strong></p><ul>';
    r.results.forEach(function (x) {
      html += '<li>' + x.name + ' — ' + x.supporter + '</li>';
    });
    html += '</ul><p class="calc-dim">기초연금은 산식이 달라 자녀 소득·재산을 아예 보지 않습니다.</p></div>';

    html += '<p class="calc-disclaimer">이 결과는 참고값입니다. 실제 선정은 신청 후 ' +
            '공적자료 조사로 확정되고, 가구특성별 지출비용처럼 여기에 반영되지 않는 항목이 ' +
            '있습니다. <strong>경계선에 걸린다면 결과만 보고 포기하지 말고 신청해 정식 조사를 ' +
            '받아보는 편이 낫습니다.</strong></p>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var input = {
      householdSize: Math.max(1, Math.round(num('householdSize')) || 1),
      region: form.elements['region'].value,
      earnedIncome: man(num('earnedIncome')),
      otherIncome: man(num('otherIncome')),
      housing: man(num('housing')),
      general: man(num('general')),
      financial: man(num('financial')),
      car: man(num('car')),
      debt: man(num('debt'))
    };
    render(calculate(input), input);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('reset', function () {
    out.hidden = true;
    out.innerHTML = '';
  });
})();
