"use strict";
/*
  تطبيق المظهر المحفوظ قبل الرسم الأول لمنع وميض السمة الخاطئة.
  يُحمَّل هذا الملف من الرأس (head) بشكل متزامن قبل ورقة الأنماط.
*/
(function () {
  var mode = "system";
  try {
    var stored = localStorage.getItem("hlc-theme");
    if (stored === "dark" || stored === "light" || stored === "system") {
      mode = stored;
    }
  } catch (error) {
    /* التخزين غير متاح: نستخدم وضع النظام. */
  }
  var dark =
    mode === "dark" ||
    (mode === "system" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  var theme = dark ? "dark" : "light";
  var root = document.documentElement;
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-theme-mode", mode);

  var lang = "ar";
  try {
    var storedLang = localStorage.getItem("archive_language");
    if (storedLang === "en" || storedLang === "ar") {
      lang = storedLang;
    }
  } catch (_) {}
  root.setAttribute("lang", lang);
  root.setAttribute("dir", lang === "en" ? "ltr" : "rtl");

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", dark ? "#10151c" : "#f4f6f9");
  }
})();
