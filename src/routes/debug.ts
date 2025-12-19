import { Router } from "express";

const router = Router();

/**
 * GET /api/debug/routes
 * Lists registered routes (method + path).
 * Remove before production hardening.
 */
router.get("/routes", (req, res) => {
  const app: any = req.app;

  const routes: Array<{ method: string; path: string }> = [];

  const walk = (stack: any[], prefix = "") => {
    for (const layer of stack) {
      if (layer.route && layer.route.path) {
        const path = prefix + layer.route.path;
        const methods = Object.keys(layer.route.methods || {});
        for (const m of methods) {
          routes.push({ method: m.toUpperCase(), path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        // Try to extract mount path from regexp if possible
        const mount = layer.regexp?.source
          ? layer.regexp.source
              .replace("^\\/", "/")
              .replace("\\/?(?=\\/|$)", "")
              .replace("(?=\\/|$)", "")
              .replace("\\/", "/")
          : "";

        // This mount extraction isn't perfect; still useful.
        walk(layer.handle.stack, prefix);
      }
    }
  };

  if (app?._router?.stack) walk(app._router.stack);

  routes.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
  res.json({ ok: true, count: routes.length, routes });
});

export default router;
