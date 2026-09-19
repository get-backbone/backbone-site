(function () {
  var accept = document.getElementById("licence-accept");
  var start = document.getElementById("licence-github-start");

  if (!accept || !start) {
    return;
  }

  function syncGithubStart() {
    var enabled = accept.checked;
    start.setAttribute("aria-disabled", enabled ? "false" : "true");
    if (enabled) {
      start.removeAttribute("tabindex");
      start.classList.remove("opacity-40", "pointer-events-none");
    } else {
      start.setAttribute("tabindex", "-1");
      start.classList.add("opacity-40", "pointer-events-none");
    }
  }

  accept.addEventListener("change", syncGithubStart);
  start.addEventListener("click", function (event) {
    if (start.getAttribute("aria-disabled") === "true") {
      event.preventDefault();
    }
  });
  syncGithubStart();
})();
