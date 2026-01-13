/* login.js — CANONICAL SAFE LOGIN */

(async () => {
  const $ = (id) => document.getElementById(id);

  const form = $("loginForm");
  const emailEl = $("email");
  const passEl = $("password");
  const msgEl = $("msg");

  function setMsg(text, type = "error") {
    if (!msgEl) return;
    msgEl.textContent = text;
    msgEl.style.display = "block";
    msgEl.style.background =
      type === "ok" ? "#e8fff1" : type === "warn" ? "#fff7e6" : "#ffecec";
    msgEl.style.border =
      type === "ok" ? "1px solid #8be2b5" : "1px solid #ffb3b3";
    msgEl.style.color = "#222";
  }

  function clearMsg() {
    if (!msgEl) return;
    msgEl.textContent = "";
    msgEl.style.display = "none";
  }

  function getNextParam() {
    const u = new URL(window.location.href);
    return u.searchParams.get("next") || "";
  }

  // If already logged in, redirect away
  if (window.HAVN_AUTH?.isLoggedIn?.()) {
    const next = getNextParam();
    window.location.href = next || "/my-listings.html";
    return;
  }

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearMsg();

    const email = (emailEl?.value || "").trim();
    const password = passEl?.value || "";

    if (!email || !password) {
      setMsg("Please enter both email and password.", "warn");
      return;
    }

    // IMPORTANT: backend most likely expects { email, password }
    // We send ONLY that.
    const payload = { email, password };

    const res = await HAVN_AUTH.apiFetch("/api/auth/login", {
      method: "POST",
      noAuth: true,
      body: JSON.stringify(payload)
    });

    // ✅ If backend returns 400/401/etc, show it clearly
    if (!res.ok) {
      setMsg(
        `Login failed (${res.status}). ${res.error || "Unknown error"}`,
        "error"
      );
      return;
    }

    // ✅ Extract token from any known shape
    const token = HAVN_AUTH.normalizeToken(res.data);

    if (!token) {
      // Successful response but no token in body
      // Show the exact response so you can see it on screen
      console.warn("Login response JSON:", res.data);
      setMsg(
        `Login succeeded but no token was returned. Response: ${JSON.stringify(
          res.data
        )}`,
        "error"
      );
      return;
    }

    HAVN_AUTH.setToken(token);
    setMsg("Login successful ✅ Redirecting...", "ok");

    const next = getNextParam();
    setTimeout(() => {
      window.location.href = next || "/my-listings.html";
    }, 300);
  });
})();
