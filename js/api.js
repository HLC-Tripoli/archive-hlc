"use strict";
/*
  عميل واجهة برمجة التطبيقات (API) للواجهة العربية.
  - كل الطلبات نسبية إلى /api/v1 على نفس الأصل (نفس المضيف عبر Angie).
  - يعتمد على كوكي الجلسة (HttpOnly) الذي يرسله المتصفح تلقائياً.
  - يضيف ترويسة CSRF في الطلبات المتغيّرة انطلاقاً من رمز الجلسة الحالي.
  - يوحّد شكل الأخطاء العربية القادمة من الخادم: { error: { code, message, details } }.
*/
(function () {
  var BASE = "/api/v1";
  var MUTATING_METHODS = { POST: true, PUT: true, PATCH: true, DELETE: true };

  function ApiError(status, code, message, details) {
    var error = Error.call(this, message || "حدث خطأ غير متوقع.");
    this.name = "ApiError";
    this.message = message || "حدث خطأ غير متوقع.";
    this.status = status;
    this.code = code || "unknown_error";
    this.details = details || null;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ApiError);
    } else {
      this.stack = error.stack;
    }
  }
  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  Object.defineProperty(ApiError.prototype, "issues", {
    get: function () {
      var details = this.details;
      if (details && Array.isArray(details.issues)) return details.issues;
      return [];
    }
  });

  var state = {
    csrfToken: null,
    onUnauthorized: null
  };

  function setCsrfToken(token) {
    state.csrfToken = typeof token === "string" && token ? token : null;
  }

  function setUnauthorizedHandler(handler) {
    state.onUnauthorized = typeof handler === "function" ? handler : null;
  }

  function withQuery(path, query) {
    if (!query) return path;
    var params = new URLSearchParams();
    Object.keys(query).forEach(function (key) {
      var value = query[key];
      if (value === undefined || value === null || value === "") return;
      params.set(key, String(value));
    });
    var queryString = params.toString();
    return queryString ? path + "?" + queryString : path;
  }

  async function parseErrorResponse(response) {
    var payload = null;
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
    var errorBody = payload && payload.error ? payload.error : {};
    return new ApiError(
      response.status,
      errorBody.code,
      errorBody.message,
      errorBody.details
    );
  }

  async function request(method, path, options) {
    options = options || {};
    var headers = Object.assign(
      { Accept: "application/json" },
      options.headers || {}
    );
    var init = {
      method: method,
      headers: headers,
      credentials: "same-origin"
    };

    if (options.formData) {
      init.body = options.formData;
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.json);
    }

    if (state.csrfToken && MUTATING_METHODS[method]) {
      headers["X-CSRF-Token"] = state.csrfToken;
    }

    var response;
    try {
      response = await fetch(BASE + path, init);
    } catch (error) {
      throw new ApiError(
        0,
        "network_error",
        "تعذر الاتصال بالخادم. تحقق من اتصالك بالشبكة ثم أعد المحاولة."
      );
    }

    if (response.status === 401) {
      var unauthorized = await parseErrorResponse(response);
      if (state.onUnauthorized && path !== "/auth/login") {
        state.onUnauthorized(unauthorized);
      }
      throw unauthorized;
    }

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    if (options.rawResponse) {
      return response;
    }
    if (response.status === 204) {
      return null;
    }
    var text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  function filenameFromDisposition(disposition) {
    if (!disposition) return null;
    var utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    if (utf8Match) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch (error) {
        return utf8Match[1];
      }
    }
    var plainMatch = /filename="?([^";]+)"?/i.exec(disposition);
    return plainMatch ? plainMatch[1] : null;
  }

  window.HlcApi = {
    ApiError: ApiError,
    setCsrfToken: setCsrfToken,
    setUnauthorizedHandler: setUnauthorizedHandler,
    withQuery: withQuery,
    url: function (path) {
      return BASE + path;
    },
    get: function (path, query) {
      return request("GET", withQuery(path, query));
    },
    post: function (path, json) {
      return request("POST", path, { json: json === undefined ? {} : json });
    },
    postForm: function (path, formData) {
      return request("POST", path, { formData: formData });
    },
    patch: function (path, json) {
      return request("PATCH", path, { json: json });
    },
    del: function (path) {
      return request("DELETE", path);
    },
    download: async function (path, query) {
      var response = await request("GET", withQuery(path, query), {
        rawResponse: true
      });
      return {
        blob: await response.blob(),
        filename:
          filenameFromDisposition(response.headers.get("content-disposition")) ||
          "download"
      };
    },
    saveBlob: function (blob, filename) {
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);
    }
  };
})();
