/* 기초연금 계산기
 *
 * 기준 수치는 data/welfare.yaml의 basic_pension에서 레이아웃이 주입한다 (window.WELFARE).
 * 기초생활보장과 이름만 같고 산식이 완전히 다르므로 income-calc.js와 공유하지 않는다.
 *
 * 소득인정액 = 소득평가액 + 재산의 소득환산액
 *   소득평가액      = 0.7 × (근로소득 − 116만) + 기타소득(공적이전소득 포함)
 *   재산의 소득환산액 = [(일반재산 − 기본재산액) + (금융재산 − 2,000만) − 부채] × 연 4% ÷ 12
 *                      + 고급자동차·회원권 가액
 *
 * 지급액 감액은 ① 국민연금 연계감액 → ② 부부감액 → ③ 소득역전방지 감액 순서로 적용된다.
 * ①은 A급여액(소득재분배급여)을 알아야 해서 브라우저에서 판정할 수 없다. 계산기는 국민연금
 * 월액이 기준연금액의 150%를 넘을 때 경고만 띄우고, ②③만 계산한다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.basic_pension) return;

  var P = W.basic_pension;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var man = function (n) { return (n || 0) * 10000; };
  var pct = function (n) { return Math.round(n * 100) + '%'; };

  function calculate(i) {
    /* ① 소득평가액 — 근로소득만 116만 공제 후 70%. 국민연금은 공적이전소득이라 공제가 없다. */
    var earned = Math.max(0, i.earnedIncome - P.소득평가액_공제) * P.소득평가액_공제율;
    var transfer = i.otherIncome + i.nationalPension;
    var evaluated = earned + transfer;

    /* ② 재산의 소득환산액
       기본재산액 공제 후 일반재산이 음(−)이면 그 잔액이 금융재산 쪽을 상쇄한다(공식 산식의
       대괄호 합산). 반면 금융재산 2,000만 공제는 금융재산 한도 내에서만 적용한다. */
    var basic = P.기본재산액[i.region] || 0;
    var generalNet = i.general - basic;
    var financialNet = Math.max(0, i.financial - P.금융재산_공제);
    var sum = generalNet + financialNet - i.debt;
    var monthlyRate = P.재산환산율_연 / 12;
    var converted = Math.max(0, sum) * monthlyRate + i.luxury;

    var recognized = evaluated + converted;

    var couple = i.household === '부부가구(둘 다 수급)';
    var alone = i.household === '단독가구';
    var line = alone ? P.선정기준액.단독가구 : P.선정기준액.부부가구;
    var count = couple ? 2 : 1;

    /* 지급액 — 부부감액 먼저, 소득역전방지 감액 나중 */
    var per = P.기준연금액;
    var coupleCut = 0;
    if (couple) {
      coupleCut = per * P.부부감액률;
      per -= coupleCut;
    }
    var total = per * count;

    var reverseCut = 0;
    var flooredByMinimum = false;
    if (recognized + total > line) {
      var allowed = Math.max(0, line - recognized);
      reverseCut = total - allowed;
      total = allowed;
      per = total / count;
      var floor = P.기준연금액 * P.최저연금액률;
      if (per < floor) {
        per = floor;
        total = floor * count;
        flooredByMinimum = true;
      }
    }

    return {
      earned: earned, transfer: transfer, evaluated: evaluated,
      basic: basic, generalNet: generalNet, financialNet: financialNet,
      sum: sum, monthlyRate: monthlyRate, converted: converted,
      recognized: recognized,
      line: line, eligible: recognized <= line, gap: line - recognized,
      count: count, couple: couple,
      per: per, total: total,
      coupleCut: coupleCut, reverseCut: reverseCut,
      flooredByMinimum: flooredByMinimum,
      linkageWarning: i.nationalPension > P.기준연금액 * P.연계감액_판정배수
    };
  }

  /* ── 화면 ────────────────────────────────────────────────── */

  var form = document.getElementById('pension-form');
  var out = document.getElementById('pension-result');
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
    html += '<p class="calc-headline-label">소득인정액</p>';
    html += '<p class="calc-headline-value">' + won(r.recognized) + '</p>';
    html += '<p class="calc-headline-note">' + i.household + ' 선정기준액 ' + won(r.line) +
            ' 기준 — <strong>' + (r.eligible ? '대상' : '초과') + '</strong>' +
            (r.eligible ? ' (' + won(r.gap) + ' 여유)' : ' (' + won(-r.gap) + ' 초과)') +
            '</p></div>';

    if (r.eligible) {
      html += '<table class="calc-table"><tbody>';
      html += '<tr><td>기준연금액</td><td>' + won(P.기준연금액) + '</td></tr>';
      if (r.couple) {
        html += '<tr><td>부부감액 ' + pct(P.부부감액률) + '</td><td>− ' + won(r.coupleCut) + ' (1인당)</td></tr>';
      }
      if (r.reverseCut > 0) {
        html += '<tr><td>소득역전방지 감액</td><td>− ' + won(r.reverseCut) +
                ' (가구 합계 기준)</td></tr>';
      }
      html += '<tr class="is-eligible"><td><strong>예상 지급액 (1인)</strong></td><td><strong>' +
              won(r.per) + '</strong></td></tr>';
      if (r.count > 1) {
        html += '<tr class="is-eligible"><td><strong>부부 합계</strong></td><td><strong>' +
                won(r.total) + '</strong></td></tr>';
      }
      html += '</tbody></table>';

      if (r.reverseCut > 0) {
        html += '<p class="calc-note">소득인정액이 선정기준액에 가까워 <strong>소득역전방지 감액</strong>이 ' +
                '걸렸습니다. 기초연금을 받아 선정기준액을 넘어서지 않도록 차액만큼만 지급하는 장치입니다. ' +
                (r.flooredByMinimum
                  ? '다만 <strong>최저연금액(기준연금액의 ' + pct(P.최저연금액률) + ', ' +
                    won(P.기준연금액 * P.최저연금액률) + ')</strong>은 보장되므로 그 밑으로는 내려가지 않습니다.'
                  : '감액폭이 커지면 최저연금액 ' + won(P.기준연금액 * P.최저연금액률) + '이 하한이 됩니다.') +
                '</p>';
        if (r.couple && r.flooredByMinimum) {
          /* 부부 수급 가구에 최저연금액이 1인당 10%로 적용되는지는 복지부 고시 원문으로
             확인하지 못했다. 단독가구 기준(10%)을 1인당 적용한 값이므로 단서를 붙인다. */
          html += '<p class="calc-note">부부 두 분이 모두 받는 경우 최저연금액을 어떻게 ' +
                  '적용하는지는 공식 자료로 확인하지 못했습니다. 위 금액은 1인당 기준연금액의 ' +
                  pct(P.최저연금액률) + '를 적용한 값이니, 이 구간에 걸렸다면 ' +
                  '<strong>국민연금공단(1355)에 실제 금액을 확인하세요.</strong></p>';
        }
      } else {
        html += '<p class="calc-note calc-note-good">소득역전방지 감액 구간이 아니라 ' +
                '위 금액이 그대로 나옵니다.</p>';
      }
    } else {
      html += '<p class="calc-note">소득인정액이 선정기준액을 ' + won(-r.gap) + ' 넘어 ' +
              '지금 기준으로는 대상이 아닙니다. 다만 선정기준액은 매년 1월에 오르고, ' +
              '퇴직·소득 감소·재산 처분이 있으면 시점과 무관하게 재신청할 수 있습니다.</p>';
    }

    if (r.linkageWarning) {
      html += '<p class="calc-note"><strong>국민연금 연계감액을 따로 확인해야 합니다.</strong> ' +
              '국민연금 월액이 기준연금액의 ' + pct(P.연계감액_판정배수) + '(' +
              won(P.기준연금액 * P.연계감액_판정배수) + ')를 넘었습니다. 연계감액은 국민연금 전체가 아니라 ' +
              '그중 <strong>소득재분배급여(A급여)</strong>가 기준연금액의 75%를 넘는지로 판정하는데, ' +
              'A급여액은 국민연금공단(1355)에서만 조회할 수 있어 이 계산기로는 판정할 수 없습니다. ' +
              '위 금액에서 더 깎일 수 있다는 뜻이고, <strong>자격이 사라지는 것은 아닙니다.</strong></p>';
    }

    /* 계산 과정 */
    html += '<details class="calc-steps"><summary>계산 과정 보기</summary>';
    html += '<p><strong>① 소득평가액</strong></p><ul>';
    if (i.earnedIncome > 0) {
      html += '<li>근로소득 ' + won(i.earnedIncome) + ' − 공제 ' + won(P.소득평가액_공제) +
              ' = ' + won(Math.max(0, i.earnedIncome - P.소득평가액_공제)) +
              ', 그중 ' + pct(P.소득평가액_공제율) + ' = <strong>' + won(r.earned) + '</strong></li>';
    } else {
      html += '<li>근로소득 없음</li>';
    }
    if (i.nationalPension > 0) {
      html += '<li>국민연금 ' + won(i.nationalPension) +
              ' <span class="calc-dim">(공적이전소득 — 공제 없이 전액)</span></li>';
    }
    if (i.otherIncome > 0) {
      html += '<li>그 외 소득 ' + won(i.otherIncome) + ' <span class="calc-dim">(공제 없음)</span></li>';
    }
    html += '<li>합계 <strong>' + won(r.evaluated) + '</strong></li></ul>';

    html += '<p><strong>② 재산의 소득환산액</strong></p><ul>';
    html += '<li>일반재산 ' + won(i.general) + ' − 기본재산액(' + i.region + ') ' + won(r.basic) +
            ' = ' + won(r.generalNet) + '</li>';
    html += '<li>금융재산 ' + won(i.financial) + ' − 공제 ' + won(P.금융재산_공제) +
            ' = ' + won(r.financialNet) + '</li>';
    if (i.debt > 0) html += '<li>부채 − ' + won(i.debt) + '</li>';
    html += '<li>환산 대상 ' + won(Math.max(0, r.sum)) + ' × 연 ' + pct(P.재산환산율_연) +
            ' ÷ 12 = <strong>' + won(Math.max(0, r.sum) * r.monthlyRate) + '</strong></li>';
    if (i.luxury > 0) {
      html += '<li>고급자동차·회원권 ' + won(i.luxury) +
              ' <span class="calc-dim">(공제 없이 전액 가산)</span></li>';
    }
    html += '<li>합계 <strong>' + won(r.converted) + '</strong></li></ul>';

    html += '<p><strong>③ 소득인정액 = ' + won(r.evaluated) + ' + ' + won(r.converted) +
            ' = ' + won(r.recognized) + '</strong></p>';
    html += '</details>';

    html += '<div class="calc-supporter"><p><strong>자녀 소득·재산은 보지 않습니다</strong></p>' +
            '<p class="calc-dim">기초연금은 부양의무자 기준이 없습니다. 위에 넣은 값은 ' +
            '부모님 본인과 배우자의 것만이고, 자녀가 얼마를 벌든 판정에 반영되지 않습니다. ' +
            '기초생활보장 급여 중 의료급여만 자녀 소득을 봅니다.</p></div>';

    html += '<p class="calc-disclaimer">이 결과는 참고값입니다. 국민연금 연계감액(A급여 기준), ' +
            '일용근로소득 전액 공제, 무료임차소득, 재산 종류 분류처럼 여기에 반영되지 않는 항목이 ' +
            '있고, 실제 지급액은 만 원 단위로 조정될 수 있습니다. ' +
            '<strong>경계선에 걸린다면 결과만 보고 포기하지 말고 신청해 정식 조사를 받는 편이 ' +
            '낫습니다.</strong></p>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var i = {
      household: form.elements['household'].value,
      region: form.elements['region'].value,
      earnedIncome: man(num('earnedIncome')),
      nationalPension: man(num('nationalPension')),
      otherIncome: man(num('otherIncome')),
      general: man(num('general')),
      financial: man(num('financial')),
      debt: man(num('debt')),
      luxury: man(num('luxury'))
    };
    render(calculate(i), i);
    out.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  form.addEventListener('reset', function () {
    out.hidden = true;
    out.innerHTML = '';
  });
})();
