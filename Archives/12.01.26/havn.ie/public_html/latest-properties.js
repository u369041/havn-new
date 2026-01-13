/* HAVN — latest-properties.js — PREMIUM HOMEPAGE CARDS — FIXED LINKS (property.html?slug=...) — vHP.4-LINKFIX-20260105 */

(function(){
  const API_BASE = "https://api.havn.ie";
  const GRID_ID = "latestGrid"; // index.html should have <div id="latestGrid"></div>

  const grid = document.getElementById(GRID_ID);
  if(!grid) return;

  const fmtMoney = (n) => {
    const num = Number(n);
    if(!isFinite(num) || num <= 0) return "Price on request";
    return num.toLocaleString("en-IE", { style:"currency", currency:"EUR", maximumFractionDigits:0 });
  };

  const safe = (v, fallback="") => {
    if(v === null || v === undefined) return fallback;
    const s = String(v).trim();
    return s ? s : fallback;
  };

  const extractImg = (p) => {
    const candidates = [];
    const push = (u) => {
      if(!u) return;
      if(Array.isArray(u)) return u.forEach(push);
      if(typeof u === "string") candidates.push(u.trim());
      if(typeof u === "object"){
        const s = (u.url || u.secure_url || u.secureUrl || u.src || u.imageUrl || u.photoUrl || "").trim();
        if(s) candidates.push(s);
      }
    };
    push(p.primaryImageUrl);
    push(p.coverImageUrl);
    push(p.heroImageUrl);
    push(p.images);
    push(p.photos);
    push(p.gallery);
    push(p.media);
    push(p.photoUrls);
    push(p.imageUrls);

    return candidates.find(Boolean) || "https://images.unsplash.com/photo-1501183638710-841dd1904471?auto=format&fit=crop&w=1600&q=60";
  };

  function cardHTML(p){
    const slug = safe(p.slug);
    const href = slug
      ? `/property.html?slug=${encodeURIComponent(slug)}`
      : `/property.html`;

    const img = extractImg(p);

    const title = safe(p.title || p.addressLine || p.displayTitle || p.name || slug, "Listing");
    const loc = safe(p.town || p.county || p.location || p.eircode, "Ireland");
    const price = fmtMoney(p.price ?? p.askingPrice ?? p.listPrice ?? p.priceEUR ?? p.price_eur);

    const beds = safe(p.beds ?? p.bedrooms ?? p.numBeds, "—");
    const baths = safe(p.baths ?? p.bathrooms ?? p.numBaths, "—");
    const type = safe(p.type || p.propertyType, "House").toUpperCase();

    const chip1 = p.isFeatured ? "Featured" : "New";
    const chip2 = type;

    return `
      <a class="h-card" href="${href}" aria-label="Open ${title}">
        <div class="h-imgWrap">
          <img src="${img}" alt="${title}" loading="lazy" />
          <div class="h-badges">
            <span class="h-badge dark">${chip1}</span>
            <span class="h-badge">${chip2}</span>
          </div>
        </div>

        <div class="h-body">
          <div class="h-price">${price}</div>
          <div class="h-title">${title}</div>

          <div class="h-loc">
            <span class="h-locDot"></span>
            <span>${loc}</span>
          </div>

          <div class="h-meta">
            <span class="h-pill">${beds} bed</span>
            <span class="h-pill">${baths} bath</span>
            <span class="h-pill blue">${type}</span>
          </div>
        </div>
      </a>
    `;
  }

  async function load(){
    grid.innerHTML = `<div style="padding:16px;color:#556;">Loading latest listings…</div>`;
    try{
      const res = await fetch(`${API_BASE}/api/properties/latest`, { headers:{ "Accept":"application/json" } });
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const items = json.items || json.data || json.properties || [];

      if(!items.length){
        grid.innerHTML = `<div style="padding:16px;color:#556;">No listings found.</div>`;
        return;
      }

      grid.innerHTML = items.slice(0,6).map(cardHTML).join("");
    }catch(err){
      console.error(err);
      grid.innerHTML = `<div style="padding:16px;color:#b00;">Failed to load listings.</div>`;
    }
  }

  load();
})();
