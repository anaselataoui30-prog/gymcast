// GYMCAST client auth: attaches the Bearer token to every /api/admin request.
(function () {
  const KEY = "gc_token";

  window.gcAuth = {
    getToken: () => localStorage.getItem(KEY),
    setToken: (v) => localStorage.setItem(KEY, v),
    clear: () => localStorage.removeItem(KEY),
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    init = init || {};
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (url.indexOf("/api/admin") !== -1) {
      const tok = localStorage.getItem(KEY);
      if (tok) {
        if (init.headers instanceof Headers) {
          if (!init.headers.has("Authorization")) init.headers.set("Authorization", "Bearer " + tok);
        } else {
          init.headers = Object.assign({}, init.headers);
          if (!init.headers["Authorization"] && !init.headers["authorization"]) {
            init.headers["Authorization"] = "Bearer " + tok;
          }
        }
      }
    }
    return origFetch.call(this, input, init);
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this._gcUrl = url;
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this._gcUrl && String(this._gcUrl).indexOf("/api/admin") !== -1) {
      const tok = localStorage.getItem(KEY);
      if (tok) this.setRequestHeader("Authorization", "Bearer " + tok);
    }
    return xhrSend.apply(this, arguments);
  };
})();
