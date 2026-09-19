(function () {
  var params = new URLSearchParams(window.location.search);
  var status = params.get("status");
  var token = params.get("token");

  var active = document.getElementById("licence-done-active");
  var expired = document.getElementById("licence-done-expired");
  var pending = document.getElementById("licence-done-pending");

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("hidden");
  }

  if (status === "expired") {
    hide(pending);
    hide(active);
    show(expired);
    return;
  }

  if (!token) {
    return;
  }

  hide(pending);
  show(active);

  var bodyEl = document.getElementById("licence-body");
  var toggle = document.getElementById("licence-toggle");
  var copyBtn = document.getElementById("licence-copy");
  var licenceText = "";

  fetch("https://licence.backbonehq.io/v1/licence/community?token=" + encodeURIComponent(token), {
    headers: { Accept: "text/plain" },
  })
    .then(function (res) {
      if (res.status === 410 || res.status === 403) {
        hide(active);
        show(expired);
        throw new Error("expired");
      }
      if (!res.ok) {
        throw new Error("fetch_failed");
      }
      return res.text();
    })
    .then(function (text) {
      licenceText = text.trim();
      if (bodyEl) bodyEl.textContent = licenceText;
    })
    .catch(function (err) {
      if (err && err.message === "expired") return;
      if (pending) {
        hide(active);
        show(pending);
        pending.querySelector("p").textContent =
          "Could not load the licence file yet. Try Continue with GitHub again from /licence/.";
      }
    });

  if (toggle && bodyEl) {
    toggle.addEventListener("click", function () {
      var hidden = bodyEl.classList.contains("hidden");
      if (hidden) {
        bodyEl.classList.remove("hidden");
        toggle.textContent = "Hide licence";
      } else {
        bodyEl.classList.add("hidden");
        toggle.textContent = "Show licence";
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      if (!licenceText) return;
      navigator.clipboard.writeText(licenceText).then(function () {
        copyBtn.textContent = "Copied";
        setTimeout(function () {
          copyBtn.textContent = "Copy";
        }, 1500);
      });
    });
  }
})();
