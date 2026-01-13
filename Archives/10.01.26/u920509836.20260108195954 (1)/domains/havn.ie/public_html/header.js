/* ============================================================
   HAVN Header + Auth Canonicalization (ROOT / FULL FILE)
   ------------------------------------------------------------
   ✅ Canonical token key: localStorage.getItem("token")
   ✅ Migrates legacy keys: havnToken / jwt → token
   ✅ Cross-tab logout sync (storage listener)
   ✅ No alert popups (clean UX)
   ✅ Admin link shows ONLY when role === "admin"
   ✅ Exposes:
        - window.HAVN_AUTH
        - window.renderHavnHeader()
   ✅ Safe: does not break localhost / preview domains
   ============================================================ */

(function () {
  // ------------------------------------------------------------
  // 0) CONFIG
  // ------------------------------------------------------------
  const CANONICAL_HOST = "havn.ie";
  const IS_LOCAL =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1" ||
    location.hostname.endsWith(".local");

  const IS_CANONICAL = location.hostname === CANONICAL_HOST;

  // ------------------------------------------------------------
  // 1) FORCE CANONICAL DOMAIN (ONLY in production)
  // ------------------------------------------------------------
  if (!IS_LOCAL && !IS_CANONICAL) {
    const target = `${location.protocol}//${CANONICAL_HOST}${location.pathname}${location.search}${location.hash}`;
    console.warn("[HAVN] Redirecting to canonical domain:", target);
    location.replace(target);
    return;
  }

  // ------------------------------------------------------------
  // 2) TOKEN MIGRATION (safety)
  // ------------------------------------------------------------
  function migrateTokenKeys() {
    const token = localStorage.getItem("token");
    if (token) return token;

    const legacy1 = localStorage.getItem("havnToken");
    const legacy2 = localStorage.getItem("jwt");

    const found = legacy1 || legacy2;
    if (found) {
      localStorage.setItem("token", found);
      localStorage.removeItem("havnToken");
      localStorage.removeItem("jwt");
      console.warn("[HAVN] Migrated token from legacy key → token");
      return found;
    }
    return "";
  }

  migrateTokenKeys();

  // ------------------------------------------------------------
  // 3) BASIC AUTH HELPERS
  // ------------------------------------------------------------
  function getToken() {
    return localStorage.getItem("token") || "";
  }

  function isLoggedIn() {
    const t = getToken();
    return !!(t && String(t).trim().length > 20);
  }

  function clearTokenLocal() {
    localStorage.removeItem("token");
    localStorage.removeItem("havnToken");
    localStorage.removeItem("jwt");
  }

  function broadcastLogout() {
    localStorage.setItem("havn_logout", String(Date.now()));
  }

  function redirectToLogin() {
    const next = encodeURIComponent(location.pathname + location.search + location.hash);
    location.replace(`login.html?next=${next}`);
  }

  function logout() {
    clearTokenLocal();
    broadcastLogout();
    redirectToLogin();
  }

  // ------------------------------------------------------------
  // 4) JWT DECODE (ROLE + USER META)
  // ------------------------------------------------------------
  function decodeJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length < 2) return null;

      // base64url -> base64
      const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(
        atob(base64)
          .split("")
          .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
          .join("")
      );
      return JSON.parse(json);
    } catch {
      return null;
    }
  }

  function getUserFromToken() {
    const t = getToken();
    if (!t) return null;
    const payload = decodeJwtPayload(t);
    if (!payload) return null;

    // common shapes: { userId, role, email } or { sub, role }
    return {
      userId: payload.userId || payload.sub || null,
      email: payload.email || null,
      role: payload.role || null,
      raw: payload
    };
  }

  function isAdmin() {
    const u = getUserFromToken();
    return u && String(u.role || "").toLowerCase() === "admin";
  }

  // ------------------------------------------------------------
  // 5) CROSS-TAB LOGOUT / TOKEN CHANGE LISTENER
  // ------------------------------------------------------------
  window.addEventListener("storage", (e) => {
    if (e.key === "havn_logout") {
      console.warn("[HAVN] Logout detected in another tab → redirecting");
      if (!location.pathname.endsWith("login.html")) redirectToLogin();
    }

    if (e.key === "token") {
      // token removed / changed in another tab
      if (!e.newValue && !location.pathname.endsWith("login.html")) {
        console.warn("[HAVN] Token removed in another tab → redirecting");
        redirectToLogin();
      }
    }
  });

  // ------------------------------------------------------------
  // 6) API WRAPPER (auto adds auth header)
  // ------------------------------------------------------------
  async function apiFetch(url, opts = {}) {
    const t = getToken();

    const headers = Object.assign(
      { Accept: "application/json" },
      opts.headers || {},
      t ? { Authorization: `Bearer ${t}` } : {}
    );

    const res = await fetch(url, { ...opts, headers });

    // If backend says token invalid → logout everywhere
    if (res.status === 401 || res.status === 403) {
      console.warn("[HAVN] Auth failed (401/403) → forcing logout");
      broadcastLogout();
      clearTokenLocal();
      if (!location.pathname.endsWith("login.html")) redirectToLogin();
    }

    return res;
  }

  // ------------------------------------------------------------
  // 7) EXPOSE AUTH API
  // ------------------------------------------------------------
  window.HAVN_AUTH = {
    getToken,
    isLoggedIn,
    isAdmin,
    getUserFromToken,
    clearToken: () => {
      clearTokenLocal();
      broadcastLogout();
    },
    redirectToLogin,
    logout,
    apiFetch
  };

  // ------------------------------------------------------------
  // 8) HEADER RENDER
  // ------------------------------------------------------------
  function renderHeader() {
    const root = document.getElementById("havn-header");
    if (!root) return;

    const loggedIn = isLoggedIn();
    const admin = loggedIn && isAdmin();

    root.innerHTML = `
      <header style="
        background:#fff;
        border-bottom:1px solid rgba(15,23,42,.08);
        padding:14px 18px;
        position:sticky;
        top:0;
        z-index:999;
      ">
        <div style="
          max-width:1200px;
          margin:0 auto;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:18px;
        ">
          <a href="index.html" style="
            display:flex;
            align-items:center;
            gap:10px;
            font-weight:900;
            text-decoration:none;
            color:#0f172a;
            font-size:16px;
          ">
            <span style="
              width:28px;
              height:28px;
              border-radius:8px;
              background:#2563eb;
              display:inline-flex;
              align-items:center;
              justify-content:center;
              color:#fff;
              font-weight:900;
              font-size:14px;
            ">H</span>
            HAVN.ie
          </a>

          <nav style="display:flex; gap:16px; align-items:center; font-weight:800;">
            <a href="index.html" style="text-decoration:none; color:#0f172a;">Home</a>
            <a href="properties.html" style="text-decoration:none; color:#0f172a;">Browse</a>
            ${loggedIn ? `<a href="my-listings.html" style="text-decoration:none; color:#0f172a;">My Listings</a>` : ``}
            ${admin ? `<a href="admin.html" style="text-decoration:none; color:#0f172a;">Admin</a>` : ``}
          </nav>

          <div style="display:flex; gap:10px; align-items:center;">
            <a href="property-upload.html" style="
              background:#2563eb;
              color:#fff;
              padding:10px 14px;
              border-radius:999px;
              font-weight:900;
              text-decoration:none;
              font-size:13px;
            ">List a property</a>

            ${
              loggedIn
                ? `<button id="btnLogout" style="
                    background:#fff;
                    border:1px solid rgba(15,23,42,.18);
                    padding:10px 14px;
                    border-radius:999px;
                    font-weight:900;
                    cursor:pointer;
                    font-size:13px;
                  ">Logout</button>`
                : `<a href="login.html" style="
                    background:#fff;
                    border:1px solid rgba(15,23,42,.18);
                    padding:10px 14px;
                    border-radius:999px;
                    font-weight:900;
                    text-decoration:none;
                    font-size:13px;
                    color:#0f172a;
                  ">Login</a>`
            }
          </div>
        </div>
      </header>
    `;

    const logoutBtn = document.getElementById("btnLogout");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => logout());
    }
  }

  // ✅ Expose manual render hook so pages can call it after loader
  window.renderHavnHeader = renderHeader;

  // Auto-render on DOM ready
  document.addEventListener("DOMContentLoaded", renderHeader);
})();
