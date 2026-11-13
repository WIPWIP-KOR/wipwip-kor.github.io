/* 계산기 기준값 유효기간 안내.

   Hugo 는 빌드 시점 날짜만 안다. 서버에서 판정하면 사이트를 다시 빌드하지 않는 한
   경고가 영원히 안 뜬다. 그래서 레이아웃은 날짜만 내보내고 판정은 여기서 한다.
   재빌드 없이도 유효기간이 지나면 경고가 뜬다.

   2026-11-06 에 계산기 9개를 내린 이유가 "1월 1일에 틀린 금액을 내놓게 되는데
   점검을 못 한다"였다. 그 이유를 사람이 아니라 데이터로 막는 장치다. */
(function () {
  "use strict";
  var box = document.querySelector(".tool-validity");
  if (!box) return;

  var raw = box.getAttribute("data-valid-until");
  var until = new Date(raw + "T23:59:59+09:00");
  if (isNaN(until.getTime())) return;

  var now = new Date();
  var days = Math.ceil((until - now) / 86400000);
  var title = box.querySelector(".tool-validity-title");
  var body = box.querySelector(".tool-validity-body");

  function show(state, t, b) {
    box.setAttribute("data-state", state);
    title.textContent = t;
    body.textContent = b;
    box.hidden = false;
  }

  if (days < 0) {
    show("expired", "기준값이 지났습니다",
      raw + "까지 확인된 값으로 계산합니다. 복지 기준액과 세법은 해마다 1월에 바뀌므로 " +
      "지금 결과는 최신 고시를 반영하지 못했을 수 있습니다. 실제 신청 전에 소관 기관에서 확인하십시오.");
    document.querySelectorAll("#calc-form").forEach(function (f) {
      f.addEventListener("submit", function () {
        var r = document.querySelector(".calc-result");
        if (r) r.setAttribute("data-stale", "1");
      });
    });
  } else if (days <= 45) {
    show("soon", "기준값 갱신이 곧 필요합니다",
      raw + "까지 확인된 값입니다. " + days + "일 뒤부터는 새 고시를 반영해야 합니다.");
  } else {
    show("ok", "", raw + "까지 확인된 기준값으로 계산합니다.");
  }
})();
