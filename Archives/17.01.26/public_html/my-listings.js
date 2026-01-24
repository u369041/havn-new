/* my-listings.js — FIXED (reads { items: [...] } from /api/properties/mine) */

(async function () {
  if (!window.HAVN_AUTH) {
    console.error("HAVN_AUTH missing - include /havn-auth.js before my-listings.js");
    return;
  }

  if (!HAVN_AUTH.requireAuth({ next: "/my-listings.html" })) return;

  const $ = (sel) => document.querySelector(sel);

  const els = {
    msg: $("#statusMsg"),
    filter: $("#filterInput"),
    refreshBtn: $("#refreshBtn"),
    countTotal: $("#countTotal"),
    countDrafts: $("#countDrafts"),
    countSubmitted: $("#countSubmitted"),
    countPublished: $("#countPublished"),
    list: $("#results"),
  };

  function setMsg(type, text) {
    if (!els.msg) return;
    els.msg.style.display = text ? "block" : "none";
    els.msg.className = type ? `status ${type}` : "status";
    els.msg.textContent = text || "";
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function normalizeItems(json) {
    if (!json) return [];
    if (Array.isArray(json.items)) return json.items;
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.listings)) return json.listings;
    if (Array.isArray(json.properties)) return json.properties;
    return [];
  }

  function computeCounts(items) {
    const total = items.length;

    const drafts = items.filter((p) => p.listingStatus === "DRAFT").length;
    const submitted = items.filter((p) => p.listingStatus === "SUBMITTED").length;
    const published = items.filter((p) => p.listingStatus === "PUBLISHED").length;

    return { total, drafts, submitted, published };
  }

  function renderCounts(items) {
    const c = computeCounts(items);
    if (els.countTotal) els.countTotal.textContent = c.total;
    if (els.countDrafts) els.countDrafts.textContent = c.drafts;
    if (els.countSubmitted) els.countSubmitted.textContent = c.submitted;
    if (els.countPublished) els.countPublished.textContent = c.published;
  }

  function renderList(items) {
    if (!els.list) return;

    if (!items.length) {
      els.list.innerHTML = `<div class="empty">No listings found for this account yet.</div>`;
      return;
    }

    els.list.innerHTML = items
      .map((p) => {
        const title = escapeHtml(p.title || "(Untitled)");
        const slug = escapeHtml(p.slug || "");
        const status = escapeHtml(p.listingStatus || "");
        const city = escapeHtml(p.city || "");
        const county = escapeHtml(p.county || "");
        const price = Number(p.price || 0).toLocaleString();

        const link = slug ? `/property.html?slug=${encodeURIComponent(p.slug)}` : "#";

        const editUrl = `/property-upload.html?edit=${encodeURIComponent(p.id)}`;

        return `
          <div class="listing-row">
            <div class="listing-row__main">
              <div class="listing-row__title">
                <a href="${link}" target="_blank" rel="noopener">${title}</a>
              </div>
              <div class="listing-row__meta">
                <span class="chip">${status}</span>
                ${price ? `<span class="muted">€${price}</span>` : ""}
                ${city || county ? `<span class="muted">${city}${city && county ? ", " : ""}${county}</span>` : ""}
                ${slug ? `<span class="muted mono">${slug}</span>` : ""}
              </div>
            </div>

            <div class="listing-row__actions">
              <a class="btn" href="${editUrl}">Edit</a>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function applyFilter(allItems, q) {
    q = (q || "").trim().toLowerCase();
    if (!q) return allItems;

    return allItems.filter((p) => {
      const hay = [
        p.title,
        p.slug,
        p.city,
        p.county,
        p.listingStatus,
        p.marketStatus,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return hay.includes(q);
    });
  }

  let allItems = [];

  async function load() {
    setMsg("", "");

    try {
      const res = await HAVN_AUTH.apiFetch("/api/properties/mine");

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`My listings fetch failed (${res.status}): ${text}`);
      }

      const json = await res.json();
      allItems = normalizeItems(json);

      const q = els.filter ? els.filter.value : "";
      const filtered = applyFilter(allItems, q);

      renderCounts(allItems);
      renderList(filtered);
    } catch (err) {
      console.error(err);
      setMsg("error", err.message || "Failed to load your listings.");
      renderCounts([]);
      renderList([]);
    }
  }

  if (els.refreshBtn) els.refreshBtn.addEventListener("click", load);
  if (els.filter)
    els.filter.addEventListener("input", () => {
      const filtered = applyFilter(allItems, els.filter.value);
      renderList(filtered);
    });

  load();
})();
