/* latest-properties.js — WORLD CLASS HOME CARDS (supports {ok:true, items:[...]} OR array) */

(async function () {
  const grid = document.getElementById("latestGrid");
  const statusEl = document.getElementById("latestStatus");
  if (!grid || !statusEl) return;

  // ---------- helpers ----------
  const API_URL = "https://api.havn.ie/api/properties";

  function setStatus(msg) {
    statusEl.textContent = msg || "";
    statusEl.style.display = msg ? "block" : "none";
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatPrice(n) {
    const val = Number(n || 0);
    if (!val) return "";
    return "€" + val.toLocaleString();
  }

  function normalizeItems(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.properties)) return json.properties;
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.listings)) return json.listings;
    return [];
  }

  function isPublished(p) {
    return p && (p.listingStatus === "PUBLISHED" || !!p.publishedAt);
  }

  function pickCover(p) {
    const photos = Array.isArray(p.photos) ? p.photos : [];
    return photos.length ? photos[0] : "";
  }

  function buildCard(p) {
    const title = escapeHtml(p.title || "Untitled listing");
    const slug = p.slug || "";
    const href = slug ? `/property.html?slug=${encodeURIComponent(slug)}` : "#";
    const cover = pickCover(p);

    const city = escapeHtml(p.city || "");
    const county = escapeHtml(p.county || "");
    const eircode = escapeHtml(p.eircode || "");
    const location = [city, county].filter(Boolean).join(", ");
    const price = formatPrice(p.price);

    const chips = [];
    if (p.bedrooms) chips.push(`${p.bedrooms} bed`);
    if (p.bathrooms) chips.push(`${p.bathrooms} bath`);
    if (p.propertyType) chips.push(String(p.propertyType).toUpperCase());

    return `
      <a class="home-card" href="${href}">
        <div class="home-thumb">
          ${
            cover
              ? `<img src="${cover}" alt="${title}" loading="lazy">`
              : `<div class="empty">No photo</div>`
          }
        </div>
        <div class="home-body">
          <p class="home-title">${title}</p>

          <div class="home-meta">
            <span title="${escapeHtml(location)}">${escapeHtml(location)}</span>
            <span>${eircode ? escapeHtml(eircode) : ""}</span>
          </div>

          <div class="home-price">${price || ""}</div>

          ${
            chips.length
              ? `<div class="home-chips">${chips
                  .slice(0, 3)
                  .map(c => `<span class="home-chip">${escapeHtml(c)}</span>`)
                  .join("")}</div>`
              : `<div style="height:10px"></div>`
          }
        </div>
      </a>
    `;
  }

  // ---------- load ----------
  try {
    setStatus("Loading latest listings...");

    // Try auth fetch first (same domain safety)
    let res;
    if (window.HAVN_AUTH && typeof window.HAVN_AUTH.apiFetch === "function") {
      res = await window.HAVN_AUTH.apiFetch("/api/properties");
    } else {
      res = await fetch(API_URL, { credentials: "include" });
    }

    if (!res.ok) {
      const text = await res.text();
      console.error("Homepage listings error:", res.status, text);
      setStatus(`Failed to load listings (${res.status}).`);
      grid.innerHTML = "";
      return;
    }

    const json = await res.json();
    let items = normalizeItems(json);

    // Only published on homepage
    items = items.filter(isPublished);

    // newest first
    items.sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });

    // top 6
    items = items.slice(0, 6);

    if (!items.length) {
      setStatus("No published listings yet.");
      grid.innerHTML = "";
      return;
    }

    grid.innerHTML = items.map(buildCard).join("");
    setStatus("");

  } catch (err) {
    console.error("Homepage listings fatal error:", err);
    setStatus("Failed to load latest listings.");
    grid.innerHTML = "";
  }
})();
