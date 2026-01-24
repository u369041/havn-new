/* latest-properties.js — HAVN homepage latest listings (INDEX v6)
   - Targets #grid (index.html)
   - Uses index.html premium card classes
   - Public endpoints only
   - Filters PUBLISHED only
   - Writes empty state into #emptyState
*/

(function () {
  const API = "https://api.havn.ie";

  const ENDPOINTS = [
    "/api/properties/published",
    "/api/properties?status=PUBLISHED",
    "/api/properties/public",
    "/api/properties",
  ];

  function $(id) { return document.getElementById(id); }

  function parseList(json) {
    if (!json) return [];
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.properties)) return json.properties;
    if (json.ok && Array.isArray(json.properties)) return json.properties;
    if (json.data && Array.isArray(json.data.properties)) return json.data.properties;
    return [];
  }

  function isPublished(p) {
    const st = String(p.listingStatus || p.status || "").toUpperCase();
    return st === "PUBLISHED";
  }

  function asPrice(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return "";
    try { return "€" + num.toLocaleString("en-IE"); } catch (e) { return "€" + String(num); }
  }

  function safeText(v) { return String(v == null ? "" : v); }

  function bestPhoto(p) {
    const photos = p.photos || p.images || [];
    if (Array.isArray(photos) && photos.length) return String(photos[0] || "");
    if (typeof p.coverPhoto === "string") return p.coverPhoto;
    if (typeof p.photo === "string") return p.photo;
    return "";
  }

  function escapeHtml(input) {
    return String(input || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function chip(label, cls) {
    return `<span class="chip${cls ? " " + cls : ""}">${escapeHtml(label)}</span>`;
  }

  function cardHTML(p) {
    const slug = safeText(p.slug || "");
    const href = "property.html?slug=" + encodeURIComponent(slug);

    const title = safeText(p.title || "Property");
    const address1 = safeText(p.address1 || "");
    const city = safeText(p.city || "");
    const county = safeText(p.county || "");
    const eircode = safeText(p.eircode || "");

    const price = asPrice(p.price);
    const photo = bestPhoto(p);

    const beds = (p.bedrooms != null && p.bedrooms !== "") ? `${p.bedrooms} bed` : "";
    const baths = (p.bathrooms != null && p.bathrooms !== "") ? `${p.bathrooms} bath` : "";
    const type = safeText(p.propertyType || "");
    const saleType = safeText(p.saleType || "");

    const locLine = [address1, city, county].filter(Boolean).join(", ");

    const chips = [];
    if (beds) chips.push(chip(beds));
    if (baths) chips.push(chip(baths));
    if (type) chips.push(chip(type, "type"));
    if (saleType) chips.push(chip(saleType));

    return `
      <a class="card" href="${href}">
        <div class="thumb">
          ${photo ? `<img src="${escapeHtml(photo)}" alt="">` : ``}
          <div class="corner">
            <span class="tagChip">Premium</span>
            ${p.marketStatus ? `<span class="tagChip light">${escapeHtml(String(p.marketStatus))}</span>` : ``}
          </div>
        </div>
        <div class="body">
          <div class="price">${escapeHtml(price || "")}</div>
          <div class="titleRow">
            <div class="title">${escapeHtml(title)}</div>
            ${eircode ? `<div class="eircode">${escapeHtml(eircode)}</div>` : ``}
          </div>
          <div class="loc"><span class="pin" aria-hidden="true"></span>${escapeHtml(locLine || county || "Ireland")}</div>
          <div class="meta">${chips.join("")}</div>
        </div>
      </a>
    `;
  }

  async function fetchJson(path) {
    const res = await fetch(API + path, { method: "GET" });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { ok: res.ok, status: res.status, json, text, path };
  }

  function setEmpty(msg) {
    const empty = $("emptyState");
    if (!empty) return;
    empty.style.display = "block";
    empty.innerHTML = msg;
  }

  function clearEmpty() {
    const empty = $("emptyState");
    if (!empty) return;
    empty.style.display = "none";
    empty.textContent = "";
  }

  async function loadLatest() {
    const grid = $("grid");
    if (!grid) return;

    grid.innerHTML = "";
    clearEmpty();

    let last = null;

    for (const ep of ENDPOINTS) {
      try {
        const r = await fetchJson(ep);

        if (!r.ok) {
          last = `HTTP ${r.status} from ${ep}`;
          continue;
        }

        const items = parseList(r.json);
        const published = items.filter(isPublished);

        // Sort newest first (publishedAt then createdAt)
        published.sort((a, b) => {
          const ad = Date.parse(a.publishedAt || a.createdAt || "") || 0;
          const bd = Date.parse(b.publishedAt || b.createdAt || "") || 0;
          return bd - ad;
        });

        if (!published.length) {
          // If endpoint returns items but none are labeled, try next endpoint
          const hasStatus = items.some(x => x.listingStatus || x.status);
          if (!hasStatus && items.length) {
            // Very defensive: render first 6 if status is missing entirely
            grid.innerHTML = items.slice(0, 6).map(cardHTML).join("");
            return;
          }
          last = `No published listings from ${ep}`;
          continue;
        }

        grid.innerHTML = published.slice(0, 6).map(cardHTML).join("");
        return;

      } catch (e) {
        last = (e && e.message) ? e.message : String(e);
      }
    }

    setEmpty(
      `No listings are showing right now.<br><span style="font-size:12px;opacity:.85">(${escapeHtml(last || "unknown error")})</span>`
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadLatest);
  } else {
    loadLatest();
  }
})();
