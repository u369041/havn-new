/* havn-auth.js — SAFE BASELINE + GLOBAL VERIFY BANNER (Jan 2026)
   - Does NOT weaken security
   - apiFetch ALWAYS returns Response
   - refreshUI toggles [data-auth] + [data-role]
   - Global email verification banner (all pages), except property-upload (has its own UX)
*/

(function () {
  const API_BASE = "https://api.havn.ie";
  const TOKEN_KEY = "token";

  const state = {
    me: null,
    meFetchedAt: 0,
    meTTLms: 30 * 1000, // cache ME for 30s
    bannerEl: null,
    bannerShown: false
  };

  function now() { return Date.now(); }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
  }

  function setToken(t) {
    try { localStorage.setItem(TOKEN_KEY, t || ""); } catch {}
  }

  function clearToken() {
    try { localStorage.removeItem(TOKEN_KEY); } catch {}
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function isAdmin(me) {
    const role = (me && me.role) ? String(me.role).toLowerCase() : "";
    return role === "admin";
  }

  function safeJsonParse(text) {
    try { return text ? JSON.parse(text) : null; } catch { return null; }
  }

  async function readTextSafe(res) {
    try { return await res.text(); } catch { return ""; }
  }

  // ✅ ALWAYS returns Response
  async function apiFetch(url, opts = {}) {
    const token = getToken();
    const headers = Object.assign({}, opts.headers || {});

    // Don't stomp FormData content-type
    const isForm =
      (typeof FormData !== "undefined") &&
      (opts && opts.body && (opts.body instanceof FormData));

    if (!isForm && !headers["Content-Type"] && !headers["content-type"]) {
      headers["Content-Type"] = "application/json";
    }
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    return fetch(url, Object.assign({}, opts, { headers }));
  }

  async function fetchMe({ force = false } = {}) {
    const token = getToken();
    if (!token) {
      state.me = null;
      state.meFetchedAt = 0;
      return null;
    }

    if (!force && state.me && (now() - state.meFetchedAt) < state.meTTLms) {
      return state.me;
    }

    const res = await apiFetch(`${API_BASE}/api/auth/me`, { method: "GET" });
    const text = await readTextSafe(res);
    const json = safeJsonParse(text);

    if (!res.ok) {
      // token may be stale; don’t auto-clear blindly but do reset cache
      state.me = null;
      state.meFetchedAt = 0;
      return null;
    }

    const me = (json && json.user) ? json.user : (json || null);
    state.me = me;
    state.meFetchedAt = now();
    return me;
  }

  function show(el) { if (el) el.style.display = ""; }
  function hide(el) { if (el) el.style.display = "none"; }

  function refreshUI(me = null) {
    const loggedIn = isLoggedIn();

    // data-auth="in" / "out"
    document.querySelectorAll("[data-auth]").forEach((el) => {
      const v = (el.getAttribute("data-auth") || "").toLowerCase().trim();
      if (v === "in") {
        loggedIn ? show(el) : hide(el);
      } else if (v === "out") {
        loggedIn ? hide(el) : show(el);
      }
    });

    // data-role="admin"
    document.querySelectorAll("[data-role]").forEach((el) => {
      const role = (el.getAttribute("data-role") || "").toLowerCase().trim();
      if (role === "admin") {
        // Hide unless confirmed admin
        if (me && isAdmin(me)) show(el);
        else hide(el);
      }
    });
  }

  function getNextParam() {
    try {
      const p = location.pathname || "/";
      const q = location.search || "";
      const h = location.hash || "";
      return p + q + h;
    } catch {
      return "/";
    }
  }

  function requireAuth({ next = null } = {}) {
    const token = getToken();
    if (token) return true;

    const n = next || getNextParam();
    location.href = "/login.html?next=" + encodeURIComponent(n);
    return false;
  }

  async function logout() {
    clearToken();
    state.me = null;
    state.meFetchedAt = 0;
    try { refreshUI(null); } catch {}
    location.href = "/login.html";
  }

  function shouldSuppressBanner() {
    // Don’t duplicate banner on property-upload (it has verifyCard + modal already)
    const path = (location.pathname || "").toLowerCase();
    if (path.includes("property-upload.html")) return true;

    // Don’t show on verify screen itself
    if (path.includes("verify-email.html")) return true;

    // If page already has a “verifyCard” or “vcOverlay”, avoid double UX
    if (document.getElementById("verifyCard")) return true;
    if (document.getElementById("vcOverlay")) return true;

    return false;
  }

  function ensureBannerStyles() {
    if (document.getElementById("havnVerifyBannerStyles")) return;

    const css = `
#havnVerifyBanner{
  position: sticky;
  top: 0;
  z-index: 99999;
  display: none;
  padding: 10px 12px;
  background: linear-gradient(180deg, rgba(245,158,11,.16), rgba(255,255,255,1));
  border-bottom: 1px solid rgba(245,158,11,.30);
  backdrop-filter: blur(8px);
}
#havnVerifyBanner .inner{
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
}
#havnVerifyBanner .left{
  display:flex;
  gap:10px;
  align-items:flex-start;
  min-width: 240px;
  flex: 1 1 520px;
}
#havnVerifyBanner .dot{
  width:10px;height:10px;border-radius:999px;
  background:#f59e0b;
  box-shadow: 0 0 0 4px rgba(245,158,11,.16);
  margin-top:5px;
  flex:0 0 auto;
}
#havnVerifyBanner .txt{
  display:flex; flex-direction:column; gap:2px;
}
#havnVerifyBanner .ttl{
  font-weight: 950;
  font-size: 13px;
  color: rgba(11,18,32,.92);
  line-height: 1.25;
}
#havnVerifyBanner .sub{
  font-weight: 850;
  font-size: 12px;
  color: rgba(11,18,32,.68);
  line-height: 1.35;
}
#havnVerifyBanner .actions{
  display:flex;
  gap:10px;
  align-items:center;
  justify-content:flex-end;
  flex-wrap: wrap;
}
#havnVerifyBanner .btn{
  border: 1px solid rgba(15,23,42,.12);
  background: #fff;
  border-radius: 999px;
  padding: 8px 12px;
  font-weight: 950;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 10px 25px rgba(15,23,42,.06);
  text-decoration: none;
  display:inline-flex;
  align-items:center;
  gap:8px;
  white-space: nowrap;
}
#havnVerifyBanner .btn.blue{
  background:#2563eb;
  border-color:#2563eb;
  color:#fff;
}
#havnVerifyBanner .msg{
  font-size: 12px;
  font-weight: 900;
  color: rgba(11,18,32,.72);
  white-space: nowrap;
}
    `.trim();

    const style = document.createElement("style");
    style.id = "havnVerifyBannerStyles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  function ensureBannerEl() {
    if (state.bannerEl && document.body.contains(state.bannerEl)) return state.bannerEl;

    ensureBannerStyles();

    const el = document.createElement("div");
    el.id = "havnVerifyBanner";
    el.innerHTML = `
      <div class="inner">
        <div class="left">
          <div class="dot"></div>
          <div class="txt">
            <div class="ttl">Verify your email to unlock full features</div>
            <div class="sub">For security and spam prevention, we require verification for submissions and account actions.</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn blue" type="button" id="havnVBResend">Resend email</button>
          <a class="btn" id="havnVBEnter" href="/verify-email.html">Enter token</a>
          <button class="btn" type="button" id="havnVBRecheck">I’ve verified</button>
          <span class="msg" id="havnVBMsg"></span>
        </div>
      </div>
    `;

    document.body.insertBefore(el, document.body.firstChild);
    state.bannerEl = el;
    return el;
  }

  async function requestEmailVerify() {
    const res = await apiFetch(`${API_BASE}/api/auth/request-email-verify`, {
      method: "POST",
      body: "{}"
    });
    const text = await readTextSafe(res);
    const json = safeJsonParse(text);

    if (!res.ok) {
      const msg = (json && json.message) ? json.message : (text || "Could not send verification email.");
      throw new Error(msg);
    }
    return json || { ok: true };
  }

  async function ensureVerifyBanner() {
    if (shouldSuppressBanner()) return;

    const token = getToken();
    if (!token) {
      // logged out => hide banner
      if (state.bannerEl) state.bannerEl.style.display = "none";
      return;
    }

    const me = await fetchMe();
    // If cannot load me, don't show banner (avoid annoying false positives)
    if (!me) {
      if (state.bannerEl) state.bannerEl.style.display = "none";
      return;
    }

    refreshUI(me);

    // Admin bypass
    if (isAdmin(me)) {
      if (state.bannerEl) state.bannerEl.style.display = "none";
      return;
    }

    // Verified? hide
    if (me.emailVerified) {
      if (state.bannerEl) state.bannerEl.style.display = "none";
      return;
    }

    // Needs verification => show banner
    const banner = ensureBannerEl();
    banner.style.display = "block";

    // Keep verify link with next
    const next = getNextParam();
    const enter = document.getElementById("havnVBEnter");
    if (enter) {
      enter.href = "/verify-email.html?next=" + encodeURIComponent(next);
    }

    const msgEl = document.getElementById("havnVBMsg");
    const resendBtn = document.getElementById("havnVBResend");
    const recheckBtn = document.getElementById("havnVBRecheck");

    if (resendBtn && !resendBtn.__bound) {
      resendBtn.__bound = true;
      resendBtn.addEventListener("click", async () => {
        if (msgEl) msgEl.textContent = "";
        resendBtn.disabled = true;
        try {
          await requestEmailVerify();
          if (msgEl) msgEl.textContent = "Sent — check inbox/spam.";
        } catch (e) {
          if (msgEl) msgEl.textContent = (e && e.message) ? e.message : "Failed.";
        } finally {
          setTimeout(() => { resendBtn.disabled = false; }, 900);
        }
      });
    }

    if (recheckBtn && !recheckBtn.__bound) {
      recheckBtn.__bound = true;
      recheckBtn.addEventListener("click", async () => {
        if (msgEl) msgEl.textContent = "";
        recheckBtn.disabled = true;
        try {
          const me2 = await fetchMe({ force: true });
          if (me2 && me2.emailVerified) {
            if (msgEl) msgEl.textContent = "Verified ✅";
            banner.style.display = "none";
          } else {
            if (msgEl) msgEl.textContent = "Not verified yet.";
          }
          refreshUI(me2 || null);
        } finally {
          setTimeout(() => { recheckBtn.disabled = false; }, 700);
        }
      });
    }
  }

  async function boot() {
    // Try immediate UI update based on token only (before /me)
    try { refreshUI(null); } catch {}

    // Then hydrate with /me
    try {
      const me = await fetchMe();
      refreshUI(me);
    } catch {}

    // Then banner
    try { await ensureVerifyBanner(); } catch {}

    // Periodic gentle refresh (keeps admin link accurate + banner auto-hides after verify)
    setInterval(async () => {
      try {
        const me = await fetchMe({ force: true });
        refreshUI(me);
        await ensureVerifyBanner();
      } catch {}
    }, 30 * 1000);
  }

  // Expose minimal API
  window.HAVN_AUTH = {
    API_BASE,
    TOKEN_KEY,
    getToken,
    setToken,
    clearToken,
    isLoggedIn,
    apiFetch,       // ✅ returns Response
    fetchMe,
    refreshUI,
    requireAuth,
    logout,
    ensureVerifyBanner
  };

  // Start
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
