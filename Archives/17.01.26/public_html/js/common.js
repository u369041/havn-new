// /public_html/js/common.js
// Shared utilities for HAVN frontend

(function () {
  const CLOUD_BASE = "https://res.cloudinary.com/dj2j9dbxk/image/upload/";
  const CLOUD_FOLDER = "havn/properties/";
  const CLOUD_TX = "c_fill,f_auto,q_auto,w_800,h_600";

  function isHttpUrl(v) {
    return typeof v === "string" && /^https?:\/\//i.test(v);
  }

  function resolvePhotoUrl(input) {
    if (!input || typeof input !== "string") return "/img/placeholder.jpg";
    if (isHttpUrl(input)) return input; // already full Cloudinary URL
    const id = input.startsWith(CLOUD_FOLDER) ? input : CLOUD_FOLDER + input;
    return `${CLOUD_BASE}${CLOUD_TX}/${id}`;
  }

  window.HAVN = Object.freeze({
    resolvePhotoUrl,
  });
})();
