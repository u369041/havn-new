(function () {
  const $ = (id) => document.getElementById(id);

  // Detect where to call (prod or local)
  function getApiBase() {
    const host = location.host.toLowerCase();
    if (host.endsWith("havn.ie")) return "https://api.havn.ie";
    if (host.endsWith("onrender.com")) return `https://${location.host}`;
    // local/dev fallback — change if your API runs elsewhere
    return "http://localhost:8080";
  }

  // Parse either ?slug=... or ?id=...
  const params = new URLSearchParams(location.search);
  const slug = params.get("slug");
  const id = params.get("id");

  const API = getApiBase();

  function money(n) {
    if (typeof n !== "number") return "—";
    try {
      return new Intl.NumberFormat("en-IE", {
        style: "currency",
        currency: "EUR",
        maximumFractionDigits: 0,
      }).format(n);
    } catch {
      return `€${n.toLocaleString()}`;
    }
  }

  // Auth-aware fetch:
  // - If logged in and HAVN_AUTH exists, use apiFetch (sends Authorization header)
  // - Else, use public fetch
  async function apiFetchAuthAware(url, opts) {
    const hasAuth =
      typeof window !== "undefined" &&
      window.HAVN_AUTH &&
      typeof window.HAVN_AUTH.isLoggedIn === "function" &&
      typeof window.HAVN_AUTH.apiFetch === "function" &&
      window.HAVN_AUTH.isLoggedIn();

    if (hasAuth) {
      return window.HAVN_AUTH.apiFetch(url, opts || {});
    }
    return fetch(url, opts || {});
  }

  async function fetchProperty() {
    if (!slug && !id) {
      throw new Error("Pass either ?slug=… or ?id=… in the URL");
    }

    const url = slug
      ? `${API}/api/properties/${encodeURIComponent(slug)}`
      : `${API}/api/properties/id/${encodeURIComponent(id)}`;

    // IMPORTANT: use auth-aware fetch so archived/drafts work for owner/admin
    const r = await apiFetchAuthAware(url, {
      headers: { Accept: "application/json" },
    });

    const data = await r.json().catch(() => ({}));

    // Your backend pattern: { ok: true, property: {...} }
    if (!r.ok || !data.ok) {
      const msg =
        data?.error ||
        data?.message ||
        r.statusText ||
        "Request failed";

      throw new Error(`${r.status} ${msg}`);
    }

    return data.property;
  }

  function setStatusBadge(status) {
    const el = $("status-badge");
    if (!el) return;
    el.textContent = status?.replaceAll("_", " ") || "—";

    const map = {
      FOR_SALE: ["#eef2ff", "#4338ca"],
      SALE_AGREED: ["#fffbeb", "#92400e"],
      SOLD: ["#ecfeff", "#155e75"],
      WITHDRAWN: ["#fee2e2", "#991b1b"],
    };
    const [bg, fg] = map[status] || ["#eef2ff", "#4338ca"];
    el.style.background = bg;
    el.style.color = fg;
  }

  function render(property) {
    $("alert").hidden = true;
    $("content").hidden = false;

    $("title").textContent = property.title || "—";
    $("address").textContent = property.address || "—";
    $("price").textContent = money(property.price);
    $("beds").textContent = property.beds ?? "—";
    $("baths").textContent = property.baths ?? "—";
    $("eircode").textContent = property.eircode || "—";
    $("ber").textContent = property.ber || "—";
    $("listingType").textContent = property.listingType || "—";
    $("slug").textContent = property.slug || "—";
    $("id").textContent = property.id || "—";
    $("overview").textContent = property.overview || "";
    $("description").textContent = property.description || "";

    setStatusBadge(property.status);

    // Features
    const featWrap = $("features");
    featWrap.innerHTML = "";
    (property.features || []).forEach((f) => {
      const s = document.createElement("span");
      s.className = "pill";
      s.textContent = f;
      featWrap.appendChild(s);
    });
    if ((property.features || []).length === 0) {
      featWrap.innerHTML = '<span class="muted">No features listed</span>';
    }

    // Floorplans
    const planWrap = $("floorplans");
    planWrap.innerHTML = "";
    (property.floorplans || []).forEach((src) => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = "Floorplan";
      img.style.maxWidth = "100%";
      img.style.margin = "6px 0";
      img.style.borderRadius = "8px";
      planWrap.appendChild(img);
    });
    if ((property.floorplans || []).length === 0) {
      planWrap.innerHTML = '<span class="muted">No floorplans</span>';
    }

    // Photos gallery
    const hero = $("hero");
    const thumbs = $("thumbs");
    const photos = property.photos?.length
      ? property.photos
      : ["https://picsum.photos/seed/havn/1200/800"];

    hero.src = photos[0];

    thumbs.innerHTML = "";
    photos.forEach((src, idx) => {
      const t = document.createElement("img");
      t.src = src;
      if (idx === 0) t.classList.add("active");
      t.addEventListener("click", () => {
        hero.src = src;
        [...thumbs.children].forEach((c) => c.classList.remove("active"));
        t.classList.add("active");
      });
      thumbs.appendChild(t);
    });
  }

  async function main() {
    try {
      const p = await fetchProperty();
      render(p);
    } catch (err) {
      const el = $("alert");
      el.className = "error";
      el.textContent = `Error: ${err.message}`;
      el.hidden = false;
      $("content").hidden = true;
    }
  }

  main();
})();
