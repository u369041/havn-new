/* property-upload-verify-ux.js
   - Adds a verification banner + "Resend verification email" on property-upload.html
   - If user is unverified, keeps Submit disabled BUT explains why and provides actions.
   - If user becomes verified, it removes the block and enables normal submit.

   Requirements:
   - JWT stored at localStorage.getItem("token")
   - API endpoints:
     - GET  https://api.havn.ie/api/auth/me
     - POST https://api.havn.ie/api/auth/request-email-verify   (Bearer token)
*/

(function () {
  const API = "https://api.havn.ie";

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

  function ensureStyles() {
    if (document.getElementById("hvnVerifyUxStyle")) return;
    const s = document.createElement("style");
    s.id = "hvnVerifyUxStyle";
    s.textContent = `
      .hvn-verify-bar{
        width: min(1180px, calc(100% - 24px));
        margin: 12px auto 0;
        border-radius: 16px;
        border: 1px solid rgba(245,158,11,0.28);
        background: rgba(245,158,11,0.10);
        color: rgba(11,18,32,0.92);
        padding: 12px 12px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        box-shadow: 0 10px 24px rgba(15,23,42,0.06);
      }
      .hvn-verify-left{display:flex;gap:10px;align-items:flex-start;min-width:0;}
      .hvn-verify-dot{
        width:10px;height:10px;border-radius:50%;
        background:#f59e0b;
        box-shadow:0 0 0 4px rgba(245,158,11,0.18);
        margin-top:6px;
        flex:0 0 auto;
      }
      .hvn-verify-title{font-weight:950;font-size:13px;line-height:1.25;margin:0;}
      .hvn-verify-sub{font-size:12px;color:rgba(11,18,32,0.70);margin:2px 0 0;line-height:1.35;}
      .hvn-verify-actions{display:flex;gap:10px;align-items:center;flex:0 0 auto;}
      .hvn-verify-btn{
        border:0;border-radius:14px;padding:10px 12px;
        font-weight:950;cursor:pointer;font-size:12px;color:#fff;
        background: linear-gradient(135deg, rgba(11,18,32,0.96), rgba(17,24,39,0.96));
        box-shadow: 0 10px 22px rgba(11,18,32,0.14);
      }
      .hvn-verify-btn:disabled{opacity:0.7;cursor:not-allowed;}
      .hvn-verify-link{color:#1d4ed8;font-weight:950;text-decoration:none;font-size:12px;white-space:nowrap;}
      .hvn-verify-link:hover{text-decoration:underline;}
      .hvn-verify-msg{font-size:12px;color:rgba(11,18,32,0.72);}
    `;
    document.head.appendChild(s);
  }

  function findSubmitButton() {
    // robust: find a button whose text is exactly "Submit" (case-insensitive)
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const b of buttons) {
      const t = (b.textContent || "").trim().toLowerCase();
      if (t === "submit") return b;
    }
    return null;
  }

  function insertBanner({ onResend }) {
    ensureStyles();
    if (document.getElementById("hvnVerifyBar")) return;

    const bar = document.createElement("div");
    bar.className = "hvn-verify-bar";
    bar.id = "hvnVerifyBar";

    const left = document.createElement("div");
    left.className = "hvn-verify-left";

    const dot = document.createElement("div");
    dot.className = "hvn-verify-dot";

    const text = document.createElement("div");
    const title = document.createElement("div");
    title.className = "hvn-verify-title";
    title.textContent = "Verify your email to submit this listing";

    const sub = document.createElement("div");
    sub.className = "hvn-verify-sub";
    sub.textContent = "Your draft is saved, but submitting for approval requires a verified email.";

    text.appendChild(title);
    text.appendChild(sub);

    left.appendChild(dot);
    left.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "hvn-verify-actions";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hvn-verify-btn";
    btn.id = "hvnVerifyResendBtn";
    btn.textContent = "Resend verification email";

    const link = document.createElement("a");
    link.className = "hvn-verify-link";
    link.href = "/verify-email.html";
    link.textContent = "I have a token";

    const msg = document.createElement("span");
    msg.className = "hvn-verify-msg";
    msg.id = "hvnVerifyMsg";
    msg.textContent = "";

    btn.addEventListener("click", async () => {
      msg.textContent = "";
      btn.disabled = true;
      try {
        await onResend();
        msg.textContent = "Sent — check your inbox.";
      } catch (e) {
        msg.textContent = e && e.message ? e.message : "Failed to send.";
      } finally {
        setTimeout(() => (btn.disabled = false), 1200);
      }
    });

    actions.appendChild(btn);
    actions.appendChild(link);
    actions.appendChild(msg);

    bar.appendChild(left);
    bar.appendChild(actions);

    document.body.insertBefore(bar, document.body.firstChild);
  }

  function addDisabledHint(submitBtn) {
    // Adds a tooltip / title so greyed out has an explanation
    try {
      submitBtn.title = "Verify your email to enable Submit";
      submitBtn.setAttribute("aria-disabled", "true");
    } catch {}
  }

  (async function boot() {
    const token = getToken();
    if (!token) return;

    const submitBtn = findSubmitButton();
    if (submitBtn) addDisabledHint(submitBtn);

    const me = await getMe(token);
    if (!me) return;
    if (me.role === "admin") return;

    // If not verified => show banner (do NOT try to force-enable Submit; your UI intentionally blocks it)
    if (!me.emailVerified) {
      insertBanner({
        onResend: async () => {
          await resendVerification(token);
        },
      });
      return;
    }

    // Verified => remove banner if present, and remove submit tooltip
    const bar = document.getElementById("hvnVerifyBar");
    if (bar) bar.remove();
    if (submitBtn) {
      submitBtn.title = "";
      submitBtn.removeAttribute("aria-disabled");
    }
  })().catch((e) => {
    console.warn("property-upload-verify-ux boot failed:", e);
  });
})();
