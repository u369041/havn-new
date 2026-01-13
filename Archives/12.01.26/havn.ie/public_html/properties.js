/* =========================================================
   properties.js — properties.html public browse (Stable + Schema-Agnostic)
   - Loads /api/properties (PUBLISHED only)
   - Supports local search filtering
   - Auto-fills search from URL ?q=
   - Reads optional URL ?mode=buy|rent|share (display only)
   - Supports BOTH schema styles:
       address1/address2/city/county  (backend canonical)
       addressLine1/addressLine2/town/county (legacy/alt)
   ========================================================= */

(function () {
  "use strict";

  const grid = document.getElementById("grid");
  const notice = document.getElementById("notice");
  const search = document.getElementById("search");

  const modeChip = document.getElementById("modeChip");
  const countChip = document.getElementById("countChip");
  const subText = document.getElementById("subText");

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

  function clampMode(mode) {
    const m = safeText(mode).trim().toLowerCase();
    if (m === "buy" || m === "rent" || m === "share") return m;
    return "buy";
  }

  function getFirstDefined(...vals) {
    for (const v of vals) {
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return "";
  }

  function getAddress(p) {
    // Support both schemas
    const a1 = getFirstDefined(p.address1, p.addressLine1);
    const a2 = getFirstDefined(p.address2, p.addressLine2);
    const city = getFirstDefined(p.city, p.town);
    const county = getFirstDefined(p.county);

    return [a1, a2, city, county].filter(Boolean).join(", ");
  }

  function getTitle(p) {
    // Prefer title, fallback to address, then generic
    const title = getFirstDefined(p.title, p.displayTitle);
    if (title) return safeText(title);
    const addr = getAddress(p);
    if (addr) return addr;
    return "Property";
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

  function svgFallback() {
    return (
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600">
          <rect width="1200" height="600" fill="#e5e7eb"/>
          <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#6b7280" font-size="44" font-family="Arial">No image</text>
        </svg>
      `)
    );
  }

  function buildCard(p) {
    const slug = safeText(p.slug);
    const url = "/property.html?slug=" + encodeURIComponent(slug);

    const title = getTitle(p);
    const addr = getAddress(p);
    const price = p.price ? ("€" + Number(p.price).toLocaleString("en-IE")) : "";
    const beds = (p.bedrooms !== undefined && p.bedrooms !== null && p.bedrooms !== "")
      ? `${p.bedrooms} bed` : "";
    const baths = (p.bathrooms !== undefined && p.bathrooms !== null && p.bathrooms !== "")
      ? `${p.bathrooms} bath` : "";
    const type = getFirstDefined(p.propertyType, p.type);

    const thumb = getThumb(p);

    const el = document.createElement("a");
    el.className = "prop-card";
    el.href = url;

    const img = document.createElement("img");
    img.className = "prop-thumb";
    img.alt = safeText(title);
    img.loading = "lazy";
    img.src = thumb || svgFallback();

    const body = document.createElement("div");
    body.className = "prop-body";

    const h = document.createElement("h3");
    h.className = "prop-title";
    h.textContent = title;

    const meta = document.createElement("div");
    meta.className = "prop-meta";
    meta.textContent = addr || "—";

    const chips = document.createElement("div");
    chips.className = "prop-chips";

    function chip(txt) {
      if (!txt) return;
      const c = document.createElement("span");
      c.className = "chip";
      c.textContent = txt;
      chips.appendChild(c);
    }

    chip(price);
    chip(beds);
    chip(baths);
    chip(type);

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

    if (!Array.isArray(list) || !list.length) {
      setNotice("No published properties found.");
      countChip && (countChip.textContent = "Count: 0");
      return;
    }

    clearNotice();

    list.forEach(p => {
      try { grid.appendChild(buildCard(p)); } catch {}
    });

    countChip && (countChip.textContent = "Count: " + list.length);
  }

  function applyFilter() {
    const q = (search && search.value ? search.value : "").trim().toLowerCase();
    if (!q) return render(all);

    const filtered = all.filter(p => {
      const text = [
        p.title,
        p.displayTitle,
        p.address1, p.address2, p.city, p.county,
        p.addressLine1, p.addressLine2, p.town,
        p.propertyType, p.type,
        p.status
      ].map(safeText).join(" ").toLowerCase();

      return text.includes(q);
    });

    render(filtered);
  }

  function getUrlParams() {
    try {
      const u = new URL(window.location.href);
      return {
        q: (u.searchParams.get("q") || "").trim(),
        mode: clampMode(u.searchParams.get("mode") || "buy")
      };
    } catch {
      return { q: "", mode: "buy" };
    }
  }

  async function loadBrowse() {
    clearNotice();

    if (!window.HAVN_AUTH || typeof window.HAVN_AUTH.apiFetch !== "function") {
      setNotice("HAVN_AUTH failed to load. Check /havn-auth.js deployment and caching.", true);
      return;
    }

    const params = getUrlParams();
    const qFromUrl = params.q;
    const modeFromUrl = params.mode;

    // UI: show mode
    if (modeChip) modeChip.textContent = "Mode: " + modeFromUrl;
    if (subText) subText.textContent = "All published listings. Use the search to filter locally.";

    let data;
    try {
      data = await window.HAVN_AUTH.apiFetch("/api/properties");
    } catch (e) {
      setNotice("Failed to load properties: " + (e.message || "unknown error"), true);
      return;
    }

    all = Array.isArray(data) ? data : (data && data.items ? data.items : []);
    render(all);

    // Apply URL query filter if present
    if (search && qFromUrl) {
      search.value = qFromUrl;
      applyFilter();
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadBrowse();
    if (search) search.addEventListener("input", applyFilter);
  });
})();
