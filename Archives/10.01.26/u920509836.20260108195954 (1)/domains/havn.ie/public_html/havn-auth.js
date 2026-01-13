/* havn-auth.js — SAFE BASELINE + UI VISIBILITY FIX
   - Does NOT weaken security
   - apiFetch ALWAYS returns Response
   - Automatically shows/hides nav buttons & sections
*/

(function () {
  const API_BASE = "https://api.havn.ie";
  const TOKEN_KEY = "token";

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function setToken(token) {
    try {
      if (!token) localStorage.removeItem(TOKEN_KEY);
      else localStorage.setItem(TOKEN_KEY, token);
    } catch {}
  }

  function clearToken() {
    setToken("");
  }

  function parseJwt(token) {
    try {
      if (!token) return null;
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");

      const json = decodeURIComponent(
        atob(payload)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );

      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function getUser() {
    const token = getToken();
    const payload = parseJwt(token);
    if (!payload) return null;

    const sub = payload.sub ?? payload.userId ?? payload.id ?? null;
    const userId = sub != null && !Number.isNaN(Number(sub)) ? Number(sub) : null;

    return {
      token,
      role: payload.role || "user",
      email: payload.email || null,
      userId,
      exp: payload.exp || null,
      iat: payload.iat || null,
      raw: payload,
    };
  }

  function isLoggedIn() {
    const user = getUser();
    if (!user || !user.token) return false;
    if (user.exp && Date.now() / 1000 > user.exp) return false;
    return true;
  }

  function toApiUrl(input) {
    const url = String(input || "");
    if (!url) return API_BASE;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    if (url.startsWith("/")) return API_BASE + url;
    return API_BASE + "/" + url;
  }

  /**
   * apiFetch ALWAYS returns a real Response
   * - adds Authorization header if token exists
   * - never converts into JSON automatically
   */
  async function apiFetch(input, init = {}) {
    const url = toApiUrl(input);
    const headers = new Headers(init.headers || {});
    const token = getToken();

    if (token) headers.set("Authorization", `Bearer ${token}`);

    // If you send JSON, enforce content-type automatically
    if (init.body && !headers.has("Content-Type") && typeof init.body === "string") {
      try {
        JSON.parse(init.body);
        headers.set("Content-Type", "application/json");
      } catch {}
    }

    const res = await fetch(url, {
      ...init,
      headers,
      credentials: "include",
    });

    return res;
  }

  /**
   * requireAuth: redirect to login if no valid token
   */
  function requireAuth({ next = location.pathname + location.search } = {}) {
    if (!isLoggedIn()) {
      location.href = `/login.html?next=${encodeURIComponent(next)}`;
      return false;
    }
    return true;
  }

  /**
   * logout helper
   */
  function logout() {
    clearToken();
    location.href = "/login.html";
  }

  /**
   * ✅ UI VISIBILITY HANDLER
   * This restores Browse/My Listings/Admin buttons automatically.
   *
   * Supported attributes:
   *  - data-auth="in"  (show only if logged in)
   *  - data-auth="out" (show only if logged out)
   *  - data-role="admin" (show only if admin)
   *  - data-role="user"  (show only if NOT admin)
   */
  function refreshUI(root = document) {
    try {
      const user = getUser();
      const loggedIn = isLoggedIn();
      const role = user?.role || "user";

      // data-auth toggles
      root.querySelectorAll('[data-auth="in"]').forEach((el) => {
        el.style.display = loggedIn ? "" : "none";
      });

      root.querySelectorAll('[data-auth="out"]').forEach((el) => {
        el.style.display = loggedIn ? "none" : "";
      });

      // data-role toggles
      root.querySelectorAll('[data-role="admin"]').forEach((el) => {
        el.style.display = loggedIn && role === "admin" ? "" : "none";
      });

      root.querySelectorAll('[data-role="user"]').forEach((el) => {
        el.style.display = loggedIn && role !== "admin" ? "" : "none";
      });

      // optional: fill user email into any element with data-user-email
      root.querySelectorAll("[data-user-email]").forEach((el) => {
        el.textContent = user?.email || "";
      });
    } catch (err) {
      console.warn("refreshUI error:", err);
    }
  }

  // Auto-run UI refresh when DOM loads
  if (typeof window !== "undefined") {
    document.addEventListener("DOMContentLoaded", () => refreshUI());
  }

  // Expose global helper
  window.HAVN_AUTH = {
    API_BASE,
    getToken,
    setToken,
    clearToken,
    parseJwt,
    getUser,
    isLoggedIn,
    apiFetch,
    requireAuth,
    logout,
    refreshUI,
  };
})();
