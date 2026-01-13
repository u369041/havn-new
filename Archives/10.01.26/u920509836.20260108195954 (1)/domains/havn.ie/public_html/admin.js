/* admin.js — HAVN.ie Admin Dashboard
   - Fetch: GET /api/properties/_admin
   - Moderate: POST /api/admin/properties/:id/approve
               POST /api/admin/properties/:id/reject

   Requires /havn-auth.js loaded before this script, exposing HAVN_AUTH.
*/

(() => {
  const $ = (sel) => document.querySelector(sel);

  const STATE = {
    all: [],
    filtered: [],
    activeTab: "ALL", // ALL | SUBMITTED | PUBLISHED | OTHER
    q: "",
    loading: false,
  };

  const els = {
    sessionPill: $("#sessionPill"),
    createBtn: $("#createBtn"),
    logoutBtn: $("#logoutBtn"),
    refreshBtn: $("#refreshBtn"),
    searchInput: $("#searchInput"),

    tabAll: $("#tabAll"),
    tabSubmitted: $("#tabSubmitted"),
    tabPublished: $("#tabPublished"),
    tabOther: $("#tabOther"),

    countAll: $("#countAll"),
    countSubmitted: $("#countSubmitted"),
    countPublished: $("#countPublished"),
    countOther: $("#countOther"),

    resultsMeta: $("#resultsMeta"),
    grid: $("#listingGrid"),
    backendOk: $("#backendOk"),
  };

  function toast(msg, ms = 5000) {
    let t = $("#havnToast");
    if (!t) {
      t = document.createElement("div");
      t.id = "havnToast";
      t.style.position = "fixed";
      t.style.left = "16px";
      t.style.bottom = "16px";
      t.style.zIndex = "99999";
      t.style.maxWidth = "70vw";
      t.style.padding = "10px 12px";
      t.style.borderRadius = "12px";
      t.style.background = "rgba(15, 23, 42, 0.92)";
      t.style.color = "#fff";
      t.style.fontSize = "14px";
      t.style.boxShadow = "0 10px 30px rgba(0,0,0,.25)";
      t.style.display = "none";
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display = "block";
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => (t.style.display = "none"), ms);
  }

  function safeText(v) {
    if (v === null || v === undefined) return "";
    return String(v);
  }

  function euro(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "—";
    try {
      return num.toLocaleString("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
    } catch {
      return `€${Math.round(num).toLocaleString("en-IE")}`;
    }
  }

  function statusLabel(listingStatus) {
    const s = safeText(listingStatus).toUpperCase();
    if (!s) return "OTHER";
    if (["DRAFT", "SUBMITTED", "PUBLISHED", "REJECTED", "ARCHIVED"].includes(s)) return s;
    return "OTHER";
  }

  function chipClass(s) {
    const u = statusLabel(s);
    if (u === "SUBMITTED") return "submitted";
    if (u === "PUBLISHED") return "published";
    if (u === "REJECTED") return "rejected";
    if (u === "DRAFT") return "draft";
    return "other";
  }

  function normalizeRow(p) {
    const id = Number(p?.id);
    return {
      id: Number.isFinite(id) ? id : NaN,
      title: p?.title ?? p?.headline ?? "Untitled listing",
      price: p?.price ?? p?.askingPrice ?? null,
      city: p?.city ?? "",
      county: p?.county ?? "",
      eircode: p?.eircode ?? p?.postcode ?? "",
      listingStatus: p?.listingStatus ?? p?.status ?? "",
      slug: p?.slug ?? "",
      photos: Array.isArray(p?.photos) ? p.photos : Array.isArray(p?.images) ? p.images : [],
      address1: p?.address1 ?? p?.address ?? "",
      address2: p?.address2 ?? "",
      ownerEmail: p?.owner?.email ?? p?.user?.email ?? p?.createdBy?.email ?? "",
    };
  }

  function matchesQuery(row, qRaw) {
    const q = safeText(qRaw).trim().toLowerCase();
    if (!q) return true;

    const hay = [
      row.title,
      row.address1,
      row.address2,
      row.city,
      row.county,
      row.eircode,
      row.slug,
      row.listingStatus,
      row.ownerEmail,
      row.id,
    ]
      .map((x) => safeText(x).toLowerCase())
      .join(" • ");

    return hay.includes(q);
  }

  function filterByTab(row, tab) {
    const s = statusLabel(row.listingStatus);
    if (tab === "ALL") return true;
    if (tab === "SUBMITTED") return s === "SUBMITTED";
    if (tab === "PUBLISHED") return s === "PUBLISHED";
    if (tab === "OTHER") return s !== "SUBMITTED" && s !== "PUBLISHED";
    return true;
  }

  function tabName(tab) {
    if (tab === "ALL") return "All listings";
    if (tab === "SUBMITTED") return "Submitted";
    if (tab === "PUBLISHED") return "Published";
    if (tab === "OTHER") return "Other";
    return "All listings";
  }

  function applyFilters() {
    const q = STATE.q;
    const tab = STATE.activeTab;

    const filtered = STATE.all
      .map(normalizeRow)
      .filter((r) => Number.isFinite(r.id))
      .filter((r) => filterByTab(r, tab))
      .filter((r) => matchesQuery(r, q));

    STATE.filtered = filtered;
    renderCounts();
    renderGrid();
  }

  function renderCounts() {
    const all = STATE.all.map(normalizeRow).filter((r) => Number.isFinite(r.id));
    const submitted = all.filter((r) => statusLabel(r.listingStatus) === "SUBMITTED").length;
    const published = all.filter((r) => statusLabel(r.listingStatus) === "PUBLISHED").length;
    const other = all.length - submitted - published;

    if (els.countAll) els.countAll.textContent = String(all.length);
    if (els.countSubmitted) els.countSubmitted.textContent = String(submitted);
    if (els.countPublished) els.countPublished.textContent = String(published);
    if (els.countOther) els.countOther.textContent = String(other);

    if (els.resultsMeta) {
      els.resultsMeta.textContent = `Showing: ${tabName(STATE.activeTab)} · Results: ${STATE.filtered.length}`;
    }
  }

  function setActiveTab(tab) {
    STATE.activeTab = tab;
    const setOn = (el, on) => el && el.classList.toggle("active", !!on);
    setOn(els.tabAll, tab === "ALL");
    setOn(els.tabSubmitted, tab === "SUBMITTED");
    setOn(els.tabPublished, tab === "PUBLISHED");
    setOn(els.tabOther, tab === "OTHER");
    applyFilters();
  }

  function escapeHtml(s) {
    return safeText(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pickThumb(photos) {
    if (!Array.isArray(photos) || photos.length === 0) return "";
    return photos[0];
  }

  function openEdit(id) {
    window.location.href = `/property-upload.html?id=${encodeURIComponent(String(id))}`;
  }

  function renderGrid() {
    if (!els.grid) return;

    const rows = STATE.filtered.slice();
    if (rows.length === 0) {
      els.grid.innerHTML = `
        <div class="empty">
          <div style="font-weight:900;font-size:18px;color:#0f172a;">No listings</div>
          <div style="margin-top:6px;">Try changing the filter or search.</div>
        </div>
      `;
      return;
    }

    els.grid.innerHTML = rows
      .map((r) => {
        const s = statusLabel(r.listingStatus);
        const thumb = pickThumb(r.photos);
        const addrLine = [r.address1, r.address2].filter(Boolean).join(", ");
        const metaLine = [r.city, r.county, r.eircode].filter(Boolean).join(" • ");
        const canModerate = s === "SUBMITTED";
        const slugLine = r.slug ? `property.html?slug=${encodeURIComponent(r.slug)}` : "";

        return `
          <div class="card" data-id="${r.id}">
            <div class="media">
              ${
                thumb
                  ? `<img src="${escapeHtml(thumb)}" alt="" />`
                  : `<div class="noPhoto">No photo</div>`
              }
            </div>

            <div class="body">
              <div class="topRow">
                <div class="title">${escapeHtml(r.title || "Untitled listing")}</div>
                <div class="chip ${chipClass(s)}">${escapeHtml(s)}</div>
              </div>

              <div class="price">${escapeHtml(euro(r.price))}</div>

              <div class="metaLine">${escapeHtml(addrLine || "—")}</div>
              <div class="metaLine">${escapeHtml(metaLine || "—")}</div>
              <div class="metaLine">${escapeHtml(r.ownerEmail || "")}</div>

              ${
                slugLine
                  ? `<a class="metaLine" style="color:#2563eb;text-decoration:none;font-weight:800" href="/${escapeHtml(slugLine)}" target="_blank" rel="noopener">Open live page</a>`
                  : ``
              }

              <div class="actions">
                ${
                  canModerate
                    ? `
                      <button class="aBtn approve" data-action="approve">Approve</button>
                      <button class="aBtn reject" data-action="reject">Reject</button>
                    `
                    : ``
                }
                <button class="aBtn edit ${canModerate ? "" : "wide"}" data-action="edit">Edit</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    els.grid.querySelectorAll(".card .aBtn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const b = e.currentTarget;
        const card = b.closest(".card");
        const idRaw = card?.getAttribute("data-id");
        const id = Number(idRaw);

        if (!Number.isFinite(id)) {
          toast(`Invalid listing id: "${idRaw}"`);
          return;
        }

        const action = b.getAttribute("data-action");
        if (action === "approve") return adminApprove(id);
        if (action === "reject") return adminReject(id);
        if (action === "edit") return openEdit(id);
      });
    });
  }

  async function apiHealthPing() {
    try {
      const res = await fetch(`${HAVN_AUTH.baseApiUrl()}/api/health`, { method: "GET" });
      if (els.backendOk) {
        els.backendOk.textContent = res.ok ? "Backend: ok" : "Backend: error";
        els.backendOk.style.color = res.ok ? "#2563eb" : "#ef4444";
      }
    } catch {
      if (els.backendOk) {
        els.backendOk.textContent = "Backend: error";
        els.backendOk.style.color = "#ef4444";
      }
    }
  }

  async function loadListings() {
    if (STATE.loading) return;
    STATE.loading = true;

    try {
      const res = await HAVN_AUTH.apiFetch("/api/properties/_admin", { method: "GET" });
      if (!res.ok) {
        const txt = await res.text();
        toast(`Load failed: ${txt}`);
        STATE.all = [];
        applyFilters();
        return;
      }

      const data = await res.json();
      const items = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
      STATE.all = items;
      applyFilters();
    } catch (e) {
      toast(`Load failed: ${e?.message || e}`);
      STATE.all = [];
      applyFilters();
    } finally {
      STATE.loading = false;
    }
  }

  // ✅ Calls the NEW mounted backend routes
  async function adminApprove(propertyId) {
    const id = Number(propertyId);
    if (!Number.isFinite(id)) {
      toast(`Approve failed: invalid id "${propertyId}"`);
      return;
    }

    try {
      const res = await HAVN_AUTH.apiFetch(`/api/admin/properties/${id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const txt = await res.text();
        toast(`Approve failed: ${txt}`);
        return;
      }

      toast("Approved ✅");
      await loadListings();
    } catch (e) {
      toast(`Approve failed: ${e?.message || e}`);
    }
  }

  async function adminReject(propertyId) {
    const id = Number(propertyId);
    if (!Number.isFinite(id)) {
      toast(`Reject failed: invalid id "${propertyId}"`);
      return;
    }

    const reason = prompt("Reject reason (required):");
    if (!reason || !reason.trim()) {
      toast("Reject cancelled (reason required).");
      return;
    }

    try {
      const res = await HAVN_AUTH.apiFetch(`/api/admin/properties/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });

      if (!res.ok) {
        const txt = await res.text();
        toast(`Reject failed: ${txt}`);
        return;
      }

      toast("Rejected ✅");
      await loadListings();
    } catch (e) {
      toast(`Reject failed: ${e?.message || e}`);
    }
  }

  function renderSession() {
    if (!els.sessionPill) return;

    const token = localStorage.getItem("token");
    if (!token) {
      els.sessionPill.textContent = "Session: none";
      els.sessionPill.classList.remove("ok");
      return;
    }

    let label = "Session: admin";
    try {
      if (typeof HAVN_AUTH.getSessionLabel === "function") {
        label = HAVN_AUTH.getSessionLabel();
      }
    } catch {}
    els.sessionPill.textContent = label;
    els.sessionPill.classList.add("ok");
  }

  function wireUI() {
    if (els.searchInput) {
      els.searchInput.addEventListener("input", (e) => {
        STATE.q = e.target.value || "";
        applyFilters();
      });
    }
    if (els.refreshBtn) els.refreshBtn.addEventListener("click", () => loadListings());
    if (els.createBtn) els.createBtn.addEventListener("click", () => (window.location.href = "/property-upload.html"));
    if (els.logoutBtn) {
      els.logoutBtn.addEventListener("click", () => {
        try {
          HAVN_AUTH.logout();
        } catch {
          localStorage.removeItem("token");
          window.location.href = "/login.html";
        }
      });
    }

    if (els.tabAll) els.tabAll.addEventListener("click", () => setActiveTab("ALL"));
    if (els.tabSubmitted) els.tabSubmitted.addEventListener("click", () => setActiveTab("SUBMITTED"));
    if (els.tabPublished) els.tabPublished.addEventListener("click", () => setActiveTab("PUBLISHED"));
    if (els.tabOther) els.tabOther.addEventListener("click", () => setActiveTab("OTHER"));
  }

  async function boot() {
    if (!window.HAVN_AUTH) {
      alert("Missing /havn-auth.js — admin requires HAVN_AUTH. Ensure <script src='/havn-auth.js'></script> is loaded before admin.js");
      return;
    }

    try {
      HAVN_AUTH.requireAuth({ redirectTo: "/login.html?next=/admin.html" });
    } catch {
      if (!localStorage.getItem("token")) window.location.href = "/login.html?next=/admin.html";
    }

    renderSession();
    wireUI();
    await apiHealthPing();
    await loadListings();
    setActiveTab("ALL");
  }

  boot();
})();
