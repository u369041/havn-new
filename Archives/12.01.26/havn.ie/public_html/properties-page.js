/* HAVN — Browse properties (properties.html)
   Theme 1 — Classic Light
   Compact cards, URL-driven filters, live updates.

   Key fix:
   - Always use API_BASE https://api.havn.ie (no trailing slash)
   - Always call /api/properties
*/

(function () {
  const API_BASE = (window.HAVN_API_BASE || "https://api.havn.ie").replace(/\/$/, "");
  const LIST_ENDPOINT = `${API_BASE}/api/properties`;

  const els = {
    q: document.getElementById("q"),
    type: document.getElementById("type"),
    county: document.getElementById("county"),
    city: document.getElementById("city"),
    min: document.getElementById("min"),
    max: document.getElementById("max"),
    ptype: document.getElementById("ptype"),
    sort: document.getElementById("sort"),
    apply: document.getElementById("apply"),
    reset: document.getElementById("reset"),
    grid: document.getElementById("grid"),
    count: document.getElementById("count"),
    pill: document.getElementById("pill"),
    empty: document.getElementById("empty"),
    emptyReset: document.getElementById("emptyReset"),
    debugToggle: document.getElementById("toggleDebug"),
    debugbar: document.getElementById("debugbar"),
    dbgUrl: document.getElementById("dbgUrl"),
    dbgCopy: document.getElementById("dbgCopy"),
  };

  const state = {
    filters: {
      q: "",
      type: "",
      county: "",
      city: "",
      min: "",
      max: "",
      ptype: "",
      beds: "",
      baths: "",
      sort: "relevance",
      page: "1",
      limit: "24",
    },
    debugOn: false,
    lastUrl: "",
    inflight: null,
    lastScrollY: 0,
  };

  const clampInt = (v, min, max) => {
    const n = parseInt(String(v || ""), 10);
    if (Number.isNaN(n)) return "";
    return String(Math.min(max, Math.max(min, n)));
  };

  const safeTrim = (v) => String(v || "").trim();

  const money = (n) => {
    const num = Number(n);
    if (!Number.isFinite(num)) return "";
    try {
      return new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(num);
    } catch {
      return `€${Math.round(num)}`;
    }
  };

  const debounce = (fn, ms) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  const qs = (obj) => {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
      const val = safeTrim(v);
      if (val !== "") p.set(k, val);
    });
    return p.toString();
  };

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function readUrlToState() {
    const u = new URL(window.location.href);
    const p = u.searchParams;

    state.filters.q = p.get("q") || "";
    state.filters.type = (p.get("type") || "").toLowerCase();
    state.filters.county = p.get("county") || "";
    state.filters.city = p.get("city") || "";
    state.filters.min = clampInt(p.get("min"), 0, 10000000);
    state.filters.max = clampInt(p.get("max"), 0, 10000000);
    state.filters.ptype = (p.get("ptype") || "").toLowerCase();
    state.filters.beds = clampInt(p.get("beds"), 0, 20);
    state.filters.baths = clampInt(p.get("baths"), 0, 20);
    state.filters.sort = p.get("sort") || "relevance";
    state.filters.page = clampInt(p.get("page") || "1", 1, 999) || "1";
    state.filters.limit = clampInt(p.get("limit") || "24", 6, 60) || "24";
  }

  function writeStateToUrl(replace = true) {
    const query = qs(state.filters);
    const next = `${window.location.pathname}${query ? "?" + query : ""}`;
    if (replace) window.history.replaceState(null, "", next);
    else window.history.pushState(null, "", next);
  }

  function applyStateToControls() {
    els.q.value = state.filters.q;
    els.type.value = state.filters.type;
    els.county.value = state.filters.county;
    els.city.value = state.filters.city;
    els.min.value = state.filters.min;
    els.max.value = state.filters.max;
    els.ptype.value = state.filters.ptype;
    els.sort.value = state.filters.sort;

    document.querySelectorAll(".chip[data-chip='beds'], .chip[data-chip='baths']").forEach((el) => el.setAttribute("data-on", "0"));
  }

  function controlsToState() {
    state.filters.q = safeTrim(els.q.value);
    state.filters.type = safeTrim(els.type.value);
    state.filters.county = safeTrim(els.county.value);
    state.filters.city = safeTrim(els.city.value);
    state.filters.min = clampInt(els.min.value, 0, 10000000);
    state.filters.max = clampInt(els.max.value, 0, 10000000);
    state.filters.ptype = safeTrim(els.ptype.value);
    state.filters.sort = safeTrim(els.sort.value) || "relevance";
    state.filters.page = "1";
  }

  function renderSkeletons(n = 9) {
    els.empty.style.display = "none";
    els.grid.innerHTML = "";
    const fr = document.createDocumentFragment();
    for (let i = 0; i < n; i++) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="thumb skeleton sk-img"></div>
        <div class="body">
          <div class="sk-line w80 skeleton"></div>
          <div class="sk-line w60 skeleton"></div>
        </div>
      `;
      fr.appendChild(card);
    }
    els.grid.appendChild(fr);
    els.count.textContent = "Loading…";
    els.pill.textContent = "Fetching…";
  }

  function showEmpty() {
    els.grid.innerHTML = "";
    els.empty.style.display = "block";
    els.count.textContent = "0 results";
    els.pill.textContent = "No matches";
  }

  function normalizeProperty(p) {
    const slug = p.slug || p.id || "";
    const ms = String(p.marketStatus || "").toLowerCase();
    const type =
      ms === "to-rent" ? "rent" :
      ms === "for-sale" ? "buy" :
      (String(p.type || p.listingType || "").toLowerCase() || "");

    const county = String(p.county || "").replace(/\s+/g, " ").trim();
    const city = String(p.city || "").trim();
    const title = p.title || "Property";

    const photos = Array.isArray(p.photos) ? p.photos : [];
    const heroImage = p.heroImage || p.coverImage || photos[0] || "";
    const createdAt = p.createdAt || p.updatedAt || p.publishedAt || "";

    return {
      slug,
      type,
      county,
      city,
      title,
      beds: p.bedrooms ?? "",
      baths: p.bathrooms ?? "",
      price: p.price ?? "",
      heroImage,
      createdAt,
      ptype: p.propertyType || "",
      raw: p,
    };
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cardHTML(pp) {
    const href = `property.html?slug=${encodeURIComponent(pp.slug)}`;
    const line2 = [pp.city, pp.county].filter(Boolean).join(", ");
    const bedBath = [
      pp.beds ? `${pp.beds} bed` : "",
      pp.baths ? `${pp.baths} bath` : ""
    ].filter(Boolean).join(" · ");

    return `
      <a class="card" href="${href}">
        <div class="thumb">
          ${pp.heroImage ? `<img loading="lazy" decoding="async" src="${escapeHtml(pp.heroImage)}" alt="">` : ""}
        </div>
        <div class="body">
          <p class="title">${escapeHtml(pp.title)}</p>
          <p class="addr">${escapeHtml(line2)}</p>
          <div class="row">
            <div class="price">${escapeHtml(money(pp.price))}</div>
            <div class="mini"><span>${escapeHtml(bedBath || "—")}</span></div>
          </div>
        </div>
      </a>
    `;
  }

  function buildApiUrl() {
    const f = state.filters;
    const apiParams = {};
    if (f.q) apiParams.q = f.q;
    if (f.type) apiParams.type = f.type;
    if (f.county) apiParams.county = f.county;
    if (f.city) apiParams.city = f.city;
    if (f.min) apiParams.min = f.min;
    if (f.max) apiParams.max = f.max;

    const query = qs(apiParams);
    const url = `${LIST_ENDPOINT}${query ? "?" + query : ""}`;

    state.lastUrl = url;
    if (els.dbgUrl) els.dbgUrl.textContent = url;
    return url;
  }

  async function fetchAndRender() {
    renderSkeletons(9);
    const url = buildApiUrl();

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
      const normalized = items.map(normalizeProperty);

      if (!normalized.length) {
        showEmpty();
        return;
      }

      els.empty.style.display = "none";
      els.grid.innerHTML = normalized.map(cardHTML).join("");
      els.count.textContent = `${normalized.length} results`;
      els.pill.textContent = "All listings";

    } catch (e) {
      console.warn("[HAVN] browse fetch error:", e);
      els.grid.innerHTML = "";
      els.empty.style.display = "block";
      els.count.textContent = "Couldn’t load results";
      els.pill.textContent = "API error";
    }
  }

  function bindControls() {
    els.apply?.addEventListener("click", () => {
      controlsToState();
      writeStateToUrl(true);
      fetchAndRender();
    });

    els.reset?.addEventListener("click", () => {
      state.filters = {
        q: "",
        type: "",
        county: "",
        city: "",
        min: "",
        max: "",
        ptype: "",
        beds: "",
        baths: "",
        sort: "relevance",
        page: "1",
        limit: "24",
      };
      writeStateToUrl(true);
      applyStateToControls();
      fetchAndRender();
    });

    const applyDebounced = debounce(() => {
      controlsToState();
      writeStateToUrl(true);
      fetchAndRender();
    }, 250);

    els.q?.addEventListener("input", applyDebounced);
    els.city?.addEventListener("input", applyDebounced);
    els.min?.addEventListener("input", applyDebounced);
    els.max?.addEventListener("input", applyDebounced);
  }

  function init() {
    readUrlToState();
    applyStateToControls();
    bindControls();
    writeStateToUrl(true);
    fetchAndRender();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
