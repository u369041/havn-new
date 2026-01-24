(function () {
  const grid = document.getElementById("grid");
  const modeChip = document.getElementById("modeChip");

  function getModeFromUrl() {
    const p = new URLSearchParams(location.search);
    const m = (p.get("mode") || "buy").toUpperCase();
    return m === "RENT" || m === "SHARE" ? m : "BUY";
  }

  function render(items) {
    grid.innerHTML = "";
    items.forEach(p => {
      const card = document.createElement("a");
      card.className = "card";
      card.href = `/property.html?slug=${p.slug}`;

      card.innerHTML = `
        <div class="thumb">
          <img src="${p.photos?.[0] || ""}" />
          <div class="corner">
            <span class="tagChip">${p.mode}</span>
          </div>
        </div>
        <div class="body">
          <div class="price">€${p.price.toLocaleString()}</div>
          <div class="title">${p.title}</div>
          <div class="meta">
            <span class="chip">${p.bedrooms || "–"} bed</span>
            <span class="chip">${p.bathrooms || "–"} bath</span>
            <span class="chip type">${p.propertyType}</span>
          </div>
        </div>
      `;

      grid.appendChild(card);
    });
  }

  async function load() {
    const mode = getModeFromUrl();
    modeChip.textContent = `Mode: ${mode.toLowerCase()}`;

    const res = await fetch(`https://api.havn.ie/api/properties?mode=${mode}`);
    const data = await res.json();

    render(data.items || []);
  }

  document.addEventListener("DOMContentLoaded", load);
})();
