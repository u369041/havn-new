import { Router } from "express";
import requireActiveAgent from "../middleware/requireActiveAgent";

const router = Router();

/**
 * Prevent browsers, proxies and CDNs from caching protected
 * professional application responses.
 */
router.use((_req, res, next) => {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private"
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  next();
});

/**
 * GET /api/professional-app/session
 *
 * Returns the minimum information required to initialise the
 * protected HAVN Professional application.
 *
 * No proprietary dashboard data or application assets are returned
 * unless requireActiveAgent grants access.
 */
router.get(
  "/session",
  requireActiveAgent,
  async (req: any, res) => {
    const access = req.agentAccess;

    return res.json({
      ok: true,

      application: {
        area: "agent",
        authenticated: true,
        accessGranted: true,
      },

      account: {
        userId: access.userId,
        agentProfileId: access.agentProfileId,
        role: access.role,
        companyName: access.companyName,
        isSuperAdmin: access.isSuperAdmin,
      },

      permissions: {
        canAccessProfessionalApp: true,
        canAccessAgentHub: true,
        canManageProfessionalListings: true,
        canManageBilling: true,
        canAccessAdmin:
          access.isSuperAdmin === true,
      },
    });
  }
);

export default router;