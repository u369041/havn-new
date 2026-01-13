<script>
(async function(){
  const cfg = $cfg();
  const slug = $qs("slug");
  if (!slug) {
    alert("No property slug provided.");
    return;
  }

  // ---- Fetch detail first (hydrate pattern preserved)
  const detail = await fetchJSON(`${cfg.API_BASE}/api/properties/${encodeURIComponent(slug)}`);
  if (!detail || !detail.ok) {
    console.error("Fetch detail failed:", detail);
    alert("Could not load this property.");
    return;
  }
  const p = detail.property || detail.data || detail; // tolerate shapes

  // ----- Bind top facts
  set("#title", p.title || "Untitled");
  set("#address", fmtAddress(p));
  set("#price", p.price ? euro(p.price) : "Price on request");
  set("#chipRef", "REF-" + (p.id || p.slug || "NA"));
  set("#quickMeta", [
    safe(p.bedrooms) ? `${p.bedrooms} bed` : null,
    safe(p.bathrooms) ? `${p.bathrooms} bath` : null,
    p.size ? `${p.size} ${p.sizeUnits || "sq ft"}` : null,
    p.propertyType || null,
    p.ber || null
  ].filter(Boolean).join(" • "));

  // chips: status, tenancy etc.
  const chips = document.querySelector("#chips");
  (p.status ? [p.status] : []).concat(p.tenure ? [p.tenure] : []).forEach(t=>{
    const span = document.createElement("span"); span.className="chip"; span.textContent=t; chips.appendChild(span);
  });

  // ----- Overview / Features / Details
  setHTML("#overview", nl2br(p.description || p.overview || "No overview provided."));
  const feats = arrish(p.features) || [];
  const ul = $("#features");
  if (feats.length) feats.forEach(f=>{ const li=document.createElement("li"); li.textContent=f; ul.appendChild(li); });
  else { ul.innerHTML = `<li>No features specified.</li>`; }

  const details = $("#details");
  kv(details, "EIRCODE", p.eircode);
  kv(details, "Property type", p.propertyType);
  kv(details, "BER", p.ber);
  kv(details, "Size", p.size ? `${p.size} ${p.sizeUnits||"sq ft"}` : null);
  kv(details, "Year built", p.yearBuilt);
  kv(details, "Listing date", p.createdAt ? new Date(p.createdAt).toLocaleDateString() : null);

  // ----- Gallery
  const photos = arrish(p.photos) || [];
  buildGallery(photos, p.title || "Property photo");

  // ----- Map (Eircode-first, fallback to address)
  const eir = p.eircode || p.postcode || "";
  set("#eircodeLine", eir ? `Eircode: ${eir}` : "Eircode not provided");
  await loadGoogleMaps(cfg.GMAPS_API_KEY);
  const loc = await geocodeByPriority({ eircode: eir, address: fullAddressString(p) });
  drawMap("map", loc);

  // ----- CTAs
  $("#ctaCall").addEventListener("click", ()=>{
    const phone = p.agentPhone || p.phone || "";
    if (phone) location.href = `tel:${phone}`;
    else alert("No agent phone on file.");
  });
  $("#ctaSave").addEventListener("click", ()=>{
    try {
      const key = "havn_saved";
      const cur = JSON.parse(localStorage.getItem(key) || "[]");
      const exists = cur.find(x=>x.slug===p.slug);
      if (!exists) cur.push({slug:p.slug,title:p.title,ts:Date.now()});
      localStorage.setItem(key, JSON.stringify(cur));
      $("#ctaSave").textContent = "✓ Saved";
    } catch(e){ console.warn(e); }
  });

  // ----------------- helpers -----------------
  function $(sel){ return document.querySelector(sel); }
  function set(sel, txt){ const el=$(sel); if (el) el.textContent = txt ?? ""; }
  function setHTML(sel, html){ const el=$(sel); if (el) el.innerHTML = html; }
  function safe(v){ return v!==undefined && v!==null && v!==""; }
  function arrish(v){ if (!v) return []; return Array.isArray(v) ? v : typeof v==="string" ? v.split(/\s*,\s*/).filter(Boolean) : []; }
  function euro(n){ try{return n.toLocaleString("en-IE",{style:"currency",currency:"EUR",maximumFractionDigits:0});}catch{ return "€"+(n||"") } }
  function nl2br(s){ return (s||"").replace(/\n/g,"<br/>"); }
  function fmtAddress(p){
    return [p.address1,p.address2,p.city,p.county,p.postcode||p.eircode,"Ireland"].filter(Boolean).join(", ");
  }
  function fullAddressString(p){
    return [p.address1,p.address2,p.city,p.county,"Ireland"].filter(Boolean).join(", ");
  }
  function kv(root, k, v){
    if (!v) return;
    const d=document.createElement("div"); d.innerHTML=`<strong>${k}:</strong> ${escapeHTML(v)}`;
    root.appendChild(d);
  }
  function escapeHTML(str){ return String(str).replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;" }[m])); }

  async function fetchJSON(url){
    const r = await fetch(url, {headers:{"Accept":"application/json"}});
    return r.ok ? r.json() : null;
  }

  // ------------- Gallery + Lightbox -------------
  function buildGallery(photos, altBase){
    const rail = $("#thumbRail");
    const hero = $("#heroImg");
    const cap = $("#heroCaption");
    const zoom = $("#zoomBtn");
    if (!photos.length){
      hero.src = "https://dummyimage.com/1200x800/ddd/666&text=No+photos";
      cap.textContent = "No photos available";
      return;
    }
    let idx = 0;

    photos.forEach((src,i)=>{
      const im = document.createElement("img");
      im.loading = "lazy";
      im.src = src;
      im.alt = `${altBase} — photo ${i+1}`;
      im.className = "thumb" + (i===0?" active":"");
      im.addEventListener("click", ()=>{ setIdx(i); });
      rail.appendChild(im);
    });

    function setIdx(i){
      idx = i;
      hero.src = photos[i];
      cap.textContent = `${i+1} / ${photos.length}`;
      document.querySelectorAll(".thumb").forEach((t,ti)=>t.classList.toggle("active", ti===i));
      // update lightbox if open
      if (!$("#lightbox").classList.contains("hidden")) showLightbox(i);
    }

    setIdx(0);

    // Lightbox
    zoom.addEventListener("click", ()=> showLightbox(idx));
    hero.addEventListener("click", ()=> showLightbox(idx));
    $("#lbClose").addEventListener("click", closeLightbox);
    $("#lbPrev").addEventListener("click", ()=> nav(-1));
    $("#lbNext").addEventListener("click", ()=> nav(1));
    document.addEventListener("keydown", (e)=>{
      if ($("#lightbox").classList.contains("hidden")) return;
      if (e.key==="Escape") closeLightbox();
      if (e.key==="ArrowRight") nav(1);
      if (e.key==="ArrowLeft") nav(-1);
    });

    function nav(delta){
      const next = (idx + delta + photos.length) % photos.length;
      setIdx(next);
    }

    function showLightbox(i){
      const lb = $("#lightbox");
      lb.classList.remove("hidden");
      lb.setAttribute("aria-hidden","false");
      $("#lbImg").src = photos[i];
      $("#lbCounter").textContent = `${i+1} / ${photos.length}`;
      document.body.style.overflow = "hidden";
    }
    function closeLightbox(){
      const lb = $("#lightbox");
      lb.classList.add("hidden");
      lb.setAttribute("aria-hidden","true");
      document.body.style.overflow = "";
    }
  }

  // ------------- Google Maps + Geocoding -------------
  async function loadGoogleMaps(apiKey){
    if (!apiKey){ console.warn("No GMAPS_API_KEY set in config.js"); return; }
    if (window.google && window.google.maps) return;
    await new Promise((resolve, reject)=>{
      const s = document.createElement("script");
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=geocoding,marker`;
      s.async = true; s.defer = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function geocodeByPriority({eircode, address}){
    // eircode-first (fast path)
    if (eircode) {
      const r1 = await geocode(eircode);
      if (r1) return r1;
    }
    // fallback address string
    if (address) {
      const r2 = await geocode(address);
      if (r2) return r2;
    }
    // final fallback: Ireland centroid
    return {lat:53.35014, lng:-6.266155}; // Dublin fallback
  }

  async function geocode(query){
    try{
      if (!(window.google && google.maps)) return null;
      const geocoder = new google.maps.Geocoder();
      const result = await new Promise((resolve)=>{
        geocoder.geocode({ address: query }, (res, status)=> resolve(status==="OK" && res && res[0] ? res[0] : null));
      });
      if (!result) return null;
      const loc = result.geometry.location;
      return { lat: loc.lat(), lng: loc.lng() };
    }catch(e){ console.warn(e); return null; }
  }

  function drawMap(elId, center){
    if (!(window.google && google.maps)) {
      document.getElementById(elId).innerHTML = `<div class="meta">Map unavailable (missing API key).</div>`;
      return;
    }
    const map = new google.maps.Map(document.getElementById(elId), {
      center, zoom: 15, mapTypeControl:false, streetViewControl:false, fullscreenControl:true
    });
    new google.maps.Marker({ map, position:center });
  }
})();
</script>
