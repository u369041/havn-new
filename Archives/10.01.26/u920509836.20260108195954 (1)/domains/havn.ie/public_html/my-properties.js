/* =========================================================
   my-listings.js — my-listings.html (auth required)
   Stable rollback: requireAuth + /api/properties/mine
   ========================================================= */

(function () {
  "use strict";

  const grid = document.getElementById("grid");
  const notice = document.getElementById("notice");
  const search = document.getElementById("search");
  const refreshBtn = document.getElementById("refreshBtn");

  const dbgAuth = document.getElementById("dbgAuth");
  const dbgCount = document.getElementById("dbgCount");
  const dbgVer = document.getElementById("dbgVer");

  let all = [];

  function setNotice(message, isError = false) {
    if (!notice) return;
    notice.style.display = "block";
    notice.textContent = message;
    notice.className = "notice" + (isError ? " error" : "");
  }

  function clearNotice() {
    if (!notice) return;
    notice.style.display = "none";
    notice.textContent = "";
    notice.className = "notice";
  }

  function safeText(v) {
    return (v === null || v === undefined) ? "" : String(v);
  }

  function getThumb(p) {
    const imgs = p.images || p.photos || [];
    if (Array.isArray(imgs) && imgs.length) {
      const first = imgs[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object") return first.url || first.secure_url || "";
    }
    return "";
  }

  function buildCard(p) {
    const slug = p.slug || "";
    const status = (p.status || "").toUpperCase();
    const title = p.title || p.displayTitle || p.addressLine1 || "Property";
    const addr = [p.addressLine1, p.addressLine2, p.town, p.county].filter(Boolean).join(", ");
    const thumb = getThumb(p);

    const link = slug
      ? ("/property.html?slug=" + encodeURIComponent(slug))
      : "/property-upload.html";

    const el = document.createElement("a");
    el.className = "prop-card";
    el.href = link;

    const img = document.createElement("img");
    img.className = "prop-thumb";
    img.alt = safeText(title);
    img.loading = "lazy";
    img.src = thumb || "data:image/svg+xml;charset=utf-8," + encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
        <rect width="1200" height="600" fill="#e5e7eb"/>
        <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="44" font-family="Arial">No image</text>
      </svg>
    `);

    const body = document.createElement("div");
    body.className = "prop-body";

    const h = document.createElement("h3");
    h.className = "prop-title";
    h.textContent = title;

    const meta = document.createElement("div");
    meta.className = "prop-meta";
    meta.innerHTML = `
      <span>${safeText(addr, "—")}</span>
    `;

    const chips = document.createElement("div");
    chips.className = "prop-chips";

    function chip(txt) {
      if (!txt) return;
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = txt;
      chips.appendChild(c);
    }

    chip(status || "UNKNOWN");
    if (p.updatedAt) chip("Updated " + safeText(p.updatedAt).slice(0, 10));
    if (p.createdAt) chip("Created " + safeText(p.createdAt).slice(0, 10));

    body.appendChild(h);
    body.appendChild(meta);
    body.appendChild(chips);

    el.appendChild(img);
    el.appendChild(body);

    return el;
  }

  function render(list) {
    if (!grid) return;
    grid.innerHTML = "";

    if (!list.length) {
      setNotice("No listings found for this account yet.");
      dbgCount && (dbgCount.textContent = "count: 0");
      return;
    }

    clearNotice();
    list.forEach(p => {
      try { grid.appendChild(buildCard(p)); } catch {}
    });

    dbgCount && (dbgCount.textContent = "count: " + list.length);
  }

  function applyFilter() {
    const q = (search && search.value ? search.value : "").trim().toLowerCase();
    if (!q) return render(all);

    const filtered = all.filter(p => {
      const text = [
        p.status,
        p.title,
        p.displayTitle,
        p.addressLine1,
        p.addressLine2,
        p.town,
        p.county
      ].map(safeText).join(" ").toLowerCase();

      return text.includes(q);
    });

    render(filtered);
  }

  async function loadMine() {
    clearNotice();

    if (!window.HAVN_AUTH || !window.HAVN_AUTH.apiFetch) {
      setNotice("HAVN_AUTH failed to load. Check /havn-auth.js deployment.", true);
      return;
    }

    dbgVer && (dbgVer.textContent = "auth.js: " + (window.HAVN_AUTH.__version || "?"));
    dbgAuth && (dbgAuth.textContent = "auth: " + (window.HAVN_AUTH.isLoggedIn() ? "yes" : "no"));

    // Require auth
    if (!window.HAVN_AUTH.requireAuth()) return;

    let data;
    try {
      data = await window.HAVN_AUTH.apiFetch("/api/properties/mine");
    } catch (e) {
      // If unauthorized, clear token and redirect
      if (e.status === 401) {
        window.HAVN_AUTH.clearToken();
        window.HAVN_AUTH.requireAuth();
        return;
      }
      setNotice("Failed to load your listings: " + (e.message || "unknown error"), true);
      return;
    }

    all = Array.isArray(data) ? data : (data && data.items ? data.items : []);
    render(all);
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadMine();
    if (search) search.addEventListener("input", applyFilter);
    if (refreshBtn) refreshBtn.addEventListener("click", loadMine);
  });
})();
