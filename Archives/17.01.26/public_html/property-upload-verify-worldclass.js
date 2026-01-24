/* property-upload-verify-worldclass.js
   World-class email verification UX for property-upload.html

   Goals:
   - Submit button should not be a confusing dead-end (greyed out with no explanation).
   - If user is unverified:
       - Keep Submit visually available
       - Intercept click (capture phase) and show a premium modal + banner
       - Provide actions: Resend email, "I've verified" recheck, open verify page
       - Auto recheck every 15s; unlock instantly once verified
   - If verified:
       - Remove any blockers and allow normal submit flow

   Assumptions:
   - JWT stored at localStorage.getItem("token")
   - API endpoints:
       - GET  https://api.havn.ie/api/auth/me
       - POST https://api.havn.ie/api/auth/request-email-verify   (Bearer token)
*/

(function () {
  const API = "https://api.havn.ie";
  const RECHECK_MS = 15000;

  // ---------- helpers ----------
  function getToken() {
    try { return localStorage.getItem("token") || ""; } catch { return ""; }
  }

  async function fetchJson(path, opts = {}) {
    const res = await fetch(API + path, opts);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, json, text };
  }

  async function getMe(token) {
    const r = await fetchJson("/api/auth/me", {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) return null;
    return r.json && r.json.user ? r.json.user : null;
  }

  async function resendVerification(token) {
    const r = await fetchJson("/api/auth/request-email-verify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      const msg = (r.json && r.json.message) ? r.json.message : "Could not send verification email.";
      throw new Error(msg);
    }
    return r.json || { ok: true };
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

  function findSubmitButton() {
    // strongest signal: a button with text "Submit"
    const buttons = $all("button");
    for (const b of buttons) {
      const t = (b.textContent || "").trim().toLowerCase();
      if (t === "submit") return b;
    }
    // fallback: id/name contains submit
    return $("button[id*='submit' i], button[name*='submit' i]") || null;
  }

  function ensureStyles() {
    if (document.getElementById("hvnWcVerifyStyle")) return;

    const s = document.createElement("style");
    s.id = "hvnWcVerifyStyle";
    s.textContent = `
      .hvn-wc-bar{
        width: min(1220px, calc(100% - 24px));
        margin: 12px auto 0;
        border-radius: 18px;
        border: 1px solid rgba(245,158,11,0.26);
        background: rgba(245,158,11,0.10);
        color: rgba(11,18,32,0.92);
        padding: 12px 12px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        box-shadow: 0 14px 34px rgba(15,23,42,0.08);
        backdrop-filter: blur(10px);
      }
      .hvn-wc-left{display:flex;gap:10px;align-items:flex-start;min-width:0;}
      .hvn-wc-dot{
        width:10px;height:10px;border-radius:50%;
        background:#f59e0b;
        box-shadow:0 0 0 4px rgba(245,158,11,0.18);
        margin-top:6px;
        flex:0 0 auto;
      }
      .hvn-wc-title{font-weight:950;font-size:13px;line-height:1.25;margin:0;}
      .hvn-wc-sub{font-size:12px;color:rgba(11,18,32,0.70);margin:2px 0 0;line-height:1.35;}
      .hvn-wc-actions{display:flex;gap:10px;align-items:center;flex:0 0 auto; flex-wrap: wrap;}
      .hvn-wc-btn{
        border:0;border-radius:14px;padding:10px 12px;
        font-weight:950;cursor:pointer;font-size:12px;color:#fff;
        background: linear-gradient(135deg, rgba(11,18,32,0.96), rgba(17,24,39,0.96));
        box-shadow: 0 10px 22px rgba(11,18,32,0.14);
        user-select:none;
      }
      .hvn-wc-btn.secondary{
        color:rgba(11,18,32,0.92);
        background: rgba(255,255,255,0.85);
        border:1px solid rgba(15,23,42,0.12);
        box-shadow: 0 10px 18px rgba(15,23,42,0.06);
      }
      .hvn-wc-btn:disabled{opacity:0.7;cursor:not-allowed;}
      .hvn-wc-link{
        color:#1d4ed8;font-weight:950;text-decoration:none;font-size:12px;white-space:nowrap;
      }
      .hvn-wc-link:hover{text-decoration:underline;}
      .hvn-wc-msg{font-size:12px;color:rgba(11,18,32,0.72);}

      /* Submit badge */
      .hvn-wc-badge{
        display:inline-flex;
        align-items:center;
        gap:8px;
        font-size:12px;
        font-weight:950;
        padding:8px 10px;
        border-radius:999px;
        border:1px solid rgba(15,23,42,0.10);
        background: rgba(255,255,255,0.82);
        box-shadow: 0 10px 18px rgba(15,23,42,0.06);
        color: rgba(11,18,32,0.88);
        margin-left:10px;
      }
      .hvn-wc-badge .miniDot{
        width:9px;height:9px;border-radius:50%;
        background:#f59e0b;
        box-shadow:0 0 0 4px rgba(245,158,11,0.15);
      }

      /* Modal */
      .hvn-wc-overlay{
        position:fixed; inset:0;
        background: rgba(15,23,42,0.55);
        display:none;
        align-items:center;
        justify-content:center;
        padding: 18px;
        z-index: 999999;
      }
      .hvn-wc-overlay.show{display:flex;}
      .hvn-wc-modal{
        width: min(560px, 92vw);
        background: rgba(255,255,255,0.92);
        border:1px solid rgba(15,23,42,0.14);
        border-radius: 22px;
        box-shadow: 0 22px 70px rgba(15,23,42,0.25);
        padding: 16px 16px 14px;
        backdrop-filter: blur(12px);
      }
      .hvn-wc-modal h3{
        margin: 6px 0 4px;
        font-size: 16px;
        font-weight: 950;
        letter-spacing: -0.01em;
        color: rgba(11,18,32,0.95);
      }
      .hvn-wc-modal p{
        margin: 0 0 10px;
        font-size: 13px;
        line-height: 1.45;
        color: rgba(11,18,32,0.72);
      }
      .hvn-wc-modal .row{
        display:flex; gap:10px; flex-wrap:wrap;
        margin-top: 12px;
      }
      .hvn-wc-modal .closeRow{
        display:flex; align-items:center; justify-content:space-between; gap:10px;
      }
      .hvn-wc-x{
        border:0; background:transparent; cursor:pointer;
        font-size: 18px; font-weight: 950; color: rgba(11,18,32,0.70);
        width: 38px; height: 38px; border-radius: 12px;
      }
      .hvn-wc-x:hover{ background: rgba(15,23,42,0.06); }
      .hvn-wc-small{
        font-size:12px;color:rgba(11,18,32,0.62);
      }

      /* Make sure Submit doesn't look "dead" */
      .hvn-wc-submit-unverified{
        opacity: 1 !important;
        filter: none !important;
        cursor: pointer !important;
      }
    `;
    document.head.appendChild(s);
  }

  function ensureModal() {
    ensureStyles();
    let overlay = document.getElementById("hvnWcOverlay");
    if (overlay) return overlay;

    overlay = document.createElement("div");
    overlay.id = "hvnWcOverlay";
    overlay.className = "hvn-wc-overlay";
    overlay.innerHTML = `
      <div class="hvn-wc-modal" role="dialog" aria-modal="true" aria-label="Email verification required">
        <div class="closeRow">
          <div class="hvn-wc-small"><strong>HAVN.ie</strong> • Security</div>
          <button class="hvn-wc-x" id="hvnWcCloseBtn" aria-label="Close">×</button>
        </div>
        <h3>Verify your email to submit this listing</h3>
        <p>
          Your draft is safe and saved. To protect users and prevent spam, HAVN requires a verified email before
          a listing can be submitted for approval.
        </p>

        <div class="row">
          <button class="hvn-wc-btn" id="hvnWcResendBtn" type="button">Resend verification email</button>
          <button class="hvn-wc-btn secondary" id="hvnWcRecheckBtn" type="button">I’ve verified — check again</button>
        </div>

        <div class="row" style="margin-top:10px">
          <a class="hvn-wc-link" id="hvnWcVerifyLink" href="/verify-email.html">Enter token / verify now</a>
          <span class="hvn-wc-msg" id="hvnWcModalMsg"></span>
        </div>

        <div class="hvn-wc-small" style="margin-top:10px">
          Tip: check your spam folder. Verification emails come from <strong>noreply@havn.ie</strong>.
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    // close behaviors
    const close = () => overlay.classList.remove("show");
    $("#hvnWcCloseBtn", overlay).addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });

    return overlay;
  }

  function showModal() {
    const overlay = ensureModal();
    overlay.classList.add("show");
  }

  function insertBanner({ onResend, onRecheck }) {
    ensureStyles();
    if (document.getElementById("hvnWcBar")) return;

    const bar = document.createElement("div");
    bar.className = "hvn-wc-bar";
    bar.id = "hvnWcBar";

    const left = document.createElement("div");
    left.className = "hvn-wc-left";

    const dot = document.createElement("div");
    dot.className = "hvn-wc-dot";

    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "hvn-wc-title";
    title.textContent = "Email verification required before submission";

    const sub = document.createElement("div");
    sub.className = "hvn-wc-sub";
    sub.textContent = "Your draft is saved. Verify your email to unlock Submit and send your listing for approval.";

    text.appendChild(title);
    text.appendChild(sub);

    left.appendChild(dot);
    left.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "hvn-wc-actions";

    const resendBtn = document.createElement("button");
    resendBtn.type = "button";
    resendBtn.className = "hvn-wc-btn";
    resendBtn.id = "hvnWcResendTopBtn";
    resendBtn.textContent = "Resend email";

    const recheckBtn = document.createElement("button");
    recheckBtn.type = "button";
    recheckBtn.className = "hvn-wc-btn secondary";
    recheckBtn.id = "hvnWcRecheckTopBtn";
    recheckBtn.textContent = "I’ve verified";

    const link = document.createElement("a");
    link.className = "hvn-wc-link";
    link.href = "/verify-email.html";
    link.textContent = "Enter token";

    const msg = document.createElement("span");
    msg.className = "hvn-wc-msg";
    msg.id = "hvnWcTopMsg";
    msg.textContent = "";

    resendBtn.addEventListener("click", async () => {
      msg.textContent = "";
      resendBtn.disabled = true;
      try {
        await onResend();
        msg.textContent = "Sent — check your inbox.";
      } catch (e) {
        msg.textContent = e && e.message ? e.message : "Failed to send.";
      } finally {
        setTimeout(() => (resendBtn.disabled = false), 1200);
      }
    });

    recheckBtn.addEventListener("click", async () => {
      msg.textContent = "";
      recheckBtn.disabled = true;
      try {
        const ok = await onRecheck();
        msg.textContent = ok ? "Verified ✅ You can submit now." : "Not verified yet — try again in a moment.";
      } catch (e) {
        msg.textContent = e && e.message ? e.message : "Could not check right now.";
      } finally {
        setTimeout(() => (recheckBtn.disabled = false), 900);
      }
    });

    actions.appendChild(resendBtn);
    actions.appendChild(recheckBtn);
    actions.appendChild(link);
    actions.appendChild(msg);

    bar.appendChild(left);
    bar.appendChild(actions);

    document.body.insertBefore(bar, document.body.firstChild);
  }

  function removeBanner() {
    const bar = document.getElementById("hvnWcBar");
    if (bar) bar.remove();
  }

  function setSubmitBadge(submitBtn, text) {
    if (!submitBtn) return;

    // avoid duplicates
    let badge = document.getElementById("hvnWcSubmitBadge");
    if (!badge) {
      badge = document.createElement("span");
      badge.id = "hvnWcSubmitBadge";
      badge.className = "hvn-wc-badge";
      badge.innerHTML = `<span class="miniDot"></span><span id="hvnWcBadgeText"></span>`;
      submitBtn.insertAdjacentElement("afterend", badge);
    }
    const t = document.getElementById("hvnWcBadgeText");
    if (t) t.textContent = text;
  }

  function removeSubmitBadge() {
    const badge = document.getElementById("hvnWcSubmitBadge");
    if (badge) badge.remove();
  }

  function makeSubmitLookClickable(submitBtn) {
    if (!submitBtn) return;
    // Remove disabled so it doesn't look dead (we still block via click interception)
    submitBtn.disabled = false;
    submitBtn.classList.add("hvn-wc-submit-unverified");
    submitBtn.title = "Verify your email to submit (click for steps)";
  }

  function restoreSubmitNormal(submitBtn) {
    if (!submitBtn) return;
    submitBtn.classList.remove("hvn-wc-submit-unverified");
    submitBtn.title = "";
  }

  function wireModalButtons({ token, recheckNow }) {
    const overlay = ensureModal();
    const msg = $("#hvnWcModalMsg", overlay);
    const resendBtn = $("#hvnWcResendBtn", overlay);
    const recheckBtn = $("#hvnWcRecheckBtn", overlay);

    resendBtn.onclick = async () => {
      msg.textContent = "";
      resendBtn.disabled = true;
      try {
        await resendVerification(token);
        msg.textContent = "Sent — check your inbox.";
      } catch (e) {
        msg.textContent = e && e.message ? e.message : "Failed to send.";
      } finally {
        setTimeout(() => (resendBtn.disabled = false), 1200);
      }
    };

    recheckBtn.onclick = async () => {
      msg.textContent = "";
      recheckBtn.disabled = true;
      try {
        const ok = await recheckNow();
        msg.textContent = ok ? "Verified ✅ You can submit now." : "Not verified yet — try again in a moment.";
        if (ok) {
          setTimeout(() => {
            overlay.classList.remove("show");
          }, 550);
        }
      } catch (e) {
        msg.textContent = e && e.message ? e.message : "Could not check right now.";
      } finally {
        setTimeout(() => (recheckBtn.disabled = false), 900);
      }
    };
  }

  // Hard block submit attempts when unverified (world-class: intercept before other handlers)
  function installSubmitInterceptor(submitBtn, state) {
    if (!submitBtn) return;
    if (submitBtn.__hvnWcInterceptorInstalled) return;
    submitBtn.__hvnWcInterceptorInstalled = true;

    submitBtn.addEventListener(
      "click",
      (e) => {
        // If verified, do nothing — allow normal flow
        if (state.isVerified) return;

        // If not verified, stop all submit logic and show guidance
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();

        showModal();
      },
      true // capture phase
    );
  }

  // ---------- main ----------
  const state = {
    isVerified: false,
    polling: null,
    lastMe: null,
  };

  async function recheckNow(token) {
    const me = await getMe(token);
    if (!me) return false;
    state.lastMe = me;

    if (me.role === "admin") {
      state.isVerified = true;
      return true;
    }

    state.isVerified = !!me.emailVerified;
    return state.isVerified;
  }

  function applyUnverifiedUX(submitBtn, token) {
    makeSubmitLookClickable(submitBtn);
    setSubmitBadge(submitBtn, "Verification required to submit");
    installSubmitInterceptor(submitBtn, state);

    insertBanner({
      onResend: async () => {
        await resendVerification(token);
      },
      onRecheck: async () => {
        const ok = await recheckNow(token);
        if (ok) {
          // unlock immediately
          applyVerifiedUX(submitBtn);
        }
        return ok;
      },
    });

    wireModalButtons({
      token,
      recheckNow: async () => {
        const ok = await recheckNow(token);
        if (ok) applyVerifiedUX(submitBtn);
        return ok;
      },
    });
  }

  function applyVerifiedUX(submitBtn) {
    state.isVerified = true;
    removeBanner();
    removeSubmitBadge();
    restoreSubmitNormal(submitBtn);

    // If your existing code re-disables Submit, we still leave it alone;
    // verified users should pass your frontend checks anyway.
    // We do not force anything except removing our hints.
  }

  async function boot() {
    const token = getToken();
    if (!token) return;

    const submitBtn = findSubmitButton();

    // Always install interceptor (safe): only blocks when unverified
    if (submitBtn) installSubmitInterceptor(submitBtn, state);

    const me = await getMe(token);
    if (!me) return;
    state.lastMe = me;

    if (me.role === "admin" || me.emailVerified) {
      applyVerifiedUX(submitBtn);
    } else {
      applyUnverifiedUX(submitBtn, token);
    }

    // background polling: auto-unlock as soon as verification happens
    if (!state.polling) {
      state.polling = setInterval(async () => {
        try {
          if (state.isVerified) return;
          const ok = await recheckNow(token);
          if (ok) {
            applyVerifiedUX(submitBtn);
          }
        } catch {}
      }, RECHECK_MS);
    }
  }

  // Ensure DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => boot().catch((e) => console.warn(e)));
  } else {
    boot().catch((e) => console.warn(e));
  }
})();
