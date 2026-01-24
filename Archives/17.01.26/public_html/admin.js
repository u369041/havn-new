/* global HAVN_AUTH */
(() => {
  const API_BASE = "https://api.havn.ie";

  const els = {
    filters: document.getElementById("filters"),
    q: document.getElementById("q"),
    grid: document.getElementById("grid"),
    meta: document.getElementById("metaRow"),
    toast: document.getElementById("toast")
  };

  const FILTERS = [
    { key: "ALL", label: "All" },
    { key: "PENDING", label: "Pending" },
    { key: "PUBLISHED", label: "Published" },
    { key: "REJECTED", label: "Rejected" },
    { key: "DRAFT", label: "Draft" },
    { key: "ARCHIVED", label: "Closed" } // ✅ NEW
  ];

  let state = {
    filter: "ALL",
    q: "",
    items: [],
    loading: false
  };

  function toast(msg, ms = 2200) {
    if (!els.toast) return;
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => els.toast.classList.remove("show"), ms);
  }

  function safeText(v) {
    return (v ?? "").toString();
  }

  function normalizeStatusRaw(v) {
    return safeText(v).trim().toUpperCase();
  }

  // ✅ SINGLE SOURCE OF TRUTH: determine a listing's status from ANY likely field
  function getStatus(p) {
    // Common candidates across versions
    const candidates = [
      p.status,
      p.moderationStatus,
      p.listingStatus,
      p.publishStatus,
      p.state,
      p.workflowState,
      p.reviewStatus,
      p.marketStatus // ✅ sometimes used as "CLOSED"/etc in some builds
    ];

    for (const c of candidates) {
      const s = normalizeStatusRaw(c);
      if (s) return canonicalizeStatus(s);
    }

    // Some APIs use booleans instead of strings
    if (p.isPublished === true) return "PUBLISHED";
    if (p.isDraft === true) return "DRAFT";

    // Some APIs use timestamps / flags
    if (p.archivedAt) return "ARCHIVED"; // ✅ NEW
    if (p.publishedAt) return "PUBLISHED";
    if (p.submittedAt) return "PENDING";

    return "UNKNOWN";
  }

  // Map variants → canonical status keys your UI understands
  function canonicalizeStatus(s) {
    // Treat “SUBMITTED / IN_REVIEW” as PENDING
    if (s === "SUBMITTED" || s === "IN_REVIEW" || s === "REVIEW" || s === "PENDING_REVIEW") return "PENDING";

    // Treat “LIVE” as published
    if (s === "LIVE" || s === "PUBLIC" || s === "APPROVED") return "PUBLISHED";

    // Treat “DENIED” as rejected
    if (s === "DENIED" || s === "DECLINED") return "REJECTED";

    // ✅ Treat closed/archived variants as ARCHIVED
    if (s === "ARCHIVED" || s === "CLOSED" || s === "CLOSE" || s === "SOLD" || s === "RENTED") return "ARCHIVED";

    // Pass through expected values
    if (s === "PUBLISHED" || s === "PENDING" || s === "REJECTED" || s === "DRAFT" || s === "ARCHIVED") return s;

    return s || "UNKNOWN";
  }

  function statusDot(status) {
    const s = canonicalizeStatus(normalizeStatusRaw(status));
    if (s === "PUBLISHED") return "good";
    if (s === "PENDING") return "warn";
    if (s === "REJECTED") return "bad";
    if (s === "DRAFT") return "muted";
    if (s === "ARCHIVED") return "muted"; // ✅ NEW
    return "";
  }

  function fmtDate(d) {
    if (!d) return "";
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return safeText(d);
    return dt.toLocaleString();
  }

  function created(p) {
    return p.createdAt || p.created_at || "";
  }
  function updated(p) {
    return p.updatedAt || p.updated_at || "";
  }

  // ---- Robust image extraction ----
  function firstUrlFromAny(v) {
    if (!v) return "";

    if (typeof v === "string") {
      const s = v.trim();

      if ((s.startsWith("[") && s.endsWith("]")) || (s.startsWith("{") && s.endsWith("}"))) {
        try { return firstUrlFromAny(JSON.parse(s)); } catch { /* ignore */ }
      }
      return s;
    }

    if (Array.isArray(v)) {
      for (const it of v) {
        const got = firstUrlFromAny(it);
        if (got) return got;
      }
      return "";
    }

    if (typeof v === "object") {
      return (
        v.url ||
        v.secure_url ||
        v.src ||
        v.href ||
        v.imageUrl ||
        v.coverImageUrl ||
        v.heroImageUrl ||
        v.primaryImageUrl ||
        v.publicUrl ||
        v.path ||
        ""
      );
    }

    return "";
  }

  function getHeroUrl(p) {
    return (
      firstUrlFromAny(p.coverImageUrl) ||
      firstUrlFromAny(p.heroImageUrl) ||
      firstUrlFromAny(p.primaryImageUrl) ||
      firstUrlFromAny(p.coverImage) ||
      firstUrlFromAny(p.cover) ||
      firstUrlFromAny(p.hero) ||
      firstUrlFromAny(p.images) ||
      firstUrlFromAny(p.photos) ||
      firstUrlFromAny(p.photoUrls) ||
      firstUrlFromAny(p.gallery) ||
      firstUrlFromAny(p.media) ||
      firstUrlFromAny(p.mediaItems) ||
      firstUrlFromAny(p.propertyImages) ||
      firstUrlFromAny(p.assets) ||
      firstUrlFromAny(p.data && p.data.images) ||
      firstUrlFromAny(p.data && p.data.photos) ||
      ""
    );
  }

  function getListingTypeChips(p) {
    const saleType =
      p.saleType ||
      p.listingType ||
      p.transactionType ||
      p.rentOrSale ||
      "";

    const propertyType =
      p.propertyType || p.type || p.homeType || p.category || "";

    const chips = [];
    if (safeText(saleType).trim()) chips.push(safeText(saleType).trim());
    if (safeText(propertyType).trim()) chips.push(safeText(propertyType).trim());
    return chips;
  }

  function getTitle(p) {
    return p.title || p.headline || p.addressLine1 || p.address || p.slug || "Untitled listing";
  }

  function getAddress(p) {
    return p.address || p.addressLine1 || p.locationText || "";
  }

  function getEircode(p) {
    return p.eircode || "";
  }

  async function apiFetch(path, opts = {}) {
    if (window.HAVN_AUTH && typeof HAVN_AUTH.apiFetch === "function") {
      return HAVN_AUTH.apiFetch(`${API_BASE}${path}`, opts);
    }

    const token = localStorage.getItem("token");
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      opts.headers || {},
      token ? { Authorization: `Bearer ${token}` } : {}
    );
    return fetch(`${API_BASE}${path}`, Object.assign({}, opts, { headers }));
  }

  async function readJsonSafe(res) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw: text }; }
  }

  async function moderate(idOrSlug, action, payload = {}) {
    const tries = [
      { path: `/api/properties/${idOrSlug}/${action}`, method: "POST" },
      { path: `/api/properties/${idOrSlug}/_moderate`, method: "POST", body: { action, ...payload } },
      { path: `/api/admin/properties/${idOrSlug}/${action}`, method: "POST" },
      { path: `/api/admin/properties/${idOrSlug}`, method: "PATCH", body: { action, ...payload } }
    ];

    let lastErr = null;
    for (const t of tries) {
      try {
        const res = await apiFetch(t.path, {
          method: t.method,
          body: JSON.stringify(t.body || payload || {})
        });
        if (res.ok) return { ok: true, res, used: t.path };
        const data = await readJsonSafe(res);
        lastErr = { used: t.path, status: res.status, data };
      } catch (e) {
        lastErr = { used: t.path, error: String(e) };
      }
    }
    return { ok: false, lastErr };
  }

  // ✅ NEW: close listing (published -> archived) + email customer
  async function closeListing(p) {
    const status = getStatus(p);
    if (status !== "PUBLISHED") {
      toast("Only Published listings can be closed");
      return;
    }

    const id = p.id || p.propertyId || null;
    if (!id) {
      toast("Close failed — missing listing id");
      console.warn("Close failed: missing id", p);
      return;
    }

    if (!confirm(`Close listing?\n\nThis archives it and emails the customer.\n\n${p.slug || id}`)) return;

    const outcomeRaw = prompt('Close outcome? Type SOLD or RENTED (leave blank = auto):', "");
    if (outcomeRaw === null) return;

    const outcome = (outcomeRaw || "").trim().toUpperCase();
    const body = (outcome === "SOLD" || outcome === "RENTED") ? { outcome } : {};

    const res = await apiFetch(`/api/admin/properties/${encodeURIComponent(id)}/close`, {
      method: "POST",
      body: JSON.stringify(body)
    });

    if (res.ok) {
      toast("Closed ✅ (email sent)");
      await load();
      return;
    }

    const data = await readJsonSafe(res);
    console.warn("Close failed:", { status: res.status, data });
    toast("Close failed — check console");
  }

  function renderFilters() {
    if (!els.filters) return;
    els.filters.innerHTML = "";
    for (const f of FILTERS) {
      const b = document.createElement("button");
      b.className = "pill" + (state.filter === f.key ? " active" : "");
      b.textContent = f.label;
      b.addEventListener("click", () => {
        state.filter = f.key;
        renderFilters();
        render();
      });
      els.filters.appendChild(b);
    }
  }

  function passesFilter(p) {
    if (state.filter === "ALL") return true;
    return getStatus(p) === state.filter;
  }

  function passesSearch(p) {
    const q = state.q.trim().toLowerCase();
    if (!q) return true;
    const hay = [p.slug, p.title, p.headline, p.address, p.addressLine1, p.eircode, p.locationText]
      .map(x => safeText(x).toLowerCase())
      .join(" • ");
    return hay.includes(q);
  }

  function computeButtonState(p) {
    const s = getStatus(p);
    const canApprove = (s === "PENDING" || s === "REJECTED" || s === "DRAFT");
    const canReject  = (s === "PENDING" || s === "PUBLISHED");
    const canClose   = (s === "PUBLISHED"); // ✅ NEW
    return { canApprove, canReject, canClose };
  }

  // ✅ FIXED earlier view logic should be status-aware:
  // PUBLISHED => public property.html
  // otherwise => admin preview page
  function linkForView(p) {
    const status = getStatus(p);
    const slug = safeText(p.slug);

    if (status === "PUBLISHED") {
      if (slug) return `/property.html?slug=${encodeURIComponent(slug)}`;
      if (p.id) return `/property.html?id=${encodeURIComponent(p.id)}`;
      return `/property.html`;
    }

    // Non-published: admin preview
    return linkForAdminDetail(p);
  }

  function linkForEdit(p) {
    if (p.id) return `/property-upload.html?edit=${encodeURIComponent(p.id)}`;
    return `/property-upload.html`;
  }

  function linkForAdminDetail(p) {
    if (p.id) return `/property-admin.html?id=${encodeURIComponent(p.id)}`;
    if (p.slug) return `/property-admin.html?slug=${encodeURIComponent(p.slug)}`;
    return `/property-admin.html`;
  }

  function card(p) {
    const img = getHeroUrl(p);
    const title = getTitle(p);
    const addr = getAddress(p);
    const eir = getEircode(p);

    const status = getStatus(p);
    const dot = statusDot(status);
    const { canApprove, canReject, canClose } = computeButtonState(p);

    const typeChips = getListingTypeChips(p);
    const typeChipsHtml = typeChips.map(t => `<span class="chip">${safeText(t)}</span>`).join("");

    const el = document.createElement("div");
    el.className = "card";

    const imgHtml = img
      ? `<img class="thumb" src="${img}" alt="" onerror="this.onerror=null; this.remove();">`
      : `<div class="thumb" aria-hidden="true"></div>`;

    el.innerHTML = `
      ${imgHtml}
      <div class="cardBody">
        <div style="min-width:0">
          <p class="title" title="${safeText(title)}">${safeText(title)}</p>
          <div class="addr" title="${safeText(addr)}">${safeText(addr)}</div>
          ${eir ? `<div class="addr" style="opacity:.8">${safeText(eir)}</div>` : ""}
        </div>

        <div class="row">
          <span class="chip"><span class="dot ${dot}"></span>${status}</span>
          ${typeChipsHtml}
          ${p.slug ? `<span class="chip"><span class="slug">${safeText(p.slug)}</span></span>` : ""}
        </div>

        <div class="row" style="color:var(--muted);font-size:11px">
          ${created(p) ? `<span>Created: ${fmtDate(created(p))}</span>` : ""}
          ${updated(p) ? `<span>Updated: ${fmtDate(updated(p))}</span>` : ""}
        </div>

        <div class="btnRow">
          <button class="btn primary" data-act="detail">Moderate</button>
          <button class="btn" data-act="view">View</button>
          <button class="btn" data-act="edit">Edit</button>
          <button class="btn good" data-act="approve" ${canApprove ? "" : "disabled"}>Approve</button>
          <button class="btn bad" data-act="reject" ${canReject ? "" : "disabled"}>Reject</button>
          <button class="btn warn" data-act="close" ${canClose ? "" : "disabled"}>Close Listing</button>
        </div>
      </div>
    `;

    el.querySelector('[data-act="detail"]').addEventListener("click", () => location.href = linkForAdminDetail(p));
    el.querySelector('[data-act="view"]').addEventListener("click", () => window.open(linkForView(p), "_blank"));
    el.querySelector('[data-act="edit"]').addEventListener("click", () => window.open(linkForEdit(p), "_blank"));

    el.querySelector('[data-act="approve"]').addEventListener("click", async () => {
      if (!confirm(`Approve listing?\n\n${p.slug || p.id || ""}\n\nStatus currently: ${status}`)) return;
      const key = p.id || p.slug;
      const r = await moderate(key, "approve");
      if (r.ok) { toast(`Approved ✅ (${r.used})`); await load(); }
      else { console.warn("Approve failed:", r.lastErr); toast("Approve failed — check console"); }
    });

    el.querySelector('[data-act="reject"]').addEventListener("click", async () => {
      const reason = prompt("Reject reason (optional):", "");
      const key = p.id || p.slug;
      const r = await moderate(key, "reject", reason ? { reason } : {});
      if (r.ok) { toast(`Rejected ✅ (${r.used})`); await load(); }
      else { console.warn("Reject failed:", r.lastErr); toast("Reject failed — check console"); }
    });

    el.querySelector('[data-act="close"]').addEventListener("click", async () => {
      await closeListing(p);
    });

    return el;
  }

  function render() {
    const filtered = state.items.filter(passesFilter).filter(passesSearch);
    if (els.meta) els.meta.textContent = `${filtered.length} shown • ${state.items.length} total • filter: ${state.filter}`;

    if (!els.grid) return;
    els.grid.innerHTML = "";
    for (const p of filtered) els.grid.appendChild(card(p));

    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.style.color = "#64748b";
      empty.style.fontSize = "13px";
      empty.textContent = state.loading ? "Loading…" : "No listings match this filter/search.";
      els.grid.appendChild(empty);
    }
  }

  async function load() {
    state.loading = true;
    render();

    const tries = ["/api/properties/_admin", "/api/admin/properties", "/api/properties?scope=admin"];
    let last = null;

    for (const path of tries) {
      const res = await apiFetch(path);

      if (res.ok) {
        const data = await res.json();
        const items = (Array.isArray(data) && data) || data.items || data.properties || data.results || [];

        state.items = items;
        state.loading = false;

        window.__LAST_ADMIN_PAYLOAD__ = data;
        window.__LAST_ADMIN_ITEM__ = items && items[0] ? items[0] : null;

        console.info("Admin list loaded via:", path);
        console.info("ADMIN SAMPLE ITEM:", window.__LAST_ADMIN_ITEM__);
        if (window.__LAST_ADMIN_ITEM__) {
          const p = window.__LAST_ADMIN_ITEM__;
          console.info("ADMIN STATUS CANDIDATES:", {
            status: p.status,
            moderationStatus: p.moderationStatus,
            listingStatus: p.listingStatus,
            publishStatus: p.publishStatus,
            state: p.state,
            workflowState: p.workflowState,
            reviewStatus: p.reviewStatus,
            marketStatus: p.marketStatus,
            isPublished: p.isPublished,
            isDraft: p.isDraft,
            submittedAt: p.submittedAt,
            publishedAt: p.publishedAt,
            archivedAt: p.archivedAt,
            derived: getStatus(p)
          });
        }

        render();
        return;
      } else {
        last = { path, status: res.status, body: await readJsonSafe(res) };
      }
    }

    state.loading = false;
    render();
    console.error("Admin list failed:", last);
    toast("Admin list failed — check console");
  }

  function wire() {
    renderFilters();
    if (els.q) {
      els.q.addEventListener("input", () => {
        state.q = els.q.value || "";
        render();
      });
    }
  }

  async function boot() {
    if (window.HAVN_AUTH && typeof HAVN_AUTH.requireAuth === "function") {
      HAVN_AUTH.requireAuth({ next: "/admin.html" });
    } else {
      const t = localStorage.getItem("token");
      if (!t) location.href = "/login.html?next=" + encodeURIComponent("/admin.html");
    }

    wire();
    await load();
  }

  boot();
})();
