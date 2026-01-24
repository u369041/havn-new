/* global HAVN_AUTH */
(() => {
  const API_BASE = "https://api.havn.ie";

  const $ = (id) => document.getElementById(id);

  const els = {
    backBtn: $("backBtn"),
    viewBtn: $("viewBtn"),
    approveBtn: $("approveBtn"),
    rejectBtn: $("rejectBtn"),
    hero: $("hero"),
    title: $("title"),
    addr: $("addr"),
    status: $("status"),
    dot: $("dot"),
    slugChip: $("slugChip"),
    kv: $("kv"),
    toast: $("toast")
  };

  function toast(msg, ms = 2200){
    els.toast.textContent = msg;
    els.toast.classList.add("show");
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => els.toast.classList.remove("show"), ms);
  }

  function qp(name){
    return new URLSearchParams(location.search).get(name);
  }

  async function apiFetch(path, opts = {}){
    if (window.HAVN_AUTH && typeof HAVN_AUTH.apiFetch === "function") {
      return HAVN_AUTH.apiFetch(`${API_BASE}${path}`, opts);
    }
    const token = localStorage.getItem("token");
    const headers = Object.assign(
      { "Content-Type":"application/json" },
      opts.headers || {},
      token ? { Authorization:`Bearer ${token}` } : {}
    );
    return fetch(`${API_BASE}${path}`, Object.assign({}, opts, { headers }));
  }

  async function readJsonSafe(res){
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { raw:text }; }
  }

  function statusDot(status){
    const s = (status || "").toUpperCase();
    els.dot.className = "dot" + (s === "PUBLISHED" ? " good" : s === "PENDING" ? " warn" : s === "REJECTED" ? " bad" : "");
  }

  function getHeroUrl(p){
    return (
      p.coverImageUrl ||
      p.heroImageUrl ||
      p.primaryImageUrl ||
      (Array.isArray(p.images) && p.images[0] && (p.images[0].url || p.images[0])) ||
      ""
    );
  }

  function linkForView(p){
    const slug = (p.slug || "").toString();
    if (slug) return `/property.html?slug=${encodeURIComponent(slug)}`;
    return `/property.html?id=${encodeURIComponent(p.id)}`;
  }

  async function moderate(id, action, payload = {}){
    const tries = [
      { path: `/api/properties/${id}/${action}`, method:"POST" },
      { path: `/api/properties/${id}/_moderate`, method:"POST", body:{ action, ...payload } },
      { path: `/api/admin/properties/${id}/${action}`, method:"POST" },
      { path: `/api/admin/properties/${id}`, method:"PATCH", body:{ action, ...payload } }
    ];

    let lastErr = null;
    for (const t of tries){
      try{
        const res = await apiFetch(t.path, {
          method: t.method,
          body: JSON.stringify(t.body || payload || {})
        });
        if (res.ok) return { ok:true, used:t.path };
        lastErr = { used:t.path, status:res.status, data: await readJsonSafe(res) };
      } catch(e){
        lastErr = { used:t.path, error:String(e) };
      }
    }
    return { ok:false, lastErr };
  }

  function setKV(p){
    const rows = [
      ["ID", p.id],
      ["Slug", p.slug],
      ["Status", p.status],
      ["Eircode", p.eircode],
      ["Price", p.price],
      ["Beds", p.beds],
      ["Baths", p.baths],
      ["Type", p.type],
      ["Created", p.createdAt || p.created_at],
      ["Updated", p.updatedAt || p.updated_at],
      ["Owner", p.userId || p.ownerId]
    ].filter(r => r[1] !== undefined && r[1] !== null && String(r[1]).trim() !== "");

    els.kv.innerHTML = rows.map(([k,v]) => `
      <b>${k}</b><div class="mono">${String(v)}</div>
    `).join("");
  }

  function render(p){
    const status = (p.status || "UNKNOWN").toUpperCase();
    els.status.textContent = status;
    statusDot(status);

    els.title.textContent = p.title || p.headline || p.addressLine1 || p.address || p.slug || "Untitled";
    els.addr.textContent = p.address || p.addressLine1 || p.locationText || p.eircode || "";

    const hero = getHeroUrl(p);
    if (hero) {
      els.hero.src = hero;
      els.hero.alt = p.slug ? `Hero - ${p.slug}` : "Hero";
    } else {
      els.hero.removeAttribute("src");
      els.hero.alt = "";
    }

    els.slugChip.textContent = "slug: " + (p.slug || "—");
    setKV(p);

    // button enable logic
    const canApprove = (status === "PENDING" || status === "REJECTED");
    const canReject  = (status === "PENDING" || status === "PUBLISHED");
    els.approveBtn.disabled = !canApprove;
    els.rejectBtn.disabled = !canReject;

    els.viewBtn.onclick = () => window.open(linkForView(p), "_blank");
  }

  async function loadProperty(){
    const id = qp("id");
    const slug = qp("slug");

    const tries = [];
    if (id) {
      tries.push(`/api/properties/${encodeURIComponent(id)}`);
      tries.push(`/api/properties/_admin/${encodeURIComponent(id)}`);
      tries.push(`/api/admin/properties/${encodeURIComponent(id)}`);
    }
    if (slug) {
      tries.push(`/api/properties/slug/${encodeURIComponent(slug)}`);
      tries.push(`/api/properties?slug=${encodeURIComponent(slug)}&scope=admin`);
      tries.push(`/api/admin/properties?slug=${encodeURIComponent(slug)}`);
    }

    let last = null;
    for (const path of tries){
      const res = await apiFetch(path);
      if (res.ok){
        const data = await res.json();
        const p = data.property || data.item || (Array.isArray(data) ? data[0] : data);
        console.info("Loaded via:", path);
        return p;
      }
      last = { path, status: res.status, body: await readJsonSafe(res) };
    }

    console.error("Failed to load property:", last);
    toast("Failed to load property — check console");
    return null;
  }

  async function boot(){
    if (window.HAVN_AUTH && typeof HAVN_AUTH.requireAuth === "function") {
      HAVN_AUTH.requireAuth({ next: location.pathname + location.search });
    } else {
      const t = localStorage.getItem("token");
      if (!t) location.href = "/login.html?next=" + encodeURIComponent(location.pathname + location.search);
    }

    els.backBtn.onclick = () => history.length > 1 ? history.back() : (location.href = "/admin.html");

    let prop = await loadProperty();
    if (!prop) return;

    render(prop);

    els.approveBtn.onclick = async () => {
      if (!confirm(`Approve listing?\n\n${prop.slug || prop.id || ""}`)) return;
      const r = await moderate(prop.id || prop.slug, "approve");
      if (r.ok){
        toast("Approved ✅");
        prop = await loadProperty();
        if (prop) render(prop);
      } else {
        console.warn("Approve failed:", r.lastErr);
        toast("Approve failed — check console");
      }
    };

    els.rejectBtn.onclick = async () => {
      const reason = prompt("Reject reason (optional):", "");
      const r = await moderate(prop.id || prop.slug, "reject", reason ? { reason } : {});
      if (r.ok){
        toast("Rejected ✅");
        prop = await loadProperty();
        if (prop) render(prop);
      } else {
        console.warn("Reject failed:", r.lastErr);
        toast("Reject failed — check console");
      }
    };
  }

  boot();
})();
