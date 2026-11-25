/**
 * Bootstrap: load i18n, matcher, gemini as classic <script> tags (they rely on globals),
 * then import app.js module and call init().
 */

function loadScript(src) {
  return new Promise(function (resolve, reject) {
    var s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function bootstrap() {
  // Load dependency scripts that inject globals into window scope
  await loadScript("/client/i18n.js");
  await loadScript("/client/matcher.js");
  await loadScript("/client/gemini.js");

  // Now load the main app module and initialize
  var m = await import("/client/app.js");
  if (document.readyState !== "loading") {
    m.init();
  } else {
    document.addEventListener("DOMContentLoaded", function () { return m.init(); });
  }
}

bootstrap();
