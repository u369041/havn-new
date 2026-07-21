/* properties.js — HAVN.ie browse page + Price Drop Engine V1
   Safe full replacement.
   - Preserves current properties.html layout/render
   - Keeps existing card design
   - Makes Advanced Filters work
   - Makes Live Map Intelligence plot all visible listings
   - Uses MapLibre + MapTiler for Live Map Intelligence rendering
   - Uses saved backend lat/lng first; no frontend Eircode geocoding
   - Adds premium HAVN map markers for featured/non-featured listings
   - Falls back to town/county/address-derived Irish coordinates only when lat/lng is missing
   - Adds Price Drop Engine V1:
     active if previousPrice > price AND priceDroppedAt within 14 days
     displayed on every browse card
     Featured outranks price drops, price drops outrank normal newest listings
   - Keeps HARD RULE: only PUBLISHED listings render
*/

(function () {
  "use strict";

  const API_BASE = "https://api.havn.ie";

  const HAVN_LOCATIONS =
    window.HAVN_LOCATIONS || [];

  const HAVN_LOCATION_HELPERS =
    window.HAVN_LOCATION_HELPERS || {
      normalize(v){
        return String(v || "")
          .toLowerCase()
          .trim();
      },
      displayName(loc){
        return loc?.area || loc?.city || loc?.county || "";
      },
      search(){
        return [];
      },
      find(){
        return null;
      }
    };

  const NEARBY_AREAS = {
    "ranelagh": ["rathmines", "donnybrook", "portobello"],
    "ballsbridge": ["donnybrook", "sandymount", "ranelagh"],
    "clontarf": ["raheny", "killester", "fairview"],
    "blackrock": ["deansgrange", "foxrock", "dun laoghaire"],
    "greystones": ["bray", "delgany"],
    "naas": ["newbridge", "maynooth"],
    "galway": ["salthill", "oranmore"],
    "cork": ["douglas", "ballincollig"],
    "limerick": ["castletroy", "dooradoyle"]
  };

  const AREA_COORDS = {
    "ireland": [53.4129, -8.2439],
    "dublin": [53.3498, -6.2603],
    "cork": [51.8985, -8.4756],
    "galway": [53.2707, -9.0568],
    "limerick": [52.6638, -8.6267],
    "waterford": [52.2593, -7.1101],
    "ranelagh": [53.3259, -6.2526],
    "ballsbridge": [53.3277, -6.2295],
    "clontarf": [53.3622, -6.2186],
    "blackrock": [53.3015, -6.1778],
    "greystones": [53.1408, -6.0631]
  };

  const MAPTILER_KEY = "xp4jKpv8DhA65J8zjSVG";
  const MAPTILER_STYLE = "https://api.maptiler.com/maps/streets-v2/style.json?key=" + encodeURIComponent(MAPTILER_KEY);
  const PRICE_DROP_ACTIVE_DAYS = 14;
  const PRICE_DROP_ACTIVE_MS = PRICE_DROP_ACTIVE_DAYS * 24 * 60 * 60 * 1000;

  const $ = (id) => document.getElementById(id);

  const grid = $("grid");
  const searchInput = $("search");
  const suggestBox = $("suggestBox");
  const notice = $("notice");
  const modeChip = $("modeChip");
  const countChip = $("countChip");
  const subText = $("subText");

  const heroPrice = $("heroPrice");
  const heroBeds = $("heroBeds");
  const heroType = $("heroType");

  const params = new URLSearchParams(window.location.search);
  const SEO_LOCATION = (params.get("seoLocation") || "").trim();

  let MODE = cleanMode(params.get("mode") || "buy");
  let ALL_ITEMS = [];
  let CURRENT_FILTERED = [];
  let CURRENT_NEARBY = [];
  let MAP_MOVE_SEARCH = false;
  let COMMUTE_DESTINATION = "";
  
  let MAP = null;
  let MARKERS = [];

  const FILTERS = {
    q: (params.get("q") || SEO_LOCATION || "").trim(),
    price: params.get("price") || "",
    beds: params.get("beds") || "",
    baths: params.get("baths") || "",
    type: params.get("type") || "",
    roomType: params.get("roomType") || "",

    berBand: params.get("berBand") || "",
    furnished: params.get("furnished") || "",
    ensuite: params.get("ensuite") || "",
    couplesAllowed: params.get("couplesAllowed") || "",
    billsIncluded: params.get("billsIncluded") || "",

    commute: "",
    mustHaves: new Set()
  };

  const SORT = { value: params.get("sort") || "best" };

  function cleanMode(value) {
    const m = String(value || "").trim().toLowerCase();
    if (m === "rent" || m === "share") return m;
    return "buy";
  }

  function modeToApi(value) {
    const m = cleanMode(value);
    if (m === "rent") return "RENT";
    if (m === "share") return "SHARE";
    return "BUY";
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (m) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m];
    });
  }

    function norm(s) {
      return HAVN_LOCATION_HELPERS.normalize(s);
    }

  function money(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return "Price on request";
    return new Intl.NumberFormat("en-IE", {
      style: "currency",
      currency: "EUR",
      maximumFractionDigits: 0
    }).format(num);
  }

  function compactMoney(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num <= 0) return "€POA";
    if (num >= 1000000) return "€" + (num / 1000000).toFixed(num % 1000000 === 0 ? 0 : 1) + "m";
    return "€" + Math.round(num / 1000) + "k";
  }

  function getActivePriceDropData(p) {
    if (!p) return null;

    const price = Number(p.price || 0);
    const previousPrice = Number(p.previousPrice || 0);
    const droppedAtRaw = p.priceDroppedAt;

    if (!Number.isFinite(price) || !Number.isFinite(previousPrice)) return null;
    if (price <= 0 || previousPrice <= 0 || previousPrice <= price) return null;
    if (!droppedAtRaw) return null;

    const droppedAt = new Date(droppedAtRaw).getTime();

    if (!Number.isFinite(droppedAt)) return null;
    if (Date.now() - droppedAt > PRICE_DROP_ACTIVE_MS) return null;

    return {
      previousPrice: previousPrice,
      newPrice: price,
      reduction: previousPrice - price,
      priceDroppedAt: new Date(droppedAt)
    };
  }

  function isActivePriceDrop(p) {
    return !!getActivePriceDropData(p);
  }

  function priceDropHTML(p) {
    const drop = getActivePriceDropData(p);

    if (!drop) return "";

    return `
      <div style="margin:0 0 10px;font-size:12px;font-weight:950;color:#16a34a;line-height:1.25;">
        ↓ Reduced from ${esc(money(drop.previousPrice))}
      </div>
    `;
  }

  function getFirstDefined() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (v !== undefined && v !== null && String(v).trim() !== "") return v;
    }
    return "";
  }

  function getNested(obj, paths) {
    for (let i = 0; i < paths.length; i++) {
      const parts = paths[i].split(".");
      let cur = obj;
      for (let j = 0; j < parts.length; j++) {
        if (!cur || typeof cur !== "object") {
          cur = undefined;
          break;
        }
        cur = cur[parts[j]];
      }
      if (cur !== undefined && cur !== null && String(cur).trim() !== "") return cur;
    }
    return "";
  }

    function cloudinaryCardUrl(url, width) {
      const src = String(url || "").trim();
      if (!src) return "";
    
      if (!src.includes("res.cloudinary.com") || !src.includes("/upload/")) {
        return src;
      }
    
      if (src.includes("/upload/f_auto") || src.includes("/upload/q_auto")) {
        return src;
      }
    
      const w = Number(width) || 900;
    
      return src.replace(
        "/upload/",
        "/upload/f_auto,q_auto,dpr_auto,c_fill,w_" + w + "/"
      );
    }


  function getThumb(p) {
    const imgs = p.photos || p.images || p.pictures || p.imageUrls || [];
    if (Array.isArray(imgs) && imgs.length) {
      const first = imgs[0];
      if (typeof first === "string") return first;
      if (first && typeof first === "object") return first.url || first.secure_url || first.src || "";
    }
    return p.cover || p.coverImage || p.image || "";
  }
  
    function getCardPhotos(p) {
      const rows =
        p &&
        p.photoMeta &&
        Array.isArray(p.photoMeta.photos)
          ? p.photoMeta.photos
          : [];
    
      const metaPhotos = rows
        .map(function (row) {
          if (!row || !row.url) return null;
    
          return {
            url: String(row.url || "").trim(),
            category: String(row.category || "").trim(),
            isCover: row.isCover === true || Number(row.index) === 0,
            index: Number.isFinite(Number(row.index)) ? Number(row.index) : 999
          };
        })
        .filter(function (row) {
          return row && row.url;
        });
    
      if (metaPhotos.length) {
        return metaPhotos
          .sort(function (a, b) {
            if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
            return a.index - b.index;
          })
          .map(function (row) {
            return row.url;
          });
      }
    
      const raw = p.photos || p.images || p.pictures || p.imageUrls || [];
      const out = [];
    
      if (Array.isArray(raw)) {
        raw.forEach(function (item) {
          if (!item) return;
    
          if (typeof item === "string") {
            out.push(item);
            return;
          }
    
          if (typeof item === "object") {
            const url = item.url || item.secure_url || item.src;
            if (url) out.push(url);
          }
        });
      }
    
      const cover = p.cover || p.coverImage || p.image;
      if (cover) out.unshift(cover);
    
      return Array.from(new Set(out.map(function (x) {
        return String(x || "").trim();
      }).filter(Boolean)));
    }

        function getCardPhotoObjects(p) {
          const rows =
            p &&
            p.photoMeta &&
            Array.isArray(p.photoMeta.photos)
              ? p.photoMeta.photos
              : [];
        
          const metaPhotos = rows
            .map(function (row) {
              if (!row || !row.url) return null;
        
              return {
                url: String(row.url || "").trim(),
                category: String(row.category || "").trim(),
                isCover: row.isCover === true || Number(row.index) === 0,
                index: Number.isFinite(Number(row.index)) ? Number(row.index) : 999
              };
            })
            .filter(function (row) {
              return row && row.url;
            });
        
          if (metaPhotos.length) {
            return metaPhotos.sort(function (a, b) {
              if (a.isCover !== b.isCover) return a.isCover ? -1 : 1;
              return a.index - b.index;
            });
          }
        
          return getCardPhotos(p).map(function (url, index) {
            return {
              url: url,
              category: "",
              isCover: index === 0,
              index: index
            };
          });
        }
 
function injectFeaturedGalleryStyles() {
  const old = document.getElementById("havnFeaturedGalleryStyles");
  if (old) old.remove();

  const style = document.createElement("style");
  style.id = "havnFeaturedGalleryStyles";
  style.textContent = `
    #grid.grid{
      gap:18px !important;
    }

    .prop-card.isFeatured{
      display:grid !important;
      grid-template-columns:minmax(0,52%) minmax(0,48%) !important;
      height:350px !important;
      min-height:350px !important;
      max-height:350px !important;
      border:2px solid #f97316 !important;
      border-radius:22px !important;
      overflow:hidden !important;
      background:#fff !important;
      box-shadow:0 18px 46px rgba(15,23,42,.10) !important;
      position:relative !important;
    }

    .prop-card.isFeatured::before,
    .prop-card.isFeatured::after,
    .prop-card.isFeatured .prop-body::before,
    .prop-card.isFeatured .prop-body::after{
      display:none !important;
      content:none !important;
    }

    .prop-card.isFeatured .featuredEditorialGallery{
      height:350px !important;
      min-height:350px !important;
      max-height:350px !important;
      display:grid !important;
      grid-template-columns:minmax(0,1fr) 150px !important;
      gap:3px !important;
      background:#fff !important;
      overflow:hidden !important;
      position:relative !important;
    }

    .prop-card.isFeatured .featuredHeroPane{
      position:relative !important;
      height:350px !important;
      overflow:hidden !important;
      background:#0b1220 !important;
    }

    .prop-card.isFeatured .featuredMainPhoto{
      width:100% !important;
      height:350px !important;
      object-fit:cover !important;
      display:block !important;
    }

    .prop-card.isFeatured .featuredSideStack{
      width:150px !important;
      height:350px !important;
      display:grid !important;
      grid-template-rows:repeat(3,1fr) !important;
      gap:3px !important;
      background:#fff !important;
    }

    .prop-card.isFeatured .featuredSidePhoto{
      position:relative !important;
      overflow:hidden !important;
      background:#111827 !important;
      cursor:pointer !important;
    }

    .prop-card.isFeatured .featuredSidePhoto img{
      width:100% !important;
      height:100% !important;
      object-fit:cover !important;
      display:block !important;
      transition:transform .25s ease !important;
    }

    .prop-card.isFeatured .featuredSidePhoto:hover img{
      transform:scale(1.04) !important;
    }

    .prop-card.isFeatured .featuredSidePhoto span{
      display:none !important;
    }

    .prop-card.isFeatured .featuredSidePhoto strong{
      position:absolute !important;
      inset:0 !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      background:rgba(10,26,51,.58) !important;
      color:#fff !important;
      font-size:20px !important;
      font-weight:1000 !important;
      letter-spacing:-.03em !important;
    }

    .prop-card.isFeatured .topMatchBadge{
      top:16px !important;
      left:16px !important;
      z-index:45 !important;
      padding:9px 13px !important;
      border-radius:999px !important;
      background:#061646 !important;
      border:0 !important;
      color:#fff !important;
      font-size:12px !important;
      font-weight:1000 !important;
      box-shadow:0 14px 28px rgba(15,23,42,.24) !important;
    }

        .prop-card.isFeatured .cardPhotoArrow{
          top:50% !important;
          transform:translateY(-50%) !important;
          z-index:45 !important;
          width:38px !important;
          height:38px !important;
          border-radius:999px !important;
          background:rgba(255,255,255,.92) !important;
          border:1px solid rgba(255,255,255,.82) !important;
          color:#061646 !important;
          display:flex !important;
          align-items:center !important;
          justify-content:center !important;
          font-size:0 !important;
          font-weight:900 !important;
          box-shadow:0 12px 28px rgba(15,23,42,.18) !important;
          backdrop-filter:blur(12px) !important;
        }

    .prop-card.isFeatured .cardPhotoArrow.prev{
      left:18px !important;
    }

    .prop-card.isFeatured .cardPhotoArrow.next{
      right:18px !important;
    }

    .prop-card.isFeatured .cardPhotoArrow::before{
      content:"" !important;
      width:9px !important;
      height:9px !important;
      border-top:2.5px solid #061646 !important;
      border-right:2.5px solid #061646 !important;
      display:block !important;
    }
    
    .prop-card.isFeatured .cardPhotoArrow.prev::before{
      transform:rotate(-135deg) !important;
    }
    
    .prop-card.isFeatured .cardPhotoArrow.next::before{
      transform:rotate(45deg) !important;
    }

        .prop-card.isFeatured .cardPhotoArrow:hover{
          background:#fff !important;
          transform:translateY(-50%) scale(1.05) !important;
        }

    .prop-card.isFeatured .havnPhotoDots{
      left:50% !important;
      bottom:18px !important;
      transform:translateX(-50%) !important;
      z-index:45 !important;
      background:transparent !important;
      box-shadow:none !important;
      padding:0 !important;
    }

    .prop-card.isFeatured .havnPhotoDots span{
      width:7px !important;
      height:7px !important;
      border:2px solid rgba(255,255,255,.70) !important;
      background:transparent !important;
    }

    .prop-card.isFeatured .havnPhotoDots span.active{
      width:9px !important;
      background:#fff !important;
      border-color:#fff !important;
    }

    .prop-card.isFeatured .havnPhotoCount{
      left:18px !important;
      right:auto !important;
      bottom:16px !important;
      z-index:46 !important;
      padding:10px 15px !important;
      border-radius:999px !important;
      background:rgba(6,22,70,.86) !important;
      color:#fff !important;
      font-size:14px !important;
      font-weight:1000 !important;
      box-shadow:0 14px 28px rgba(15,23,42,.22) !important;
    }

    .prop-card.isFeatured .prop-body{
      position:relative !important;
      height:350px !important;
      min-height:350px !important;
      max-height:350px !important;
      padding:24px 24px 18px !important;
      display:flex !important;
      flex-direction:column !important;
      justify-content:flex-start !important;
      min-width:0 !important;
      background:#fff !important;
    }

    .featuredInfoHeader{
      display:flex !important;
      align-items:center !important;
      justify-content:space-between !important;
      gap:12px !important;
      margin-bottom:8px !important;
      padding-right:58px !important;
      min-height:34px !important;
    }

    .featuredBadgeRow{
      display:flex !important;
      align-items:center !important;
      gap:9px !important;
      flex-wrap:nowrap !important;
      min-width:0 !important;
    }

    .featuredBadge{
      display:inline-flex !important;
      align-items:center !important;
      justify-content:center !important;
      padding:9px 13px !important;
      border-radius:999px !important;
      font-size:11px !important;
      line-height:1 !important;
      font-weight:1000 !important;
      white-space:nowrap !important;
    }

    .featuredBadge.primary{
      background:linear-gradient(135deg,#ff8a00,#f97316) !important;
      color:#fff !important;
      border:1px solid rgba(249,115,22,.25) !important;
    }

    .featuredBadge.secondary{
      background:#fff !important;
      color:#c2410c !important;
      border:1.5px solid rgba(249,115,22,.55) !important;
    }

    .prop-card.isFeatured .havnFavBtn{
      left:auto !important;
      right:20px !important;
      top:20px !important;
      z-index:90 !important;
      width:44px !important;
      height:44px !important;
      border-radius:999px !important;
      background:#fff !important;
      color:#061646 !important;
      box-shadow:0 12px 28px rgba(15,23,42,.16) !important;
    }

    .featuredPrice{
      margin:0 0 5px !important;
      color:#061646 !important;
      font-size:26px !important;
      line-height:1.05 !important;
      letter-spacing:-.045em !important;
      font-weight:1000 !important;
    }

    .prop-card.isFeatured .prop-title{
      font-size:22px !important;
      line-height:1.18 !important;
      font-weight:1000 !important;
      letter-spacing:-.035em !important;
      margin:0 0 6px !important;
      color:#061646 !important;
      display:-webkit-box !important;
      -webkit-line-clamp:3 !important;
      -webkit-box-orient:vertical !important;
      overflow:hidden !important;
    }

    .prop-card.isFeatured .prop-meta{
      font-size:14px !important;
      font-weight:850 !important;
      color:#34456b !important;
      margin:0 0 8px !important;
    }

    .prop-card.isFeatured .prop-chips{
      gap:7px !important;
      margin:0 0 7px !important;
    }

    .prop-card.isFeatured .prop-chips .chip{
      background:#fff !important;
      border:1px solid rgba(6,22,70,.16) !important;
      color:#061646 !important;
      padding:6px 10px !important;
      font-size:12px !important;
      font-weight:950 !important;
      box-shadow:none !important;
    }

    .featuredDescription{
      margin:0 !important;
      color:#061646 !important;
      font-size:13px !important;
      font-weight:650 !important;
      line-height:1.38 !important;
      display:-webkit-box !important;
      -webkit-line-clamp:4 !important;
      -webkit-box-orient:vertical !important;
      overflow:hidden !important;
    }

    .featuredPremiumStrip{
      margin-top:auto !important;
      padding-top:6px !important;
      border-top:1px solid rgba(6,22,70,.12) !important;
      display:flex !important;
      gap:9px !important;
      flex-wrap:wrap !important;
      align-items:center !important;
    }

    .featuredPremiumStrip span{
      display:inline-flex !important;
      align-items:center !important;
      gap:6px !important;
      background:#fff !important;
      border:1.5px solid rgba(249,115,22,.24) !important;
      color:#ea580c !important;
      padding:7px 10px !important;
      border-radius:999px !important;
      font-size:12px !important;
      line-height:1 !important;
      font-weight:1000 !important;
    }

    @media(max-width:1180px){
      .prop-card.isFeatured{
        grid-template-columns:1fr !important;
        height:auto !important;
        min-height:0 !important;
        max-height:none !important;
      }

      .prop-card.isFeatured .featuredEditorialGallery,
      .prop-card.isFeatured .featuredHeroPane,
      .prop-card.isFeatured .featuredMainPhoto,
      .prop-card.isFeatured .featuredSideStack{
        height:320px !important;
        min-height:320px !important;
        max-height:320px !important;
      }

      .prop-card.isFeatured .prop-body{
        height:auto !important;
        min-height:320px !important;
        max-height:none !important;
      }
    }

    @media(max-width:680px){
      .prop-card.isFeatured{
        display:block !important;
      }

      .prop-card.isFeatured .featuredEditorialGallery{
        grid-template-columns:1fr !important;
        height:260px !important;
        min-height:260px !important;
        max-height:260px !important;
      }

      .prop-card.isFeatured .featuredHeroPane,
      .prop-card.isFeatured .featuredMainPhoto{
        height:260px !important;
        min-height:260px !important;
        max-height:260px !important;
      }

      .prop-card.isFeatured .featuredSideStack{
        display:none !important;
      }

      .prop-card.isFeatured .prop-body{
        height:auto !important;
        min-height:0 !important;
        max-height:none !important;
      }

      .featuredBadge.secondary{
        display:none !important;
      }
    }
  `;

  document.head.appendChild(style);
}
         
function injectStandardCardStyles() {
  const old = document.getElementById("havnStandardCardStyles");
  if (old) old.remove();

  const style = document.createElement("style");
  style.id = "havnStandardCardStyles";
  style.textContent = `
    .prop-card:not(.isFeatured){
      display:grid !important;
      grid-template-columns:minmax(0,40%) minmax(0,60%) !important;
      height:300px !important;
      min-height:300px !important;
      max-height:300px !important;
      border-radius:22px !important;
      border:1px solid rgba(15,23,42,.10) !important;
      background:#fff !important;
      overflow:hidden !important;
      box-shadow:0 14px 34px rgba(15,23,42,.075) !important;
    }

    .standardGalleryWrap{
      position:relative !important;
      height:300px !important;
      min-height:300px !important;
      max-height:300px !important;
      overflow:hidden !important;
      background:#0b1220 !important;
    }

    .prop-card:not(.isFeatured) .prop-thumb{
      width:100% !important;
      height:300px !important;
      min-height:300px !important;
      object-fit:cover !important;
      display:block !important;
    }

    .prop-card:not(.isFeatured) .cardPhotoArrow{
      top:50% !important;
      transform:translateY(-50%) !important;
      z-index:45 !important;
      width:38px !important;
      height:38px !important;
      border-radius:999px !important;
      background:rgba(255,255,255,.92) !important;
      border:1px solid rgba(255,255,255,.82) !important;
      color:#061646 !important;
      display:flex !important;
      align-items:center !important;
      justify-content:center !important;
      font-size:0 !important;
      font-weight:900 !important;
      box-shadow:0 12px 28px rgba(15,23,42,.18) !important;
      backdrop-filter:blur(12px) !important;
    }

    .prop-card:not(.isFeatured) .cardPhotoArrow.prev{
      left:18px !important;
    }

    .prop-card:not(.isFeatured) .cardPhotoArrow.next{
      right:18px !important;
    }

    .prop-card:not(.isFeatured) .cardPhotoArrow::before{
      content:"" !important;
      width:9px !important;
      height:9px !important;
      border-top:2.5px solid #061646 !important;
      border-right:2.5px solid #061646 !important;
      display:block !important;
    }
    
    .prop-card:not(.isFeatured) .cardPhotoArrow.prev::before{
      transform:rotate(-135deg) !important;
    }
    
    .prop-card:not(.isFeatured) .cardPhotoArrow.next::before{
      transform:rotate(45deg) !important;
    }
    
    .prop-card:not(.isFeatured) .cardPhotoArrow:hover{
      background:#fff !important;
      transform:translateY(-50%) scale(1.06) !important;
    }

    .prop-card:not(.isFeatured) .havnPhotoCount{
      left:18px !important;
      right:auto !important;
      bottom:16px !important;
      background:rgba(6,22,70,.86) !important;
      color:#fff !important;
      padding:10px 15px !important;
      border-radius:999px !important;
      font-size:14px !important;
      font-weight:1000 !important;
      box-shadow:0 14px 28px rgba(15,23,42,.22) !important;
      z-index:46 !important;
    }

    .prop-card:not(.isFeatured) .havnPhotoDots{
      left:50% !important;
      bottom:18px !important;
      transform:translateX(-50%) !important;
      background:transparent !important;
      box-shadow:none !important;
      padding:0 !important;
      z-index:45 !important;
    }

    .prop-card:not(.isFeatured) .havnPhotoDots span{
      width:7px !important;
      height:7px !important;
      border:2px solid rgba(255,255,255,.70) !important;
      background:transparent !important;
    }

    .prop-card:not(.isFeatured) .havnPhotoDots span.active{
      width:9px !important;
      background:#fff !important;
      border-color:#fff !important;
    }

    .standardBody{
      position:relative !important;
      height:300px !important;
      min-height:300px !important;
      max-height:300px !important;
      padding:18px 22px 16px !important;
      display:flex !important;
      flex-direction:column !important;
      justify-content:flex-start !important;
      background:#fff !important;
      min-width:0 !important;
    }

    .standardMiniStrip{
      display:grid !important;
      grid-template-columns:repeat(3,1fr) !important;
      gap:8px !important;
      margin:0 58px 10px 0 !important;
    }

    .standardMiniStrip img{
      width:100% !important;
      height:52px !important;
      object-fit:cover !important;
      display:block !important;
      border-radius:10px !important;
      background:#e5e7eb !important;
    }

    .prop-card:not(.isFeatured) .havnFavBtn{
      left:auto !important;
      right:18px !important;
      top:18px !important;
      width:42px !important;
      height:42px !important;
      background:#fff !important;
      color:#061646 !important;
      box-shadow:0 12px 28px rgba(15,23,42,.14) !important;
      z-index:90 !important;
    }

    .standardPrice{
      margin:0 0 5px !important;
      color:#061646 !important;
      font-size:26px !important;
      line-height:1.05 !important;
      letter-spacing:-.045em !important;
      font-weight:1000 !important;
    }

    .prop-card:not(.isFeatured) .prop-title{
      font-size:21px !important;
      line-height:1.14 !important;
      font-weight:1000 !important;
      margin:0 0 5px !important;
      color:#061646 !important;
      letter-spacing:-.03em !important;
      white-space:nowrap !important;
      overflow:hidden !important;
      text-overflow:ellipsis !important;
    }

    .prop-card:not(.isFeatured) .prop-meta{
      font-size:13px !important;
      font-weight:850 !important;
      color:#34456b !important;
      margin:0 0 9px !important;
    }

    .prop-card:not(.isFeatured) .prop-chips{
      gap:7px !important;
      margin:0 0 10px !important;
    }

    .prop-card:not(.isFeatured) .prop-chips .chip{
      background:#fff !important;
      border:1px solid rgba(6,22,70,.16) !important;
      color:#061646 !important;
      padding:6px 10px !important;
      font-size:11px !important;
      font-weight:950 !important;
      box-shadow:none !important;
    }

    .standardDescription{
      margin:0 !important;
      color:#061646 !important;
      font-size:13px !important;
      font-weight:650 !important;
      line-height:1.42 !important;
      display:-webkit-box !important;
      -webkit-line-clamp:4 !important;
      -webkit-box-orient:vertical !important;
      overflow:hidden !important;
    }

    @media(max-width:680px){
      .prop-card:not(.isFeatured){
        display:block !important;
        height:auto !important;
        min-height:0 !important;
        max-height:none !important;
      }

      .standardGalleryWrap,
      .prop-card:not(.isFeatured) .prop-thumb{
        height:260px !important;
        min-height:260px !important;
        max-height:260px !important;
      }

      .standardBody{
        height:auto !important;
        min-height:0 !important;
        max-height:none !important;
      }
    }
  `;

  document.head.appendChild(style);
}
 
 
 
 
 
 
 
 
        
function renderFeaturedPhotoLabels(p) {
  if (!isActiveFeatured(p)) return "";

  const rows = getCardPhotoObjects(p);

  if (!rows.length) return "";

  return `
    <div class="featuredPhotoLabels">
      ${rows.map(function (row, index) {
        const label = row.category || (index === 0 ? "Cover photo" : "Photo " + (index + 1));
        return `<span data-photo-label-index="${index}" class="${index === 0 ? "active" : ""}">${esc(label)}</span>`;
      }).join("")}
    </div>
  `;
}

function renderFeaturedGallery(p, fallback, title, isTopMatch) {
  injectFeaturedGalleryStyles();

  const photos = getCardPhotoObjects(p).filter(function(row){
    return row && row.url;
  });

  const urls = photos.map(function(row){
    return row.url;
  });

  const main = cloudinaryCardUrl(urls[0] || fallback, 900);
  const side = photos.slice(1, 4);
  const total = urls.length || 1;

  return `
    <div
      class="cardPhotoWrap featuredGalleryWrap featuredEditorialGallery"
      data-photo-index="0"
      data-photos="${esc(JSON.stringify((urls.length ? urls : [fallback]).map(function(url){ return cloudinaryCardUrl(url, 900); })))}"
    >
      <div class="featuredHeroPane">
        <img class="prop-thumb featuredMainPhoto" src="${esc(main)}" alt="${esc(title)}" loading="${isTopMatch ? "eager" : "lazy"}" decoding="async" fetchpriority="${isTopMatch ? "high" : "auto"}">
        ${renderPhotoArrows(p)}
        ${renderPhotoDots(p)}
        <div class="havnPhotoCount">1 / ${total}</div>
      </div>

      ${side.length ? `
        <div class="featuredSideStack">
          ${side.map(function(row, index){
            const isLast = index === side.length - 1;
            const remaining = Math.max(total - 4, 0);

            return `
              <div class="featuredSidePhoto" data-photo-index="${index + 1}">
                <img src="${esc(cloudinaryCardUrl(row.url, 320))}" alt="${esc(title)}" loading="lazy" decoding="async">
                ${isLast && remaining > 0 ? `<strong>+${remaining} photos</strong>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

function renderStandardGallery(p, thumb, fallback, title, isTopMatch, isFeatured) {
  injectStandardCardStyles();

  return `
    <div
      class="cardPhotoWrap standardGalleryWrap"
      data-photo-index="0"
      data-photos="${esc(JSON.stringify((getCardPhotos(p).length ? getCardPhotos(p) : [thumb || fallback]).map(function(url){ return cloudinaryCardUrl(url, 760); })))}"
    >
      ${!isFeatured && isTopMatch ? `<div class="topMatchBadge">Best match</div>` : ""}

      <img class="prop-thumb" src="${esc(cloudinaryCardUrl(thumb || fallback, 760))}" alt="${esc(title)}" loading="${isTopMatch ? "eager" : "lazy"}" decoding="async" fetchpriority="${isTopMatch ? "high" : "auto"}">

      ${renderPhotoArrows(p)}
      ${renderPhotoCount(p)}
      ${renderPhotoDots(p)}
    </div>
  `;
}

    
    function renderPhotoDots(p) {
      const photos = getCardPhotoObjects(p);
    
      if (photos.length <= 1) {
        return `
          <div class="havnPhotoDots" aria-hidden="true">
            <span class="active"></span>
          </div>
        `;
      }
    
      return `
        <div class="havnPhotoDots" aria-hidden="true">
          ${photos.slice(0, 6).map(function (_, index) {
            return `<span class="${index === 0 ? "active" : ""}"></span>`;
          }).join("")}
        </div>
      `;
    }

        function renderPhotoCount(p) {
          const photos = getCardPhotoObjects(p);
        
          if (photos.length <= 1) return "";
        
          return `
            <div class="havnPhotoCount">
              1 / ${photos.length}
            </div>
          `;
        }

    
        function renderPhotoArrows(p){
          const photos = getCardPhotoObjects(p);
        
          if (photos.length <= 1) return "";
        
          return `
            <span class="cardPhotoArrow prev" role="button" aria-label="Previous photo">‹</span>
            <span class="cardPhotoArrow next" role="button" aria-label="Next photo">›</span>
          `;
        }

  function isPublished(p) {
    const status = String(p.listingStatus || p.publicStatus || p.status || "").trim().toUpperCase();
    return status === "PUBLISHED";
  }

  function isRenderablePublicListing(p) {
    if (!p || !isPublished(p)) return false;
    const slug = getFirstDefined(p.slug, p.publicSlug, p.propertySlug, p.id);
    const title = getFirstDefined(p.title, p.displayTitle, p.address, p.address1);
    if (!slug || !title) return false;
    if (String(title).trim().toLowerCase() === "untitled listing") return false;
    return true;
  }

  function isActiveFeatured(p) {
    if (!p) return false;
    const flag = p.isFeatured === true || p.featured === true;
    if (!flag || !p.featuredUntil) return false;
    const t = new Date(p.featuredUntil).getTime();
    return Number.isFinite(t) && t > Date.now();
  }

  function getSearchValue() {
    return searchInput ? searchInput.value.trim() : "";
  }

  function getAuthToken() {
    try { return localStorage.getItem("token"); } catch { return null; }
  }

  function showNotice(message, type) {
    if (!notice) return;
    notice.style.display = message ? "block" : "none";
    notice.textContent = message || "";

    if (type === "success") {
      notice.style.borderColor = "rgba(34,197,94,0.22)";
      notice.style.background = "rgba(34,197,94,0.08)";
      notice.style.color = "#166534";
      return;
    }

    if (type === "warning") {
      notice.style.borderColor = "rgba(245,158,11,0.25)";
      notice.style.background = "rgba(245,158,11,0.10)";
      notice.style.color = "#92400e";
      return;
    }

    notice.style.borderColor = "rgba(37,99,235,0.12)";
    notice.style.background = "rgba(37,99,235,0.06)";
    notice.style.color = "#1e3a8a";
  }

  function temporaryNotice(message, type) {
    showNotice(message, type);
    clearTimeout(temporaryNotice._timer);
    temporaryNotice._timer = setTimeout(function () {
      if (notice && notice.textContent === message) {
        notice.style.display = "none";
        notice.textContent = "";
      }
    }, 2600);
  }

  function getPriceBands() {
    if (MODE === "rent") {
      return [
        { key: "", label: "Any rent", min: null, max: null },
        { key: "under-1500", label: "Under €1,500/mo", min: 0, max: 1500 },
        { key: "1500-2500", label: "€1,500–€2,500/mo", min: 1500, max: 2500 },
        { key: "2500-3500", label: "€2,500–€3,500/mo", min: 2500, max: 3500 },
        { key: "3500-plus", label: "€3,500+/mo", min: 3500, max: null }
      ];
    }

    if (MODE === "share") {
      return [
        { key: "", label: "Any rent", min: null, max: null },
        { key: "under-700", label: "Under €700/mo", min: 0, max: 700 },
        { key: "700-1000", label: "€700–€1,000/mo", min: 700, max: 1000 },
        { key: "1000-1500", label: "€1,000–€1,500/mo", min: 1000, max: 1500 },
        { key: "1500-plus", label: "€1,500+/mo", min: 1500, max: null }
      ];
    }

    return [
      { key: "", label: "Any price", min: null, max: null },
      { key: "under-300k", label: "Under €300k", min: 0, max: 300000 },
      { key: "300-500k", label: "€300k – €500k", min: 300000, max: 500000 },
      { key: "500-800k", label: "€500k – €800k", min: 500000, max: 800000 },
      { key: "800k-plus", label: "€800k+", min: 800000, max: null }
    ];
  }

  function normaliseSelectPrice(value) {
    const raw = String(value || "").trim();
    const v = raw.toLowerCase();
    const bands = getPriceBands();

    for (let i = 0; i < bands.length; i++) {
      if (raw === bands[i].label || v === String(bands[i].key).toLowerCase()) {
        return bands[i].key;
      }
    }

    return "";
  }

  function normaliseBeds(value) {
    const match = String(value || "").match(/\d+/);
    return match ? match[0] : "";
  }

  function normaliseType(value) {
    const v = String(value || "").trim().toUpperCase();
    if (["HOUSE", "APARTMENT", "SITE", "COMMERCIAL"].includes(v)) return v;
    const n = norm(value);
    if (n.includes("house")) return "HOUSE";
    if (n.includes("apartment")) return "APARTMENT";
    if (n.includes("site")) return "SITE";
    if (n.includes("commercial")) return "COMMERCIAL";
    return "";
  }

  function getPropertyText(p) {
    return norm([
      p.title,
      p.displayTitle,
      p.description,
      p.summary,
      p.features,
      p.amenities,
      p.ber,
      p.energyRating,
      p.propertyType,
      p.type,
      p.address,
      p.address1,
      p.address2,
      p.addressLine1,
      p.city,
      p.town,
      p.area,
      p.locality,
      p.county
    ].filter(Boolean).join(" "));
  }

  function hasBooleanish(p, keys) {
    return keys.some(function (key) {
      const v = p[key];
      if (v === true) return true;
      if (typeof v === "string") {
        const n = norm(v);
        return n === "true" || n === "yes" || n === "y" || n === "1";
      }
      if (typeof v === "number") return v > 0;
      return false;
    });
  }

  function boolYes(value) {
    const v = String(value || "").trim().toLowerCase();
    return value === true || v === "yes" || v === "true" || v === "1" || v === "y";
  }

  function valueIncludes(value, wanted) {
    return norm(value).includes(norm(wanted));
  }

  function berIsGood(value) {
    const v = String(value || "").trim().toUpperCase();
    return ["A1", "A2", "A3", "B1", "B2", "B3"].includes(v);
  }

  function matchesMustHaves(p) {
    const txt = getPropertyText(p);

    if (FILTERS.berBand) {
      const ber = String(p.berRating || p.ber || "").trim().toUpperCase();

      if (FILTERS.berBand === "a-b" && !["A1", "A2", "A3", "B1", "B2", "B3"].includes(ber)) return false;
      if (FILTERS.berBand === "c-d" && !["C1", "C2", "C3", "D1", "D2"].includes(ber)) return false;
      if (FILTERS.berBand === "e-g" && !["E1", "E2", "F", "G"].includes(ber)) return false;
    }

    if (FILTERS.furnished) {
      const furnished = String(p.furnished || "").toLowerCase();
      if (FILTERS.furnished === "yes" && !(furnished === "yes" || furnished === "true" || furnished === "furnished")) return false;
      if (FILTERS.furnished === "no" && (furnished === "yes" || furnished === "true" || furnished === "furnished")) return false;
    }

    if (FILTERS.ensuite) {
      const ensuite = String(p.ensuite || "").toLowerCase();
      if (FILTERS.ensuite === "yes" && !(ensuite === "yes" || ensuite === "true")) return false;
      if (FILTERS.ensuite === "no" && (ensuite === "yes" || ensuite === "true")) return false;
    }

    if (FILTERS.couplesAllowed) {
      const couples = String(p.couplesAllowed || "").toLowerCase();
      if (FILTERS.couplesAllowed === "yes" && !(couples === "yes" || couples === "true")) return false;
      if (FILTERS.couplesAllowed === "no" && (couples === "yes" || couples === "true")) return false;
    }

    if (FILTERS.billsIncluded) {
      const bills = String(p.billsIncluded || "").toLowerCase();
      if (FILTERS.billsIncluded === "yes" && !(bills === "yes" || bills === "true")) return false;
      if (FILTERS.billsIncluded === "no" && (bills === "yes" || bills === "true")) return false;
    }

    if (FILTERS.roomType) {
      const roomType = String(p.roomType || "").toLowerCase();

      if (FILTERS.roomType === "single-room" && !(roomType.includes("single") || txt.includes("single room"))) return false;
      if (FILTERS.roomType === "double-room" && !(roomType.includes("double") || txt.includes("double room"))) return false;
      if (FILTERS.roomType === "studio" && !(roomType.includes("studio") || txt.includes("studio"))) return false;
    }

    if (!FILTERS.mustHaves || !FILTERS.mustHaves.size) return true;

    const checks = {
      parking: function () {
        return boolYes(p.parking) ||
          hasBooleanish(p, ["hasParking", "carParking", "offStreetParking"]) ||
          txt.includes("parking") || txt.includes("driveway") || txt.includes("garage");
      },

      garden: function () {
        return boolYes(p.outdoorSpace) ||
          hasBooleanish(p, ["hasGarden", "garden", "privateGarden", "rearGarden"]) ||
          txt.includes("garden") || txt.includes("outdoor space");
      },

      balcony: function () {
        return valueIncludes(p.outdoorSpace, "balcony") ||
          hasBooleanish(p, ["hasBalcony", "balcony"]) ||
          txt.includes("balcony") || txt.includes("terrace");
      },

      "good ber": function () {
        return berIsGood(p.berRating || p.ber);
      },

      "new build": function () {
        return valueIncludes(p.saleType, "new") ||
          valueIncludes(p.saleCondition, "new") ||
          txt.includes("new build") ||
          txt.includes("new-build");
      },

      furnished: function () {
        return boolYes(p.furnished) || valueIncludes(p.furnished, "furnished");
      },

      "pets allowed": function () {
        return boolYes(p.petsAllowed) || valueIncludes(p.petsAllowed, "yes");
      },

      "bills included": function () {
        return boolYes(p.billsIncluded) || valueIncludes(p.billsIncluded, "yes");
      },

      "12+ months": function () {
        return valueIncludes(p.leaseLength, "12") ||
          valueIncludes(p.minimumTerm, "12") ||
          valueIncludes(p.leaseLength, "12-plus") ||
          valueIncludes(p.minimumTerm, "12-months");
      },

      ensuite: function () {
        return boolYes(p.ensuite) || valueIncludes(p.ensuite, "yes");
      },

      "couples allowed": function () {
        return boolYes(p.couplesAllowed) || valueIncludes(p.couplesAllowed, "yes");
      },

      "single room": function () {
        return valueIncludes(p.roomType, "single") || txt.includes("single room");
      },

      "double room": function () {
        return valueIncludes(p.roomType, "double") || txt.includes("double room");
      },

      "near transport": function () {
        return hasBooleanish(p, ["nearTransport", "transport", "nearPublicTransport"]) ||
          txt.includes("transport") || txt.includes("bus") || txt.includes("train") ||
          txt.includes("dart") || txt.includes("luas") || txt.includes("station");
      }
    };

    return Array.from(FILTERS.mustHaves).every(function (key) {
      return checks[key] ? checks[key]() : true;
    });
  }

    function isKnownLocationQuery(q) {
      return !!HAVN_LOCATION_HELPERS.find(q);
    }

  function primaryLocationHaystack(p) {
    return norm([p.county, p.city, p.town, p.area, p.locality, p.address, p.address1].filter(Boolean).join(" "));
  }

  function fullLocationHaystack(p) {
    return norm([
      p.address,
      p.address1,
      p.address2,
      p.addressLine1,
      p.city,
      p.town,
      p.area,
      p.locality,
      p.county,
      p.eircode
    ].filter(Boolean).join(" "));
  }

  function matchesSearch(p, query) {
    const q = norm(query);
    if (!q) return true;

    const primary = primaryLocationHaystack(p);
    const full = fullLocationHaystack(p);

    if (isKnownLocationQuery(q)) return primary.includes(q) || full.includes(q);
    return full.includes(q);
  }

  function matchesNearbyArea(p, query) {
    const q = norm(query);
    const nearby = NEARBY_AREAS[q] || [];
    if (!q || !nearby.length) return false;
    const primary = primaryLocationHaystack(p);
    return nearby.some(function (area) { return primary.includes(area); });
  }

  function getLocationScore(p, query) {
    const q = norm(query);
    if (!q) return 0;
    const primary = primaryLocationHaystack(p);
    if (primary.includes(q)) return 100;
    const nearby = NEARBY_AREAS[q] || [];
    for (let i = 0; i < nearby.length; i++) {
      if (primary.includes(nearby[i])) return 80 - (i * 5);
    }
    return 0;
  }

  function shortAddress(p) {
    const town = getFirstDefined(p.city, p.town, p.area, p.locality);
    const county = getFirstDefined(p.county);

    if (town && county) return town + ", Co. " + String(county).replace(/^Co\.\s*/i, "");
    if (town) return String(town);
    if (county) return "Co. " + String(county).replace(/^Co\.\s*/i, "");
    return getFirstDefined(p.address, p.address1, p.addressLine1, "Ireland");
  }

  function displayTitle(p) {
    const beds = getFirstDefined(p.bedrooms);
    const type = getFirstDefined(p.propertyType, p.type);
    if (beds && type) {
      return String(beds) + " Bed " + String(type).toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); });
    }
    return getFirstDefined(p.title, p.displayTitle, p.address, "Property");
  }

  function parsePriceBand(value) {
    const v = String(value || "").trim();
    const bands = getPriceBands();
    const band = bands.find(function (b) { return b.key === v; });
    if (!band) return [null, null];
    return [band.min, band.max];
  }

  function matchesPrice(p) {
    if (!FILTERS.price) return true;
    const price = Number(p.price);
    if (!Number.isFinite(price) || price <= 0) return false;
    const range = parsePriceBand(FILTERS.price);
    if (range[0] !== null && price < range[0]) return false;
    if (range[1] !== null && price > range[1]) return false;
    return true;
  }

  function matchesBeds(p) {
    if (!FILTERS.beds) return true;
    const wanted = Number(FILTERS.beds);
    const actual = Number(p.bedrooms);
    if (!Number.isFinite(wanted)) return true;
    if (!Number.isFinite(actual)) return false;
    return actual >= wanted;
  }

  function matchesType(p) {
    if (!FILTERS.type) return true;
    const pt = normaliseType(getFirstDefined(p.propertyType, p.type));
    return pt === FILTERS.type;
  }

  function getMatchChips(p) {
    const chips = [];
    const q = norm(FILTERS.q);
    const primary = primaryLocationHaystack(p);

    if (q) {
      if (primary.includes(q)) chips.push("Location match");
      else if (matchesNearbyArea(p, FILTERS.q)) chips.push("Nearby option");
    }

    if (FILTERS.beds && matchesBeds(p)) chips.push("Beds fit");
    if (FILTERS.mustHaves && FILTERS.mustHaves.size) chips.push("Filters fit");
    if (FILTERS.commute) chips.push("Commute saved");

    return chips.slice(0, 2);
  }

  function getMatchReasonText() {
    const parts = [];
    if (FILTERS.q) parts.push(FILTERS.q);
    if (FILTERS.beds) parts.push(FILTERS.beds + "+ beds");
    if (FILTERS.type) parts.push(FILTERS.type.toLowerCase());
    if (FILTERS.mustHaves && FILTERS.mustHaves.size) parts.push(Array.from(FILTERS.mustHaves).join(", "));
    return parts.length ? "Best match for your search: " + parts.join(" · ") : "";
  }

  function getNearbyLabels(query) {
    const nearby = NEARBY_AREAS[norm(query)] || [];
    return nearby.map(function (name) { return name.charAt(0).toUpperCase() + name.slice(1); });
  }

  function sortItems(items) {
    return items.slice().sort(function (a, b) {
      const af = isActiveFeatured(a) ? 1 : 0;
      const bf = isActiveFeatured(b) ? 1 : 0;
      if (bf !== af) return bf - af;

      const ad = isActivePriceDrop(a) ? 1 : 0;
      const bd = isActivePriceDrop(b) ? 1 : 0;
      if (bd !== ad) return bd - ad;

      const at = Date.parse(a.publishedAt || a.createdAt || "");
      const bt = Date.parse(b.publishedAt || b.createdAt || "");
      return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
    });
  }

  async function fetchProperties() {
    const url = API_BASE + "/api/properties?limit=200&page=1&mode=" + encodeURIComponent(modeToApi(MODE));
    const res = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const text = await res.text();
    let json = null;

    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) throw new Error(text || "Failed to load properties.");

    let items = [];
    if (Array.isArray(json)) items = json;
    else if (json && Array.isArray(json.items)) items = json.items;
    else if (json && Array.isArray(json.properties)) items = json.properties;
    else if (json && Array.isArray(json.listings)) items = json.listings;
    else if (json && json.data && Array.isArray(json.data)) items = json.data;
    else if (json && json.data && Array.isArray(json.data.items)) items = json.data.items;

    return items.filter(isRenderablePublicListing);
  }

function getFeaturedDescription(p) {
  const raw = getFirstDefined(
    p.description,
    p.summary,
    p.shortDescription,
    Array.isArray(p.features) ? p.features.join(". ") : ""
  );

  const txt = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

  if (txt) return txt;

  return "Impressive family home with bright, spacious accommodation, landscaped gardens and excellent privacy.";
}

function renderFeaturedBody(p, title, loc, beds, baths, type, ber, size) {
  return `
    <div class="prop-body">
      <div class="featuredInfoHeader">
        <div class="featuredBadgeRow">
          <span class="featuredBadge primary">★ Featured Property</span>
        </div>
      </div>

      <div class="featuredPrice">
        ${esc(MODE === "rent" || MODE === "share" ? money(p.price) + " pcm" : money(p.price))}
      </div>

      <h2 class="prop-title">${esc(title)}</h2>

      <div class="prop-meta">${esc(loc)}</div>

      <div class="prop-chips">
        ${beds ? `<span class="chip">${esc(String(beds))} bed</span>` : ""}
        ${baths ? `<span class="chip">${esc(String(baths))} bath</span>` : ""}
        ${ber ? `<span class="chip">BER ${esc(String(ber).toUpperCase())}</span>` : ""}
        ${size ? `<span class="chip">${esc(String(size))} sq m</span>` : ""}
        ${type ? `<span class="chip">${esc(String(type).toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); }))}</span>` : ""}
        <span class="chip">${esc(modeToApi(MODE))}</span>
      </div>

      <p class="featuredDescription">${esc(getFeaturedDescription(p))}</p>

      <div class="featuredPremiumStrip">
        <span>★ Featured</span>
        <span>✓ Verified</span>
      </div>
    </div>
  `;
}


function getStandardDescription(p) {
  const raw = getFirstDefined(
    p.description,
    p.summary,
    p.shortDescription,
    Array.isArray(p.features) ? p.features.join(". ") : ""
  );

  const txt = String(raw || "")
    .replace(/\s+/g, " ")
    .trim();

  if (txt) return txt;

  return "Bright and well-presented property with strong local amenities, practical living space and excellent buyer appeal.";
}

function renderStandardMiniStrip(p, fallback, title) {
  const photos = getCardPhotoObjects(p)
    .filter(function(row){ return row && row.url; })
    .slice(1, 4);

  if (!photos.length) return "";

  return `
    <div class="standardMiniStrip">
      ${photos.map(function(row){
        return `<img src="${esc(cloudinaryCardUrl(row.url || fallback, 260))}" alt="${esc(title)}" loading="lazy" decoding="async">`;
      }).join("")}
    </div>
  `;
}

function renderStandardBody(p, title, loc, beds, baths, type, ber, size, fallback) {
  return `
    <div class="prop-body standardBody">
      ${renderStandardMiniStrip(p, fallback, title)}

      <div class="standardPrice">
        ${esc(MODE === "rent" || MODE === "share" ? money(p.price) + " pcm" : money(p.price))}
      </div>

      ${priceDropHTML(p)}

      <h2 class="prop-title">${esc(title)}</h2>

      <div class="prop-meta">${esc(loc)}</div>

      <div class="prop-chips">
        ${beds ? `<span class="chip">${esc(String(beds))} bed</span>` : ""}
        ${baths ? `<span class="chip">${esc(String(baths))} bath</span>` : ""}
        ${ber ? `<span class="chip">BER ${esc(String(ber).toUpperCase())}</span>` : ""}
        ${size ? `<span class="chip">${esc(String(size))} sq m</span>` : ""}
        ${type ? `<span class="chip">${esc(String(type).toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); }))}</span>` : ""}
        <span class="chip">${esc(modeToApi(MODE))}</span>
      </div>

      <p class="standardDescription">${esc(getStandardDescription(p))}</p>

    </div>
  `;
}


  function buildCard(p, options) {
    options = options || {};

    const isTopMatch = !!options.isTopMatch;
    const isFeatured = isActiveFeatured(p);
    const slug = getFirstDefined(p.slug, p.publicSlug, p.propertySlug, p.id);
    if (!slug) return "";

    const thumb = getThumb(p);
    const fallback = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#e5e7eb"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-size="44" font-family="Arial">HAVN.ie</text></svg>'
    );

    const title = displayTitle(p);
    const loc = shortAddress(p);
    const beds = getFirstDefined(p.bedrooms);
    const baths = getFirstDefined(p.bathrooms);
    const type = getFirstDefined(p.propertyType, p.type);
    const ber = getFirstDefined(p.berRating, p.ber, p.energyRating);
    const size = getFirstDefined(p.size, p.floorArea, p.floorAreaSqm, p.areaSqm);

    return `
  <a
    class="prop-card${isFeatured ? " isFeatured" : ""}"
    href="/property.html?slug=${encodeURIComponent(slug)}"
    data-property-id="${esc(getFirstDefined(p.id, p.propertyId, p.listingId))}"
  >
    ${isFeatured
      ? renderFeaturedGallery(p, fallback, title, isTopMatch)
      : renderStandardGallery(p, thumb, fallback, title, isTopMatch, isFeatured)}

    ${isFeatured
      ? renderFeaturedBody(p, title, loc, beds, baths, type, ber, size)
      : renderStandardBody(p, title, loc, beds, baths, type, ber, size, fallback)}
  </a>
`;
  }

  function renderNearbySection(items, query) {
    let wrap = document.getElementById("nearbyResultsWrap");

    if (!wrap) {
      wrap = document.createElement("section");
      wrap.id = "nearbyResultsWrap";
      if (grid && grid.parentNode) grid.parentNode.insertBefore(wrap, grid.nextSibling);
    }

    const arr = Array.isArray(items) ? items.filter(isRenderablePublicListing) : [];

    if (!arr.length) {
      wrap.style.display = "none";
      wrap.innerHTML = "";
      return;
    }

    const q = esc(query || "this area");
    const nearbyLabels = getNearbyLabels(query);

    wrap.style.display = "block";
    wrap.innerHTML = `
      <div class="nearbyPanel">
        <div class="nearbyHead">
          <div>
            <div class="nearbyKicker">Expanded search</div>
            <h2>Nearby commuter areas</h2>
            <p>No exact listings were found in ${q}. These listings are outside ${q}, but may still suit your commute.</p>
          </div>
          <div class="nearbyActions">
            <button class="softBtn" type="button" id="nearbyAdjustBtn">Adjust search</button>
            <button class="softBtn" type="button" id="nearbyHideBtn">Hide nearby</button>
          </div>
        </div>

        ${nearbyLabels.length ? `
          <div class="nearbyAreaChips">
            ${nearbyLabels.map(function (label) {
              return `<button class="nearbyChipBtn" type="button" data-nearby="${esc(label)}">${esc(label)}</button>`;
            }).join("")}
          </div>
        ` : ""}

        <div class="nearbyGrid">
          ${arr.map(function (p) { return buildCard(p, { isTopMatch: false }); }).join("")}
        </div>
      </div>
    `;

    const adjustBtn = document.getElementById("nearbyAdjustBtn");
    if (adjustBtn) adjustBtn.addEventListener("click", function () { if (searchInput) searchInput.focus(); });

    const hideBtn = document.getElementById("nearbyHideBtn");
    if (hideBtn) hideBtn.addEventListener("click", function () { wrap.style.display = "none"; });

    wrap.querySelectorAll(".nearbyChipBtn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const value = btn.getAttribute("data-nearby") || "";
        if (!value || !searchInput) return;
        searchInput.value = value;
        FILTERS.q = value;
        render();
      });
    });
  }

  function updateModeSpecificFilters() {
    const bands = getPriceBands();

    document.querySelectorAll(".filterGroup").forEach(function (group) {
      const labelEl = group.querySelector(".filterLabel");
      const pillsEl = group.querySelector(".filterPills");
      const checkList = group.querySelector(".checkList");

      if (labelEl && pillsEl) {
        const label = norm(labelEl.textContent || "");

        if (label.includes("budget") || label.includes("rent")) {
          labelEl.innerHTML = `
            ${MODE === "buy" ? "Budget" : "Monthly rent"}
            <span class="filterHint">${MODE === "buy" ? "Purchase price" : "Rental price"}</span>
          `;

          pillsEl.innerHTML = bands.map(function (band, index) {
            return `<button class="miniPill${index === 0 ? " active" : ""}" type="button">${esc(band.label)}</button>`;
          }).join("");
        }
      }

      if (labelEl && checkList) {
        const label = norm(labelEl.textContent || "");

        if (
        label.includes("must haves") ||
        label.includes("rental details") ||
        label.includes("share details")
        ) {
          let filters = [];

          if (MODE === "rent") {
            filters = [
              "Parking",
              "Pets allowed",
              "Bills included",
              "12+ months",
              "Balcony"
            ];

            labelEl.innerHTML = `
              Rental details
              <span class="filterHint">Rent-specific</span>
            `;
          } else if (MODE === "share") {
            filters = [
              "Double room",
              "Single room",
              "Ensuite",
              "Couples allowed",
              "Bills included",
              "12+ months"
            ];

            labelEl.innerHTML = `
              Share details
              <span class="filterHint">Room-specific</span>
            `;
          } else {
            filters = [
              "Parking",
              "Garden",
              "Balcony",
              "Good BER",
              "New build",
              "Near transport"
            ];

            labelEl.innerHTML = `
              Must-haves
              <span class="filterHint">Buyer-specific</span>
            `;
          }

          checkList.innerHTML = filters.map(function (label) {
            return `<label class="checkItem"><input type="checkbox"> ${esc(label)}</label>`;
          }).join("");
        }
      }
    });

    if (heroPrice) {
      heroPrice.innerHTML = bands.map(function (band) {
        return `<option>${esc(band.label)}</option>`;
      }).join("");
    }

    const panelSub = document.querySelector(".leftPanel .panelSub");
    if (panelSub) {
      if (MODE === "rent") panelSub.textContent = "Decision-grade filters for serious renters.";
      else if (MODE === "share") panelSub.textContent = "Decision-grade filters for room shares.";
      else panelSub.textContent = "Decision-grade filters for serious buyers.";
    }
  }

  function syncControlsFromFilters() {
    if (searchInput) searchInput.value = FILTERS.q || "";

    if (heroPrice) {
      const bands = getPriceBands();

      heroPrice.innerHTML = bands.map(function (band) {
        return `<option>${esc(band.label)}</option>`;
      }).join("");

      const activeBand = bands.find(function (band) {
        return band.key === FILTERS.price;
      });

      heroPrice.value = activeBand ? activeBand.label : bands[0].label;
    }

    if (heroBeds) {
      const map = { "": "Any beds", "1": "1+ bed", "2": "2+ beds", "3": "3+ beds", "4": "4+ beds" };
      heroBeds.value = map[FILTERS.beds] || "Any beds";
    }

    if (heroType) {
      const map = { "": "Any type", HOUSE: "House", APARTMENT: "Apartment", SITE: "Site", COMMERCIAL: "Commercial" };
      heroType.value = map[FILTERS.type] || "Any type";
    }

    document.querySelectorAll(".filterGroup").forEach(function (group) {
      const label = norm(group.querySelector(".filterLabel") ? group.querySelector(".filterLabel").textContent : "");

      group.querySelectorAll(".miniPill").forEach(function (pill) {
        const text = norm(pill.textContent);

        if (label.includes("property type")) {
          const type = normaliseType(pill.textContent);
          pill.classList.toggle("active", (!FILTERS.type && text === "any") || (type && type === FILTERS.type));
        }

        if (label.includes("budget") || label.includes("rent")) {
          const price = normaliseSelectPrice(pill.textContent);
          pill.classList.toggle("active", (!FILTERS.price && (text === "any" || text === "any rent" || text === "any price")) || (price && price === FILTERS.price));
        }
      });

      group.querySelectorAll(".checkItem input").forEach(function (input) {
        const parent = input.closest(".checkItem");
        const key = norm(parent ? parent.textContent : "");
        input.checked = FILTERS.mustHaves.has(key);
      });
    });
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", MODE);

    if (FILTERS.q) url.searchParams.set("q", FILTERS.q); else url.searchParams.delete("q");
    if (FILTERS.price) url.searchParams.set("price", FILTERS.price); else url.searchParams.delete("price");
    if (FILTERS.beds) url.searchParams.set("beds", FILTERS.beds); else url.searchParams.delete("beds");
    if (FILTERS.type) url.searchParams.set("type", FILTERS.type); else url.searchParams.delete("type");
    
    if (SORT.value && SORT.value !== "best") {
    url.searchParams.set("sort", SORT.value);
    } else {
    url.searchParams.delete("sort");
    }

    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }

  function updateInsights(filtered, nearbyFiltered) {
    const insightCards = document.querySelectorAll(".insightCard .insightValue");
    if (!insightCards.length) return;

    const all = filtered.concat(nearbyFiltered || []);
    const prices = all.map(function (p) { return Number(p.price); }).filter(function (n) { return Number.isFinite(n) && n > 0; });

    const avg = prices.length ? Math.round(prices.reduce(function (a, b) { return a + b; }, 0) / prices.length) : 0;
    const featuredCount = all.filter(isActiveFeatured).length;
    const priceDropCount = all.filter(isActivePriceDrop).length;
    const newestCount = all.filter(function (p) {
      const t = Date.parse(p.publishedAt || p.createdAt || "");
      return Number.isFinite(t) && (Date.now() - t) <= 14 * 24 * 60 * 60 * 1000;
    }).length;

    insightCards[0].textContent = avg ? money(avg) : "—";
    insightCards[1].textContent = newestCount ? "+" + newestCount : "0";
    insightCards[2].textContent = priceDropCount
      ? priceDropCount + " price drops"
      : featuredCount
      ? featuredCount + " featured"
      : "Stable";
    insightCards[3].textContent = all.length >= 8 ? "High" : all.length >= 3 ? "Medium" : "Low";
  }

  function getLocationKeyFromText(p) {
    const hay = norm([
      p.address,
      p.address1,
      p.address2,
      p.addressLine1,
      p.city,
      p.town,
      p.area,
      p.locality,
      p.county,
      p.title,
      p.displayTitle
    ].filter(Boolean).join(" "));

    const keys = Object.keys(AREA_COORDS)
      .filter(function (k) { return k !== "ireland"; })
      .sort(function (a, b) { return b.length - a.length; });

    for (let i = 0; i < keys.length; i++) {
      if (hay.includes(keys[i])) return keys[i];
    }

    return "ireland";
  }

  function getCoordForProperty(p, index) {
    const latRaw = getFirstDefined(
      p.lat,
      p.latitude,
      p.mapLat,
      p.geoLat,
      getNested(p, [
        "location.lat",
        "location.latitude",
        "geo.lat",
        "geo.latitude",
        "coordinates.lat",
        "coordinates.latitude"
      ])
    );

    const lngRaw = getFirstDefined(
      p.lng,
      p.lon,
      p.longitude,
      p.mapLng,
      p.mapLon,
      p.geoLng,
      p.geoLon,
      getNested(p, [
        "location.lng",
        "location.lon",
        "location.longitude",
        "geo.lng",
        "geo.lon",
        "geo.longitude",
        "coordinates.lng",
        "coordinates.lon",
        "coordinates.longitude"
      ])
    );

    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    const hasRealCoords =
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180 &&
      !(Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001);

    if (hasRealCoords) {
      return [lat, lng, true];
    }

    const key = getLocationKeyFromText(p);
    const base = AREA_COORDS[key] || AREA_COORDS.ireland;

    const jitterLat = ((index % 5) - 2) * 0.012;
    const jitterLng = ((index % 7) - 3) * 0.016;

    return [base[0] + jitterLat, base[1] + jitterLng, false];
  }

  function loadMapLibreAssets() {
    return new Promise(function (resolve, reject) {
      if (window.maplibregl) {
        resolve();
        return;
      }

      if (!document.querySelector('link[data-havn-maplibre-css="1"]')) {
        const css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css";
        css.setAttribute("data-havn-maplibre-css", "1");
        document.head.appendChild(css);
      }

      const existing = document.querySelector('script[data-havn-maplibre-js="1"]');
      if (existing) {
        existing.addEventListener("load", resolve);
        existing.addEventListener("error", reject);
        return;
      }

      const js = document.createElement("script");
      js.src = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js";
      js.defer = true;
      js.setAttribute("data-havn-maplibre-js", "1");
      js.onload = resolve;
      js.onerror = reject;
      document.head.appendChild(js);
    });
  }
  

  function injectMapMarkerStyles() {
    if (document.getElementById("havnPremiumMapMarkerStyles")) return;

    const style = document.createElement("style");
    style.id = "havnPremiumMapMarkerStyles";
    style.textContent = `
      #havnMapLibreMap {
        position: absolute;
        inset: 0;
        z-index: 1;
        height: 100%;
        width: 100%;
      }

      .maplibregl-map {
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .maplibregl-popup-content {
        border-radius: 18px;
        padding: 12px;
        box-shadow: 0 18px 45px rgba(15,23,42,.18);
        border: 1px solid rgba(15,23,42,.08);
      }

      .maplibregl-popup-tip {
        border-top-color: #fff !important;
      }

      .havnMapMarkerWrap {
        background: transparent !important;
        border: 0 !important;
        cursor: pointer;
      }

      .havnMapMarker {
        position: relative;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-width: 74px;
        max-width: 112px;
        height: 32px;
        padding: 0 10px;
        border-radius: 999px;
        color: #fff;
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 11px;
        font-weight: 950;
        letter-spacing: -0.03em;
        line-height: 1;
        white-space: nowrap;
        border: 2px solid rgba(255,255,255,.96);
        box-shadow: 0 14px 30px rgba(15,23,42,.28), 0 3px 8px rgba(15,23,42,.18);
        cursor: pointer;
        user-select: none;
      }

      .havnMapMarker::after {
        content: "";
        position: absolute;
        left: 50%;
        bottom: -7px;
        width: 12px;
        height: 12px;
        transform: translateX(-50%) rotate(45deg);
        border-right: 2px solid rgba(255,255,255,.96);
        border-bottom: 2px solid rgba(255,255,255,.96);
      }

      .havnMapMarker.featured {
        background: linear-gradient(135deg, #f59e0b, #d97706);
      }

      .havnMapMarker.featured::after {
        background: #d97706;
      }

      .havnMapMarker.standard {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
      }

      .havnMapMarker.standard::after {
        background: #1d4ed8;
      }

      .havnMapMarker.reduced {
        background: linear-gradient(135deg, #16a34a, #15803d);
      }

      .havnMapMarker.reduced::after {
        background: #15803d;
      }

      .havnMarkerDot {
        width: 7px;
        height: 7px;
        border-radius: 999px;
        background: rgba(255,255,255,.96);
        box-shadow: 0 0 0 3px rgba(255,255,255,.22);
        flex: 0 0 auto;
      }

      .havnMapPopup {
        font-family: 'Plus Jakarta Sans', system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        min-width: 218px;
        max-width: 250px;
      }

      .havnMapPopupTop {
        display: flex;
        gap: 10px;
        align-items: flex-start;
      }

      .havnMapPopupImg {
        width: 72px;
        height: 58px;
        border-radius: 12px;
        object-fit: cover;
        background: #e5e7eb;
        flex: 0 0 auto;
      }

      .havnMapPopupTitle {
        font-size: 13px;
        font-weight: 950;
        color: #0b1220;
        line-height: 1.18;
        margin-bottom: 4px;
      }

      .havnMapPopupPrice {
        font-size: 13px;
        font-weight: 950;
        color: #0b1220;
        margin-bottom: 3px;
      }

      .havnMapPopupLoc {
        font-size: 11px;
        font-weight: 800;
        color: #64748b;
        line-height: 1.25;
      }

      .havnMapPopupFoot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 10px;
        padding-top: 9px;
        border-top: 1px solid rgba(15,23,42,.08);
      }

      .havnMapPopupBadge {
        border-radius: 999px;
        padding: 5px 8px;
        background: rgba(37,99,235,.08);
        color: #1d4ed8;
        font-size: 10px;
        font-weight: 950;
      }

      .havnMapPopupBadge.featured {
        background: rgba(245,158,11,.13);
        color: #92400e;
      }

      .havnMapPopupBadge.reduced {
        background: rgba(22,163,74,.12);
        color: #166534;
      }

      .havnMapPopupLink {
        color: #2563eb !important;
        text-decoration: none !important;
        font-size: 11px;
        font-weight: 950;
        white-space: nowrap;
      }

      .havn-map-control-row {
        position: absolute;
        right: 8px;
        bottom: 8px;
        z-index: 7;
        display: flex;
        align-items: flex-end;
        gap: 6px;
      }

      .havn-pan-pad {
        display: grid;
        grid-template-columns: 22px 22px 22px;
        grid-template-rows: 22px 22px 22px;
        gap: 2px;
      }

      .havn-map-zoom-stack {
        display: grid;
        grid-template-columns: 24px;
        grid-template-rows: 24px 24px;
        gap: 2px;
      }

      .havn-map-control-row button {
        border: 1px solid rgba(15,23,42,.14);
        background: rgba(255,255,255,.94);
        color: #0f172a;
        border-radius: 7px;
        font-size: 11px;
        font-weight: 950;
        line-height: 1;
        cursor: pointer;
        box-shadow: 0 5px 14px rgba(15,23,42,.12);
        backdrop-filter: blur(10px);
        font-family: inherit;
        padding: 0;
      }

      .havn-map-control-row button:hover {
        background: #f8fafc;
      }

      .havn-pan-empty {
        width: 22px;
        height: 22px;
        pointer-events: none;
      }
    `;

    document.head.appendChild(style);
  }

  function createPremiumMarkerElement(p) {
    injectMapMarkerStyles();
    
    const reduced = isActivePriceDrop(p);

    const featured = isActiveFeatured(p);
    const cls =
          featured ? "featured" :
          reduced ? "reduced" :
          "standard";
    const price = MODE === "rent" || MODE === "share"
        ? money(p.price).replace(".00", "")
        : compactMoney(p.price);

    const wrap = document.createElement("div");
    wrap.className = "havnMapMarkerWrap";
    wrap.innerHTML = `
      <div class="havnMapMarker ${cls}">
        <span class="havnMarkerDot"></span>
        <span class="havnMarkerPrice">${esc(price)}</span>
      </div>
    `;

    return wrap;
  }

  function ensureMapLibreMap() {
    const mapCanvas = document.querySelector(".mapCanvas");
    if (!mapCanvas || !window.maplibregl) return false;

    if (!document.getElementById("havnMapLibreMap")) {
      mapCanvas.innerHTML = `
        <div id="havnMapLibreMap"></div>
        <div class="mapControls" style="z-index:5;">
          <button class="mapToggle" type="button">Search as I move</button>
        </div>
        <div class="havn-map-control-row">
          <div class="havn-pan-pad">
            <span class="havn-pan-empty"></span>
            <button type="button" data-pan="up">▲</button>
            <span class="havn-pan-empty"></span>

            <button type="button" data-pan="left">◀</button>
            <button type="button" data-pan="home">⌂</button>
            <button type="button" data-pan="right">▶</button>

            <span class="havn-pan-empty"></span>
            <button type="button" data-pan="down">▼</button>
            <span class="havn-pan-empty"></span>
          </div>

          <div class="havn-map-zoom-stack">
            <button type="button" data-zoom="in">+</button>
            <button type="button" data-zoom="out">−</button>
          </div>
        </div>
      `;
    }

    if (!MAP) {
      injectMapMarkerStyles();

      MAP = new maplibregl.Map({
        container: "havnMapLibreMap",
        style: MAPTILER_STYLE,
        center: [-8.2439, 53.4129],
        zoom: 5.8,
        attributionControl: false,
        scrollZoom: false
      });

      MAP.addControl(
        new maplibregl.AttributionControl({ compact: true }),
        "bottom-left"
      );
      

      const controlRow = mapCanvas.querySelector(".havn-map-control-row");
      if (controlRow && !controlRow.dataset.wired) {
        controlRow.dataset.wired = "1";

        const panAmount = 120;

        controlRow.addEventListener("click", function (e) {
          const btn = e.target.closest("button");
          if (!btn || !MAP) return;

          e.preventDefault();

          const pan = btn.getAttribute("data-pan");
          const zoom = btn.getAttribute("data-zoom");

          if (pan === "up") MAP.panBy([0, -panAmount]);
          if (pan === "down") MAP.panBy([0, panAmount]);
          if (pan === "left") MAP.panBy([-panAmount, 0]);
          if (pan === "right") MAP.panBy([panAmount, 0]);

          if (pan === "home") {
            updateMapIntelligence(CURRENT_FILTERED, CURRENT_NEARBY);
          }

          if (zoom === "in") MAP.zoomIn();
          if (zoom === "out") MAP.zoomOut();
        });
      }
    }

    setTimeout(function () {
      try { MAP.resize(); } catch {}
    }, 100);

    return true;
  }

  function clearMapMarkers() {
    if (!MARKERS.length) return;

    MARKERS.forEach(function (m) {
      try { m.remove(); } catch {}
    });

    MARKERS = [];
  }

  function setStaticMapFallback(all) {
    const mapCanvas = document.querySelector(".mapCanvas");
    if (!mapCanvas) return;

    const dots = (all || []).slice(0, 12).map(function (p, i) {
      const left = 18 + ((i * 23) % 62);
      const top = 22 + ((i * 17) % 48);
      const featured = isActiveFeatured(p);
      const price = compactMoney(p.price);

      return `
        <button
          type="button"
          class="mapPin"
          title="${esc(shortAddress(p))}"
          style="left:${left}%;top:${top}%;background:${featured ? "#f59e0b" : "#2563eb"};min-width:58px;padding:0 10px;">
          ${esc(price)}
        </button>
      `;
    }).join("");

    mapCanvas.innerHTML = `
      <div class="mapGridLines"></div>
      <div class="mapControls">
        <button class="mapToggle" type="button">Search as I move</button>
      </div>
      ${dots}
    `;
  }

  async function updateMapIntelligence(filtered, nearbyFiltered) {
    const mapSub = document.querySelector(".mapPanel .panelSub");
    const all = filtered.concat(nearbyFiltered || []);

    if (mapSub) {
      mapSub.textContent = all.length
        ? "MapLibre + MapTiler map from current results" + (MAP_MOVE_SEARCH ? " · search-as-move on" : "")
        : "No matching listings in the current result set.";
    }

    if (!window.maplibregl || !ensureMapLibreMap()) {
      setStaticMapFallback(all);
      return;
    }

    clearMapMarkers();

    if (!all.length) {
      MAP.setCenter([-8.2439, 53.4129]);
      MAP.setZoom(5.8);
      return;
    }

    const bounds = new maplibregl.LngLatBounds();
    let boundsCount = 0;

    for (const [index, p] of all.slice(0, 80).entries()) {
      const coord = await getCoordForProperty(p, index);
      const lat = coord[0];
      const lng = coord[1];
      const exact = coord[2];

      const title = displayTitle(p);
      const price = MODE === "rent" || MODE === "share"
        ? money(p.price) + " pcm"
        : money(p.price);
      const loc = shortAddress(p);
      const slug = getFirstDefined(p.slug, p.publicSlug, p.propertySlug, p.id);
      const featured = isActiveFeatured(p);
      const thumb = getThumb(p);

      const markerElement = createPremiumMarkerElement(p);

      const popup = new maplibregl.Popup({
        offset: 34,
        closeButton: false,
        closeOnClick: true
      }).setHTML(`
        <div class="havnMapPopup">
          <div class="havnMapPopupTop">
            ${thumb ? `<img class="havnMapPopupImg" src="${esc(thumb)}" alt="${esc(title)}">` : ""}
            <div>
              <div class="havnMapPopupTitle">${esc(title)}</div>
              <div class="havnMapPopupPrice">${esc(price)}</div>
              <div class="havnMapPopupLoc">${esc(loc)}${exact ? "" : " · approximate"}</div>
            </div>
          </div>
          <div class="havnMapPopupFoot">
            <span class="havnMapPopupBadge${
             featured ? " featured" :
         isActivePriceDrop(p) ? " reduced" :
            ""
            }">
            ${
             featured
             ? "Featured"
            : isActivePriceDrop(p)
            ? "Reduced"
             : "Listing"
                }
            </span>
            <a class="havnMapPopupLink" href="/property.html?slug=${encodeURIComponent(slug)}">Open listing →</a>
          </div>
        </div>
      `);

      const marker = new maplibregl.Marker({
        element: markerElement,
        anchor: "bottom"
      })
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(MAP);

      MARKERS.push(marker);
      bounds.extend([lng, lat]);
      boundsCount += 1;
    }

    if (boundsCount === 1) {
      const center = bounds.getCenter();
      MAP.setCenter(center);
      MAP.setZoom(12);
    } else if (boundsCount > 1) {
      MAP.fitBounds(bounds, {
        padding: 34,
        maxZoom: 16
      });
    }

    setTimeout(function () {
      try { MAP.resize(); } catch {}
    }, 150);
  }

  function matchesUrlAdvancedFilters(p) {
    const txt = getPropertyText(p);

    if (FILTERS.berBand) {
      const ber = String(p.berRating || p.ber || "").trim().toUpperCase();

      if (FILTERS.berBand === "a-b" && !["A1", "A2", "A3", "B1", "B2", "B3"].includes(ber)) return false;
      if (FILTERS.berBand === "c-d" && !["C1", "C2", "C3", "D1", "D2"].includes(ber)) return false;
      if (FILTERS.berBand === "e-g" && !["E1", "E2", "F", "G"].includes(ber)) return false;
    }

    if (FILTERS.furnished) {
      const furnished = String(p.furnished || "").toLowerCase();
      if (FILTERS.furnished === "yes" && !(furnished === "yes" || furnished === "true" || furnished === "furnished")) return false;
      if (FILTERS.furnished === "no" && (furnished === "yes" || furnished === "true" || furnished === "furnished")) return false;
    }

    if (FILTERS.ensuite) {
      const ensuite = String(p.ensuite || "").toLowerCase();
      if (FILTERS.ensuite === "yes" && !(ensuite === "yes" || ensuite === "true")) return false;
      if (FILTERS.ensuite === "no" && (ensuite === "yes" || ensuite === "true")) return false;
    }

    if (FILTERS.couplesAllowed) {
      const couples = String(p.couplesAllowed || "").toLowerCase();
      if (FILTERS.couplesAllowed === "yes" && !(couples === "yes" || couples === "true")) return false;
      if (FILTERS.couplesAllowed === "no" && (couples === "yes" || couples === "true")) return false;
    }

    if (FILTERS.billsIncluded) {
      const bills = String(p.billsIncluded || "").toLowerCase();
      if (FILTERS.billsIncluded === "yes" && !(bills === "yes" || bills === "true")) return false;
      if (FILTERS.billsIncluded === "no" && (bills === "yes" || bills === "true")) return false;
    }

    if (FILTERS.roomType) {
      const roomType = String(p.roomType || "").toLowerCase();

      if (FILTERS.roomType === "single-room" && !(roomType.includes("single") || txt.includes("single room"))) return false;
      if (FILTERS.roomType === "double-room" && !(roomType.includes("double") || txt.includes("double room"))) return false;
      if (FILTERS.roomType === "studio" && !(roomType.includes("studio") || txt.includes("studio"))) return false;
    }

    return true;
  }

function getBaseItems() {
  return ALL_ITEMS
    .filter(isRenderablePublicListing)
    .filter(matchesPrice)
    .filter(matchesBeds)
    .filter(matchesType)
    .filter(matchesUrlAdvancedFilters)
    .filter(matchesMustHaves);
}

  function render() {
    if (!grid) return;

    FILTERS.q = getSearchValue();

    const baseItems = getBaseItems();

    const filtered = baseItems
      .map(function (p) {
        return {
          item: p,
          featured: isActiveFeatured(p) ? 1 : 0,
          priceDrop: isActivePriceDrop(p) ? 1 : 0,
          score: getLocationScore(p, FILTERS.q),
          time: Date.parse(p.publishedAt || p.createdAt || "")
        };
      })
      .filter(function (obj) { return matchesSearch(obj.item, FILTERS.q); })
      .sort(function (a, b) {
        if (SORT.value === "best") {
          if (b.featured !== a.featured) return b.featured - a.featured;
          if (b.priceDrop !== a.priceDrop) return b.priceDrop - a.priceDrop;
          if (b.score !== a.score) return b.score - a.score;
          return (Number.isFinite(b.time) ? b.time : 0) - (Number.isFinite(a.time) ? a.time : 0);
        }
        if (SORT.value === "newest") {
          if (b.featured !== a.featured) return b.featured - a.featured;
          if (b.priceDrop !== a.priceDrop) return b.priceDrop - a.priceDrop;
          return (Number.isFinite(b.time) ? b.time : 0) - (Number.isFinite(a.time) ? a.time : 0);
        }
        if (SORT.value === "price_low") {
          if (b.featured !== a.featured) return b.featured - a.featured;
          if (b.priceDrop !== a.priceDrop) return b.priceDrop - a.priceDrop;
          return (Number(a.item.price) || 0) - (Number(b.item.price) || 0);
        }
        if (SORT.value === "price_high") {
          if (b.featured !== a.featured) return b.featured - a.featured;
          if (b.priceDrop !== a.priceDrop) return b.priceDrop - a.priceDrop;
          return (Number(b.item.price) || 0) - (Number(a.item.price) || 0);
        }
        return 0;
      })
      .map(function (obj) { return obj.item; });

    const nearbyFiltered = baseItems
      .map(function (p) {
        return {
          item: p,
          featured: isActiveFeatured(p) ? 1 : 0,
          priceDrop: isActivePriceDrop(p) ? 1 : 0,
          score: getLocationScore(p, FILTERS.q),
          time: Date.parse(p.publishedAt || p.createdAt || "")
        };
      })
      .filter(function (obj) {
        return FILTERS.q &&
          isKnownLocationQuery(norm(FILTERS.q)) &&
          !matchesSearch(obj.item, FILTERS.q) &&
          matchesNearbyArea(obj.item, FILTERS.q);
      })
      .sort(function (a, b) {
        if (b.featured !== a.featured) return b.featured - a.featured;
        if (b.priceDrop !== a.priceDrop) return b.priceDrop - a.priceDrop;
        if (b.score !== a.score) return b.score - a.score;
        return (Number.isFinite(b.time) ? b.time : 0) - (Number.isFinite(a.time) ? a.time : 0);
      })
      .map(function (obj) { return obj.item; });

    CURRENT_FILTERED = filtered;
    CURRENT_NEARBY = nearbyFiltered;

    const totalCount = filtered.length + nearbyFiltered.length;
            if (countChip) {
          countChip.textContent = totalCount === 1
            ? "1 listing"
            : totalCount + " listings";
        }

// Subtitle is now static in properties.html

    syncControlsFromFilters();
    updateUrl();
    updateInsights(filtered, nearbyFiltered);
    updateMapIntelligence(filtered, nearbyFiltered);

    if (!filtered.length && !nearbyFiltered.length) {
      grid.innerHTML = "";
      renderNearbySection([], FILTERS.q);
      showNotice("No published listings found. Try broadening your filters.", "info");
      return;
    }

    if (!filtered.length && nearbyFiltered.length) {
      grid.innerHTML = "";
      if (notice) {
        notice.style.display = "none";
        notice.textContent = "";
      }
      renderNearbySection(nearbyFiltered, FILTERS.q);
      return;
    }

    if (notice && !MAP_MOVE_SEARCH) {
      notice.style.display = "none";
      notice.textContent = "";
    }

    grid.innerHTML = filtered.map(function (p, index) {
      return buildCard(p, { isTopMatch: index === 0 });
    }).join("");

    renderNearbySection(nearbyFiltered, FILTERS.q);
  }

  function setButtonActiveByText(textNeedle, active) {
    const wanted = norm(textNeedle);

    document.querySelectorAll(".actionChip, .mapToggle").forEach(function (btn) {
      const text = norm(btn.textContent || "");
      if (!text.includes(wanted)) return;

      btn.style.background = active ? "rgba(37,99,235,0.10)" : "";
      btn.style.borderColor = active ? "rgba(37,99,235,0.24)" : "";
      btn.style.color = active ? "#1d4ed8" : "";
    });
  }

    function wireAutocomplete() {
      if (!searchInput || !suggestBox) return;
    
      searchInput.addEventListener("input", function () {
        FILTERS.q = searchInput.value.trim();
        render();
    
        const q = searchInput.value.trim();
    
        if (!q) {
          closeSuggestions();
          return;
        }
    
        openSuggestions(
          HAVN_LOCATION_HELPERS.search(q, 10)
        );
      });
    
      searchInput.addEventListener("focus", function () {
        const q = searchInput.value.trim();
    
        if (!q) return;
    
        openSuggestions(
          HAVN_LOCATION_HELPERS.search(q, 10)
        );
      });
    
      searchInput.addEventListener("search", function () {
        FILTERS.q = searchInput.value.trim();
        render();
        closeSuggestions();
      });
    
      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          FILTERS.q = searchInput.value.trim();
          render();
          closeSuggestions();
        }
    
        if (e.key === "Escape") {
          closeSuggestions();
        }
      });
    
      document.addEventListener("click", function (e) {
        if (!suggestBox.contains(e.target) && e.target !== searchInput) {
          closeSuggestions();
        }
      });
    }

  function closeSuggestions() {
    if (!suggestBox) return;
    suggestBox.style.display = "none";
    suggestBox.innerHTML = "";
  }

    function openSuggestions(matches) {
      if (!suggestBox || !searchInput) return;
    
      if (!matches.length) {
        closeSuggestions();
        return;
      }
    
      suggestBox.innerHTML = matches.slice(0, 10).map(function (item) {
        return `
          <button
            class="suggestItem"
            type="button"
            data-name="${esc(HAVN_LOCATION_HELPERS.displayName(item))}"
          >
            <span>${esc(HAVN_LOCATION_HELPERS.displayName(item))}</span>
            <span class="suggestType">${esc(item.type)}</span>
          </button>
        `;
      }).join("");
    
      suggestBox.style.display = "block";
    
      suggestBox.querySelectorAll(".suggestItem").forEach(function (btn) {
        btn.addEventListener("click", function () {
          searchInput.value = btn.getAttribute("data-name") || "";
          FILTERS.q = searchInput.value.trim();
    
          closeSuggestions();
          render();
        });
      });
    }

function clearAllFilters(){
  FILTERS.q = "";
  FILTERS.price = "";
  FILTERS.beds = "";
  FILTERS.baths = "";
  FILTERS.type = "";
  FILTERS.roomType = "";
  FILTERS.berBand = "";
  FILTERS.furnished = "";
  FILTERS.ensuite = "";
  FILTERS.couplesAllowed = "";
  FILTERS.billsIncluded = "";
  FILTERS.commute = "";
  FILTERS.mustHaves = new Set();

  COMMUTE_DESTINATION = "";
    MAP_MOVE_SEARCH = false;
    SORT.value = "best";

  if(searchInput) searchInput.value = "";

  const advanced = document.getElementById("haloAdvancedFilters");
  const label = document.getElementById("moreFiltersLabel");
  const arrow = document.getElementById("moreFiltersArrow");

  if(advanced) advanced.style.display = "none";
  if(label) label.textContent = "More filters";
  if(arrow) arrow.textContent = "⌄";

  render();
}




  function wireHeroFilters() {
    if (heroPrice) heroPrice.addEventListener("change", function () { FILTERS.price = normaliseSelectPrice(heroPrice.value); render(); });
    if (heroBeds) heroBeds.addEventListener("change", function () { FILTERS.beds = normaliseBeds(heroBeds.value); render(); });
    if (heroType) heroType.addEventListener("change", function () { FILTERS.type = normaliseType(heroType.value); render(); });

    document.querySelectorAll(".searchBtnElite").forEach(function (btn) {
      btn.addEventListener("click", function () {
        FILTERS.q = getSearchValue();
        FILTERS.price = heroPrice ? normaliseSelectPrice(heroPrice.value) : FILTERS.price;
        FILTERS.beds = heroBeds ? normaliseBeds(heroBeds.value) : FILTERS.beds;
        FILTERS.type = heroType ? normaliseType(heroType.value) : FILTERS.type;
        render();
      });
    });
 
 const clearAllBtn = document.getElementById("clearAllBtn");
if(clearAllBtn){
  clearAllBtn.addEventListener("click", function(e){
    e.preventDefault();
    clearAllFilters();
  });
}
 
 
  }

  function wireLeftPanelFilters() {
    document.querySelectorAll(".filterGroup").forEach(function (group) {
      const label = norm(group.querySelector(".filterLabel") ? group.querySelector(".filterLabel").textContent : "");

      group.querySelectorAll(".miniPill").forEach(function (pill) {
        pill.addEventListener("click", function () {
          const text = norm(pill.textContent);

          if (label.includes("property type")) {
            const type = normaliseType(pill.textContent);
            FILTERS.type = text === "any" ? "" : type;
          }

          if (label.includes("budget")) {
            const price = normaliseSelectPrice(pill.textContent);
            FILTERS.price = text === "any" ? "" : price;
          }

          render();
        });
      });

      group.querySelectorAll(".checkItem input").forEach(function (input) {
        input.addEventListener("change", function () {
          const parent = input.closest(".checkItem");
          const key = norm(parent ? parent.textContent : "");
          if (!key) return;

          if (input.checked) FILTERS.mustHaves.add(key);
          else FILTERS.mustHaves.delete(key);

          render();
        });
      });
    });
  }

    function wireSortControl() {
      const sortBtn = document.querySelector(".sortBtn");
      if (!sortBtn) return;
    
      const wrap = document.createElement("label");
      wrap.className = "sortSelectWrap";
      wrap.innerHTML = `
        <span>Sort:</span>
        <select id="sortSelect" class="softBtn" aria-label="Sort listings">
          <option value="best">Best match</option>
          <option value="newest">Newest</option>
          <option value="price_low">Price low → high</option>
          <option value="price_high">Price high → low</option>
        </select>
      `;
    
      sortBtn.replaceWith(wrap);
    
      const sortSelect = document.getElementById("sortSelect");
      if (!sortSelect) return;
    
      sortSelect.value = SORT.value;
    
      sortSelect.addEventListener("change", function () {
        SORT.value = sortSelect.value || "best";
        render();
      });
    }

  function getCurrentSearchPayload() {
    const q = getSearchValue();
    const price = heroPrice ? normaliseSelectPrice(heroPrice.value) : FILTERS.price || "";
    const beds = heroBeds ? normaliseBeds(heroBeds.value) : FILTERS.beds || "";
    const type = heroType ? normaliseType(heroType.value) : FILTERS.type || "";

    FILTERS.q = q;
    FILTERS.price = price;
    FILTERS.beds = beds;
    FILTERS.type = type;
    FILTERS.commute = COMMUTE_DESTINATION || FILTERS.commute || "";

    return {
      q: FILTERS.q || "",
      price: FILTERS.price || "",
      beds: FILTERS.beds || "",
      baths: FILTERS.baths || "",
      type: FILTERS.type || "",
      roomType: FILTERS.roomType || "",

      berBand: FILTERS.berBand || "",
      furnished: FILTERS.furnished || "",
      ensuite: FILTERS.ensuite || "",
      couplesAllowed: FILTERS.couplesAllowed || "",
      billsIncluded: FILTERS.billsIncluded || "",

      mode: MODE,
      commute: FILTERS.commute || "",
      mustHaves: Array.from(FILTERS.mustHaves || []),
      mapMoveSearch: MAP_MOVE_SEARCH,
      savedAt: new Date().toISOString()
    };
  }

  function getSavedSearchName(payload) {
    const bits = [];
    if (payload.q) bits.push(payload.q);
    if (payload.price) bits.push(payload.price);
    if (payload.beds) bits.push(payload.beds + "+ beds");
    if (payload.type) bits.push(payload.type.toLowerCase());
    if (payload.mode) bits.push(payload.mode);
    if (payload.mustHaves && payload.mustHaves.length) bits.push(payload.mustHaves.join(", "));
    if (payload.commute) bits.push("commute: " + payload.commute);
    return bits.length ? bits.join(" · ") : "My saved search";
  }

  async function saveSearchPayload(extra) {
    const token = getAuthToken();

    if (!token) {
      const next = window.location.pathname + window.location.search;
      window.location.href = "/login.html?next=" + encodeURIComponent(next);
      return null;
    }

    const payload = Object.assign({}, getCurrentSearchPayload(), extra || {});

    const res = await fetch(API_BASE + "/api/auth/saved-searches", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify({
        name: getSavedSearchName(payload),
        filters: payload
      })
    });

    const data = await res.json().catch(function () { return null; });
    if (!res.ok || !data || !data.ok) throw new Error((data && data.message) || "Failed to save search");
    return data;
  }

  function wireDelegatedActions() {
    document.addEventListener("click", async function (e) {
      const btn = e.target.closest(".actionChip, .mapToggle, .softBtn, .fullBtn");
      if (!btn) return;

      const text = norm(btn.textContent || "");
            if (text.includes("clear all")) {
        e.preventDefault();
        clearAllFilters();
        return;
      }

      if (text.includes("live alerts") || text === "alerts" || text.includes("email updates")) {
        e.preventDefault();
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Creating alert…";

        try {
          await saveSearchPayload({ alertsEnabled: true, alertFrequency: "instant", alertChannel: "email" });
          btn.textContent = "Alert saved ✓";
          temporaryNotice("Email alert saved. We’ll use this search for matching listing updates.", "success");
        } catch (err) {
          btn.textContent = "Could not save";
          temporaryNotice(err.message || "Could not create alert.", "warning");
        }

        setTimeout(function () {
          btn.disabled = false;
          btn.textContent = originalText;
        }, 1800);

        return;
      }

      if (text.includes("save search") || text === "save") {
        e.preventDefault();
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = "Saving…";

        try {
          await saveSearchPayload({ alertsEnabled: false });
          btn.textContent = "Saved ✓";
          temporaryNotice("Search saved to your account.", "success");
        } catch (err) {
          btn.textContent = "Could not save";
          temporaryNotice(err.message || "Could not save search.", "warning");
        }

        setTimeout(function () {
          btn.disabled = false;
          btn.textContent = originalText;
        }, 1600);

        return;
      }

      if (text.includes("commute")) {
        e.preventDefault();

        const existing = COMMUTE_DESTINATION || FILTERS.commute || "";
        const value = window.prompt("Enter your commute destination, for example: Dublin city centre, IFSC, Sandyford, Cork city", existing);
        if (value === null) return;

        COMMUTE_DESTINATION = String(value || "").trim();
        FILTERS.commute = COMMUTE_DESTINATION;

        temporaryNotice(
          COMMUTE_DESTINATION ? "Commute preference saved: " + COMMUTE_DESTINATION : "Commute preference cleared.",
          COMMUTE_DESTINATION ? "success" : "info"
        );

        render();
        return;
      }

      if (text.includes("insights")) {
        e.preventDefault();
        updateInsights(CURRENT_FILTERED, CURRENT_NEARBY);
        updateMapIntelligence(CURRENT_FILTERED, CURRENT_NEARBY);
        temporaryNotice("Area insights updated from the current published results.", "success");
        return;
      }

      if (text.includes("search as i move")) {
        e.preventDefault();

        MAP_MOVE_SEARCH = !MAP_MOVE_SEARCH;
        setButtonActiveByText("search as i move", MAP_MOVE_SEARCH);

        temporaryNotice(
          MAP_MOVE_SEARCH ? "Search as I move is on. Map now follows the current result set." : "Search as I move is off.",
          MAP_MOVE_SEARCH ? "success" : "info"
        );

        render();
        return;
      }

      if (text.includes("compare")) {
        e.preventDefault();
        const count = CURRENT_FILTERED.length;
        temporaryNotice(
          count ? "Compare ready: using the top " + Math.min(count, 3) + " matching listings." : "No listings available to compare.",
          count ? "success" : "warning"
        );
      }
    });
  }

 function wirePhotoArrows() {
  function setCardPhoto(wrap, index) {
    if (!wrap) return;

    const img = wrap.querySelector(".prop-thumb");
    if (!img) return;

    let photos = [];

    try {
      photos = JSON.parse(wrap.getAttribute("data-photos") || "[]");
    } catch {
      photos = [];
    }

    photos = photos.filter(Boolean);

    if (!photos.length) return;

    if (!Number.isFinite(index)) index = 0;
    index = ((index % photos.length) + photos.length) % photos.length;

    wrap.setAttribute("data-photo-index", String(index));
    img.src = photos[index];

    const dots = wrap.querySelectorAll(".havnPhotoDots span");
    dots.forEach(function (dot, dotIndex) {
      dot.classList.toggle("active", dotIndex === index);
    });

    const count = wrap.querySelector(".havnPhotoCount");
    if (count) {
      count.textContent = (index + 1) + " / " + photos.length;
    }

    const labels = wrap.querySelectorAll(".featuredPhotoLabels span");
    labels.forEach(function (label) {
      const labelIndex = Number(label.getAttribute("data-photo-label-index"));
      label.classList.toggle("active", labelIndex === index);
    });

    const miniThumbs = wrap.querySelectorAll(".featuredSidePhoto");
    miniThumbs.forEach(function (thumb) {
      const thumbIndex = Number(thumb.getAttribute("data-photo-index"));
      thumb.classList.toggle("active", thumbIndex === index);
    });
  }

  document.addEventListener("click", function (e) {
    const mini = e.target.closest(".featuredSidePhoto");
    if (mini) {
      e.preventDefault();
      e.stopPropagation();

      const wrap = mini.closest(".cardPhotoWrap");
      const index = Number(mini.getAttribute("data-photo-index") || "0");

      setCardPhoto(wrap, index);
      return;
    }

    const arrow = e.target.closest(".cardPhotoArrow");
    if (!arrow) return;

    e.preventDefault();
    e.stopPropagation();

    const wrap = arrow.closest(".cardPhotoWrap");
    if (!wrap) return;

    let photos = [];

    try {
      photos = JSON.parse(wrap.getAttribute("data-photos") || "[]");
    } catch {
      photos = [];
    }

    photos = photos.filter(Boolean);

    if (photos.length <= 1) return;

    let index = Number(wrap.getAttribute("data-photo-index") || "0");
    if (!Number.isFinite(index)) index = 0;

    if (arrow.classList.contains("next")) {
      index = index + 1;
    } else {
      index = index - 1;
    }

    setCardPhoto(wrap, index);
  }, true);
}


        function preloadCardPhotos() {
          document.querySelectorAll(".cardPhotoWrap").forEach(function (wrap) {
            let photos = [];
        
            try {
              photos = JSON.parse(wrap.getAttribute("data-photos") || "[]");
            } catch {
              photos = [];
            }
        
            photos.filter(Boolean).forEach(function (src) {
              const img = new Image();
              img.src = src;
            });
          });
        }




  async function init() {
    if (modeChip) modeChip.textContent = "Mode: " + MODE;

    updateModeSpecificFilters();
    wireAutocomplete();
    wireHeroFilters();
    wireLeftPanelFilters();
    wireSortControl();
    wireDelegatedActions();
    wirePhotoArrows();
    syncControlsFromFilters();

    try {
      showNotice("Loading listings…", "info");

      try {
        await loadMapLibreAssets();
      } catch (mapErr) {
        console.warn("MapLibre failed to load, using static fallback:", mapErr);
      }

      ALL_ITEMS = await fetchProperties();
      ALL_ITEMS = sortItems(ALL_ITEMS);
      console.log("Filtered items:", ALL_ITEMS.map(p => p.title));

      render();
    } catch (err) {
      if (grid) grid.innerHTML = "";
      if (countChip) countChip.textContent = "— listings";
      showNotice("Could not load listings.", "warning");
      console.error(err);
    }
  }

  init();
})();