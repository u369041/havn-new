import { Router } from "express";
import requireActiveAgent from "../middleware/requireActiveAgent";
import { getAgencyWorkspace } from "../services/agencyAccess";

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
 *
 * Agency context is returned when the authenticated professional
 * belongs to an active AgencyMember record. Existing approved agents
 * without an Agency membership continue to work during the migration
 * to the agency-based professional platform.
 */
router.get(
  "/session",
  requireActiveAgent,
  async (req: any, res) => {
    try {
      const access = req.agentAccess;

      const agencyWorkspace = await getAgencyWorkspace(
        Number(access.userId)
      );

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

        agency: agencyWorkspace
          ? {
              id: agencyWorkspace.agency.id,
              name: agencyWorkspace.agency.name,
              legalName: agencyWorkspace.agency.legalName,
              slug: agencyWorkspace.agency.slug,
              psraLicenceNumber:
                agencyWorkspace.agency.psraLicenceNumber,
              primaryEmail:
                agencyWorkspace.agency.primaryEmail,
              billingEmail:
                agencyWorkspace.agency.billingEmail,
              phoneNumber:
                agencyWorkspace.agency.phoneNumber,
              websiteUrl:
                agencyWorkspace.agency.websiteUrl,
              addressLine1:
                agencyWorkspace.agency.addressLine1,
              addressLine2:
                agencyWorkspace.agency.addressLine2,
              townCity:
                agencyWorkspace.agency.townCity,
              county:
                agencyWorkspace.agency.county,
              eircode:
                agencyWorkspace.agency.eircode,
              status:
                agencyWorkspace.agency.status,
            }
          : null,

        agencyMembership: agencyWorkspace
          ? {
              id: agencyWorkspace.membership.id,
              userId: agencyWorkspace.membership.userId,
              role: agencyWorkspace.membership.role,
              status: agencyWorkspace.membership.status,
              jobTitle: agencyWorkspace.membership.jobTitle,
              isPrimary: agencyWorkspace.membership.isPrimary,
              joinedAt: agencyWorkspace.membership.joinedAt,
            }
          : null,

        permissions: {
          canAccessProfessionalApp: true,
          canAccessAgentHub: true,
          canManageProfessionalListings: true,
          canManageBilling:
            access.isSuperAdmin === true
              ? false
              : agencyWorkspace
                ? agencyWorkspace.permissions.canManageBilling
                : true,
          canAccessAdmin:
            access.isSuperAdmin === true,

          agency: agencyWorkspace
            ? agencyWorkspace.permissions
            : null,
        },
      });
    } catch (error) {
      console.error(
        "GET /api/professional-app/session error",
        error
      );

      return res.status(500).json({
        ok: false,
        error: "PROFESSIONAL_SESSION_FAILED",
        message:
          "Could not initialise the professional application session",
      });
    }
  }
);

export default router;
