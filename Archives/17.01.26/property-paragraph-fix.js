/* property-paragraph-fix.js
   Purpose: Ensure text blocks typed with newlines in property-upload render as real paragraphs on property.html
   Approach: Apply CSS white-space: pre-wrap to the content element inside cards titled "Description" / "Details"
   Safe: Does NOT change your fetch/render logic; only adjusts display styling post-render.
*/

(function () {
  "use strict";

  function norm(s) {
    return (s ?? "").toString().trim().toLowerCase();
  }

  function applyPreWrapToCardByTitle(titleText) {
    const want = norm(titleText);

    // Look for headings that match (h1/h2/h3 plus common card header patterns)
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,[data-card-title],.card-title,.section-title"));
    const match = headings.find((h) => norm(h.textContent) === want);

    if (!match) return false;

    // Find the closest "card" container; fallback to parent container
    const card =
      match.closest(".card") ||
      match.closest(".panel") ||
      match.closest(".section") ||
      match.closest("article") ||
      match.parentElement;

    if (!card) return false;

    // Heuristic: choose the first sizeable text container inside the card, excluding the title itself
    const candidates = Array.from(
      card.querySelectorAll("p, div, span, section, article")
    ).filter((el) => el !== match && el.textContent && el.textContent.trim().length > 0);

    // Prefer the "body" container if present
    const preferred =
      card.querySelector(".card-body") ||
      card.querySelector(".content") ||
      card.querySelector(".section-body") ||
      candidates.find((el) => el.tagName === "DIV") ||
      candidates[0];

    if (!preferred) return false;

    // Apply display style to preserve newlines
    preferred.style.whiteSpace = "pre-wrap";
    preferred.style.wordBreak = "break-word";

    // Optional: make it look nicer like paragraphs
    // If your CSS already styles prose nicely, this won't hurt.
    preferred.style.lineHeight = "1.55";

    return true;
  }

  function run() {
    // Apply immediately
    const okDesc = applyPreWrapToCardByTitle("Description");
    const okDetails = applyPreWrapToCardByTitle("Details");

    // Some pages render async — try again shortly after in case content arrives later
    setTimeout(() => applyPreWrapToCardByTitle("Description"), 400);
    setTimeout(() => applyPreWrapToCardByTitle("Details"), 400);
    setTimeout(() => applyPreWrapToCardByTitle("Description"), 1200);
    setTimeout(() => applyPreWrapToCardByTitle("Details"), 1200);

    // Debug in console (won’t show to users)
    if (!okDesc) console.debug("[paragraph-fix] Description card not found yet (will retry).");
    if (!okDetails) console.debug("[paragraph-fix] Details card not found yet (will retry).");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
