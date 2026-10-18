"use strict";
/*
  مبدّل المظهر: النظام / داكن / فاتح
  يطبق السمة عبر data-theme على عنصر html ويحفظ الاختيار في localStorage،
  ولا يسبب أي وميض لأن سكربت الرأس يطبق السمة قبل الرسم الأول.
*/
(function () {
  var STORAGE_KEY = "hlc-theme";
  var MODES = ["system", "dark", "light"];
  var LABELS = {
    system: "النظام",
    dark: "داكن",
    light: "فاتح"
  };
  var ICONS = {
    system:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      '<rect x="2" y="3" width="20" height="14" rx="2"></rect>' +
      '<line x1="8" y1="21" x2="16" y2="21"></line>' +
      '<line x1="12" y1="17" x2="12" y2="21"></line></svg>',
    dark:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>',
    light:
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="4"></circle>' +
      '<path d="M12 2v2"></path><path d="M12 20v2"></path>' +
      '<path d="m4.93 4.93 1.41 1.41"></path>' +
      '<path d="m17.66 17.66 1.41 1.41"></path>' +
      '<path d="M2 12h2"></path><path d="M20 12h2"></path>' +
      '<path d="m6.34 17.66-1.41 1.41"></path>' +
      '<path d="m19.07 4.93-1.41 1.41"></path></svg>'
  };
  var THEME_COLORS = {
    light: "#f4f6f9",
    dark: "#10151c"
  };
  var root = document.documentElement;
  var media = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;
  var mode = "system";
  var controls = [];

  function readStoredMode() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (MODES.indexOf(stored) !== -1) return stored;
    } catch (error) {
      /* التخزين غير متاح: نعود إلى وضع النظام. */
    }
    return "system";
  }

  function resolveTheme(value) {
    if (value === "system") {
      return media && media.matches ? "dark" : "light";
    }
    return value;
  }

  function updateMeta(theme) {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", THEME_COLORS[theme] || THEME_COLORS.light);
    }
  }

  function updateControls() {
    controls.forEach(function (item) {
      var checked = item.mode === mode;
      item.button.setAttribute("aria-checked", checked ? "true" : "false");
      item.button.setAttribute("tabindex", checked ? "0" : "-1");
      item.button.classList.toggle("active", checked);
    });
  }

  function applyMode(value, persist) {
    mode = MODES.indexOf(value) !== -1 ? value : "system";
    var theme = resolveTheme(mode);
    root.setAttribute("data-theme", theme);
    root.setAttribute("data-theme-mode", mode);
    updateMeta(theme);
    updateControls();
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, mode);
      } catch (error) {
        /* التخزين غير متاح: الاختيار يبقى لهذه الجلسة فقط. */
      }
    }
  }

  function buildControl(slot) {
    var group = document.createElement("div");
    group.className = "theme-toggle";
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "مظهر الواجهة");
    MODES.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "theme-toggle-button";
      button.setAttribute("role", "radio");
      button.setAttribute("data-mode", item);
      button.setAttribute("aria-checked", "false");
      button.setAttribute("aria-label", LABELS[item]);
      button.setAttribute("tabindex", "-1");
      button.innerHTML =
        ICONS[item] +
        '<span class="theme-toggle-label">' + LABELS[item] + "</span>";
      button.addEventListener("click", function () {
        applyMode(item, true);
        button.focus();
      });
      group.appendChild(button);
      controls.push({ slot: slot, button: button, mode: item });
    });
    group.addEventListener("keydown", function (event) {
      var index = MODES.indexOf(mode);
      var rtl = getComputedStyle(group).direction === "rtl";
      var target = null;
      if (event.key === "ArrowLeft") {
        target = rtl ? index + 1 : index - 1;
      } else if (event.key === "ArrowRight") {
        target = rtl ? index - 1 : index + 1;
      } else if (event.key === "ArrowDown") {
        target = index + 1;
      } else if (event.key === "ArrowUp") {
        target = index - 1;
      } else if (event.key === "Home") {
        target = 0;
      } else if (event.key === "End") {
        target = MODES.length - 1;
      }
      if (target === null) return;
      event.preventDefault();
      target = (target + MODES.length) % MODES.length;
      applyMode(MODES[target], true);
      var next = group.querySelector('[data-mode="' + MODES[target] + '"]');
      if (next) next.focus();
    });
    slot.appendChild(group);
  }

  document.querySelectorAll("[data-theme-toggle]").forEach(buildControl);

  if (media) {
    var handleSystemChange = function () {
      if (mode === "system") applyMode("system", false);
    };
    if (media.addEventListener) {
      media.addEventListener("change", handleSystemChange);
    } else if (media.addListener) {
      media.addListener(handleSystemChange);
    }
  }

  /* مزامنة الاختيار مع بقية علامات التبويب المفتوحة على نفس الموقع. */
  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    applyMode(readStoredMode(), false);
  });

  applyMode(readStoredMode(), false);
})();
