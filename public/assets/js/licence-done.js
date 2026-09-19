(function () {
  var params = new URLSearchParams(window.location.search);
  var status = params.get("status");
  var token = params.get("token");

  var active = document.getElementById("licence-done-active");
  var expired = document.getElementById("licence-done-expired");
  var tokenSpent = document.getElementById("licence-done-token-spent");
  var pending = document.getElementById("licence-done-pending");

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("hidden");
  }

  function showOnly(el) {
    hide(pending);
    hide(active);
    hide(expired);
    hide(tokenSpent);
    show(el);
  }

  if (status === "expired") {
    showOnly(expired);
    return;
  }

  if (!token) {
    return;
  }

  showOnly(active);

  var bodyEl = document.getElementById("licence-body");
  var toggle = document.getElementById("licence-toggle");
  var toggleLabel = document.getElementById("licence-toggle-label");
  var iconShow = document.getElementById("licence-toggle-icon-show");
  var iconHide = document.getElementById("licence-toggle-icon-hide");
  var copyBtn = document.getElementById("licence-copy");
  var licenceText = "";
  var revealed = false;

  function maskLicence(text) {
    return text.replace(/./g, "*");
  }

  function renderLicence() {
    if (!bodyEl || !licenceText) return;
    bodyEl.textContent = revealed ? licenceText : maskLicence(licenceText);
    if (toggle) {
      toggle.setAttribute("aria-pressed", revealed ? "true" : "false");
      toggle.setAttribute("title", revealed ? "Hide licence" : "Show licence");
    }
    if (toggleLabel) toggleLabel.textContent = revealed ? "Hide" : "Show";
    if (iconShow) {
      if (revealed) iconShow.classList.add("hidden");
      else iconShow.classList.remove("hidden");
    }
    if (iconHide) {
      if (revealed) iconHide.classList.remove("hidden");
      else iconHide.classList.add("hidden");
    }
  }

  fetch("https://licence.backbonehq.io/v1/licence/community?token=" + encodeURIComponent(token), {
    headers: { Accept: "text/plain" },
  })
    .then(function (res) {
      if (res.status === 410 || res.status === 403) {
        showOnly(tokenSpent);
        throw new Error("token_spent");
      }
      if (!res.ok) {
        throw new Error("fetch_failed");
      }
      return res.text();
    })
    .then(function (text) {
      licenceText = text.trim();
      renderLicence();
    })
    .catch(function (err) {
      if (err && err.message === "token_spent") return;
      showOnly(pending);
      var heading = pending.querySelector("h1");
      var blurb = pending.querySelector("p");
      if (heading) heading.textContent = "Could not load licence file";
      if (blurb) {
        blurb.innerHTML =
          'Try again to <a class="text-[#7C87F7] hover:underline" href="https://licence.backbonehq.io/oauth/github/start">Continue with GitHub</a>.';
      }
    });

  if (toggle) {
    toggle.addEventListener("click", function () {
      if (!licenceText) return;
      revealed = !revealed;
      renderLicence();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      if (!licenceText) return;
      navigator.clipboard.writeText(licenceText).then(function () {
        copyBtn.setAttribute("title", "Copied");
        copyBtn.setAttribute("aria-label", "Copied");
        setTimeout(function () {
          copyBtn.setAttribute("title", "Copy");
          copyBtn.setAttribute("aria-label", "Copy licence");
        }, 1500);
      });
    });
  }
})();
