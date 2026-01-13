/* =========================================================
   HAVN ASSET LOADER — NEUTRALIZED SAFE TOMBSTONE
   File: /havn-assets.js

   Why this exists:
   - The previous asset loader caused caching / script-order drift
   - It created global “loading failures” across pages
   - We are keeping the path alive to avoid 404s,
     but the loader logic is permanently disabled.

   What this file does:
   ✅ NOTHING (intentionally)
   - No script injection
   - No CSS injection
   - No blocking UI
   - No forced reloads
   - No banners / modals
   - No retries

   If you ever want a real solution:
   ✅ Use cache-control headers or hashed assets via build pipeline.

   ========================================================= */

(function () {
  "use strict";

  // Optional: a single console notice for engineers
  try {
    if (!window.__HAVN_ASSET_LOADER_DISABLED__) {
      window.__HAVN_ASSET_LOADER_DISABLED__ = true;
      console.warn("[HAVN] havn-assets.js is disabled (safe tombstone).");
    }
  } catch {}

  // Intentionally no-op.
})();
