// /public_html/assets/common.js
// Plain JavaScript (no <script> tags)
(function () {
  const DEFAULTS = { API_BASE: "https://api.havn.ie", GMAPS_API_KEY: "" };
  const cfg =
    (window.HAVN_CONFIG && typeof window.HAVN_CONFIG === "object")
      ? { ...DEFAULTS, ...window.HAVN_CONFIG }
      : { ...DEFAULTS };

  window.$cfg = () => cfg;
  window.$qs  = (k, s = location.search) => new URLSearchParams(s).get(k);

  const params = new URLSearchParams(location.search);
  if (params.get("debug")) {
    const el = document.createElement("div");
    el.className = "debugbar";
    el.style.cssText = "position:fixed;right:12px;bottom:12px;background:#0b1220;color:#cbd5e1;border:1px solid #0b2640;border-radius:10px;padding:10px 12px;font-size:12px;z-index:60;box-shadow:0 6px 28px rgba(2,6,23,.6)";
    el.innerHTML = `
      <div><strong style="color:#e2e8f0">Path:</strong> ${location.pathname}</div>
      <div><strong style="color:#e2e8f0">API:</strong> ${cfg.API_BASE || "(blank)"}</div>
      <div><strong style="color:#e2e8f0">TS:</strong> ${new Date().toLocaleString()}</div>
    `;
    document.body.appendChild(el);
  }
})();
