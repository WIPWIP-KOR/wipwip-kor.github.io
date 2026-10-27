/* 주택 취득세 계산기
 *
 * 기준 수치는 data/finance.yaml의 acquisition_tax에서 레이아웃이 주입한다.
 *
 * 세율은 6억까지 1%, 9억부터 3%이고 그 사이는 이어지는 구간이다.
 *   구간 세율 = (취득가액 × 2 ÷ 3억 − 3) ÷ 100, 소수점 5자리에서 반올림
 * 6억과 9억을 넣으면 각각 정확히 1%, 3%가 나와 양 끝에서 끊기지 않는다.
 *
 * 이 계산기의 본론은 "100% 감면"의 실제 감면율이다. 생애최초 감면은 100%지만
 * 한도가 200만 원이라, 취득세가 200만 원인 주택(= 2억 원)까지만 진짜 전액 감면이고
 * 그 위로는 감면율이 급격히 떨어진다. 공식 안내는 "100% 감면, 한도 200만 원"까지만
 * 적고 이 사실을 금액으로 보여주지 않는다.
 *
 * 범위: 무주택·1주택 유상취득만. 다주택 중과와 증여·상속은 다루지 않는다.
 */
(function () {
  'use strict';

  var W = window.WELFARE;
  if (!W || !W.finance || !W.finance.acquisition_tax) return;
  var A = W.finance.acquisition_tax;

  var won = function (n) { return Math.round(n).toLocaleString('ko-KR') + '원'; };
  var eok = function (n) { return (n / 100000000).toFixed(n % 100000000 === 0 ? 0 : 1) + '억'; };

  function rateFor(price) {
    if (price <= A.구간_하한) return A.세율_6억이하;
    if (price >= A.구간_상한) return A.세율_9억초과;
    var r = (price * A.구간_배수 / A.구간_분모 - A.구간_차감) / 100;
    var f = Math.pow(10, A.세율_반올림_자리);
    return Math.round(r * f) / f;
  }

  function reliefCap(kind) {
    var f = A.생애최초_감면;
    if (kind === 'first') return f.한도_일반;
    if (kind === 'first_decline') return f.한도_인구감소지역;
    if (kind === 'birth') return A.출산양육_감면_한도;
    return 0;
  }

  function compute(price, area, kind) {
    var rate = rateFor(price);
    var acq = price * rate;
    var edu = acq * A.지방교육세_비율;
    var farm = area > A.농특세_면제_전용면적 ? price * A.농특세율 : 0;
    var cap = reliefCap(kind);
    var eligible = cap > 0 && (kind === 'birth' || price <= A.생애최초_감면.주택가격_상한);
    var relief = eligible ? Math.min(acq, cap) : 0;
    return {
      rate: rate, acq: acq, edu: edu, farm: farm, cap: cap,
      eligible: eligible, relief: relief,
      total: (acq - relief) + edu + farm,
      before: acq + edu + farm
    };
  }

  var form = document.getElementById('acq-form');
  var out = document.getElementById('acq-result');
  if (!form || !out) return;

  function num(id) {
    var el = form.elements[id];
    if (!el) return 0;
    var v = parseFloat(String(el.value).replace(/[^0-9.]/g, ''));
    return isNaN(v) ? 0 : v;
  }

  function render() {
    var price = num('price') * 10000;
    var area = num('area');
    var kind = form.elements.relief ? form.elements.relief.value : 'none';
    var r = compute(price, area, kind);

    var html = '';
    html += '<div class="calc-headline">' +
            '<span class="calc-headline-label">납부할 세금 합계</span>' +
            '<span class="calc-headline-value">' + won(r.total) + '</span>' +
            '</div>';

    html += '<table><tbody>';
    html += '<tr><td>취득세율</td><td>' + (r.rate * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%</td></tr>';
    html += '<tr><td>취득세</td><td>' + won(r.acq) + '</td></tr>';
    if (r.relief > 0) {
      html += '<tr><td>− 감면 (한도 ' + won(r.cap) + ')</td><td>− ' + won(r.relief) + '</td></tr>';
      html += '<tr><td>취득세 (감면 후)</td><td>' + won(r.acq - r.relief) + '</td></tr>';
    }
    html += '<tr><td>지방교육세 (취득세액의 ' + (A.지방교육세_비율 * 100).toFixed(0) + '%)</td><td>' + won(r.edu) + '</td></tr>';
    html += '<tr><td>농어촌특별세' + (r.farm > 0 ? ' (전용 ' + A.농특세_면제_전용면적 + '㎡ 초과)' : ' (비과세)') + '</td><td>' + won(r.farm) + '</td></tr>';
    html += '<tr><td><strong>합계</strong></td><td><strong>' + won(r.total) + '</strong></td></tr>';
    html += '</tbody></table>';

    if (kind !== 'none' && !r.eligible) {
      html += '<p class="calc-note"><strong>감면을 받을 수 없습니다.</strong> 생애최초 감면은 실거래가 ' +
              eok(A.생애최초_감면.주택가격_상한) + ' 원 이하만 대상이고, 입력한 가액은 ' + eok(price) + ' 원입니다.</p>';
    } else if (r.relief > 0) {
      var ratio = r.relief / r.acq;
      var fullUpTo = r.cap / A.세율_6억이하;   /* 취득세가 한도와 같아지는 가액 */
      html += '<p class="calc-note' + (ratio >= 0.999 ? ' calc-note-good' : '') + '">' +
              '<strong>실제 감면율은 ' + (ratio * 100).toFixed(1) + '%입니다.</strong> ' +
              (ratio >= 0.999
                ? '취득세 전액이 감면됐습니다. 한도 ' + won(r.cap) + ' 안에 들어왔기 때문입니다.'
                : '제도는 "100% 감면"이지만 한도가 ' + won(r.cap) + '이라 ' + won(r.acq - r.relief) +
                  '은 그대로 냅니다. 취득세가 한도와 같아지는 ' + eok(fullUpTo) +
                  ' 원 이하 주택까지만 실제로 전액 감면입니다.') +
              '</p>';
      html += '<p class="calc-note">감면 전 ' + won(r.before) + ' → 감면 후 ' + won(r.total) +
              ' (' + won(r.relief) + ' 절감). 지방교육세와 농어촌특별세는 이 계산에서 감면하지 않았습니다.</p>';
    }

    html += '<div class="calc-other"><h3>가액별 세금과 생애최초 감면율</h3>' +
            '<table><thead><tr><th>취득가액</th><th>세율</th><th>취득세</th><th>감면액</th><th>감면율</th></tr></thead><tbody>';
    [20000, 30000, 50000, 60000, 70000, 90000, 120000].forEach(function (m) {
      var p = m * 10000, rr = rateFor(p), ac = p * rr;
      var rel = p <= A.생애최초_감면.주택가격_상한 ? Math.min(ac, A.생애최초_감면.한도_일반) : 0;
      html += '<tr><td>' + eok(p) + '원</td><td>' + (rr * 100).toFixed(3).replace(/0+$/, '').replace(/\.$/, '') + '%</td>' +
              '<td>' + won(ac) + '</td><td>' + (rel ? won(rel) : '불가') + '</td>' +
              '<td>' + (rel ? (rel / ac * 100).toFixed(1) + '%' : '—') + '</td></tr>';
    });
    html += '</tbody></table>' +
            '<p class="calc-note">일반지역 한도 ' + won(A.생애최초_감면.한도_일반) + ' 기준입니다. ' +
            '가액이 오를수록 감면율이 떨어지는 구조입니다.</p></div>';

    html += '<div class="calc-other"><h3>이 계산기가 못 하는 것</h3><ul>' +
            '<li><strong>무주택·1주택 유상취득만 다룹니다.</strong> 조정대상지역 2주택(8%), 3주택 이상(12%) 중과와 ' +
            '법인 취득은 세율 자체가 달라 반영하지 않았습니다.</li>' +
            '<li><strong>증여·상속·신축(원시취득)은 범위 밖입니다.</strong> 세율 체계가 다릅니다.</li>' +
            '<li><strong>지방교육세·농어촌특별세의 감면 연동은 반영하지 않았습니다.</strong> ' +
            '감면은 취득세 본세에만 적용해 계산했으므로 실제 고지액과 차이가 날 수 있습니다.</li>' +
            '<li>인구감소지역 해당 여부, 조정대상지역 지정은 수시로 바뀌므로 직접 확인해야 합니다.</li>' +
            '</ul>' +
            '<p class="calc-note">감면을 받으면 취득 후 3개월 내 전입·상시거주하고 3년간 유지해야 하며, ' +
            '어기면 감면분이 추징됩니다. 신고·납부 기한은 취득일로부터 ' + A.신고납부_기한_일 + '일입니다. ' +
            '정확한 금액은 <strong><a href="https://www.wetax.go.kr" target="_blank" rel="noopener">위택스</a>나 ' +
            '주택 소재지 시·군·구청 세무부서에서 확인하세요.</strong></p></div>';

    out.innerHTML = html;
    out.hidden = false;
  }

  form.addEventListener('submit', function (e) { e.preventDefault(); render(); });
  form.addEventListener('reset', function () { out.hidden = true; out.innerHTML = ''; });
})();
