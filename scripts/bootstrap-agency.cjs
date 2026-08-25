const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

const TARGET_USER_ID = 6;
const TARGET_AGENT_PROFILE_ID = 2;

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

async function main() {
  console.log("HAVN agency bootstrap starting...");
  console.log({
    targetUserId: TARGET_USER_ID,
    targetAgentProfileId: TARGET_AGENT_PROFILE_ID,
  });

  const user = await prisma.user.findUnique({
    where: { id: TARGET_USER_ID },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailVerified: true,
      agentProfile: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          companyName: true,
          psraLicenceNumber: true,
          status: true,
          subscriptionStatus: true,
        },
      },
      agencyMemberships: {
        where: {
          status: "ACTIVE",
        },
        select: {
          id: true,
          agencyId: true,
          role: true,
          status: true,
          agency: {
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!user) {
    throw new Error(`User ${TARGET_USER_ID} was not found`);
  }

  if (!user.agentProfile) {
    throw new Error(
      `User ${TARGET_USER_ID} does not have an AgentProfile`
    );
  }

  if (user.agentProfile.id !== TARGET_AGENT_PROFILE_ID) {
    throw new Error(
      `Expected AgentProfile ${TARGET_AGENT_PROFILE_ID}, but user ${TARGET_USER_ID} is linked to AgentProfile ${user.agentProfile.id}`
    );
  }

  if (String(user.role).toLowerCase() !== "agent") {
    throw new Error(
      `User ${TARGET_USER_ID} is not currently an agent; current role is ${user.role}`
    );
  }

  if (!user.emailVerified) {
    throw new Error(
      `User ${TARGET_USER_ID} does not have a verified email address`
    );
  }

  if (user.agentProfile.status !== "APPROVED") {
    throw new Error(
      `AgentProfile ${TARGET_AGENT_PROFILE_ID} is not APPROVED; current status is ${user.agentProfile.status}`
    );
  }

  if (user.agentProfile.subscriptionStatus !== "ACTIVE") {
    throw new Error(
      `AgentProfile ${TARGET_AGENT_PROFILE_ID} does not have an ACTIVE subscription; current status is ${user.agentProfile.subscriptionStatus}`
    );
  }

  if (user.agencyMemberships.length > 0) {
    console.log("No changes made.");
    console.log(
      "This user already has an ACTIVE agency membership:",
      user.agencyMemberships
    );
    return;
  }

  const agencyName = user.agentProfile.companyName.trim();
  const agencySlug = slugify(agencyName);

  if (!agencySlug) {
    throw new Error(
      `Could not generate an agency slug from company name "${agencyName}"`
    );
  }

  const existingBySlug = await prisma.agency.findUnique({
    where: { slug: agencySlug },
    select: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (existingBySlug) {
    throw new Error(
      `Agency slug "${agencySlug}" already belongs to Agency ${existingBySlug.id} (${existingBySlug.name}). No changes were made.`
    );
  }

  const existingByPsra = await prisma.agency.findUnique({
    where: {
      psraLicenceNumber: user.agentProfile.psraLicenceNumber,
    },
    select: {
      id: true,
      name: true,
      psraLicenceNumber: true,
    },
  });

  if (existingByPsra) {
    throw new Error(
      `PSRA licence ${user.agentProfile.psraLicenceNumber} is already attached to Agency ${existingByPsra.id} (${existingByPsra.name}). No changes were made.`
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const agency = await tx.agency.create({
      data: {
        name: agencyName,
        slug: agencySlug,
        psraLicenceNumber: user.agentProfile.psraLicenceNumber,
        primaryEmail: user.email,
        billingEmail: user.email,
        status: "ACTIVE",
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
      select: {
        id: true,
        name: true,
        slug: true,
        psraLicenceNumber: true,
        primaryEmail: true,
        billingEmail: true,
        status: true,
        createdAt: true,
      },
    });

    const membership = await tx.agencyMember.create({
      data: {
        agencyId: agency.id,
        userId: user.id,
        role: "OWNER",
        status: "ACTIVE",
        isPrimary: true,
        jobTitle: "Agency Owner",
      },
      select: {
        id: true,
        agencyId: true,
        userId: true,
        role: true,
        status: true,
        isPrimary: true,
        jobTitle: true,
        joinedAt: true,
      },
    });

    const audit = await tx.agencyAuditLog.create({
      data: {
        agencyId: agency.id,
        actorUserId: user.id,
        actorAgencyMemberId: membership.id,
        action: "AGENCY_BOOTSTRAPPED",
        entityType: "Agency",
        entityId: String(agency.id),
        afterState: {
          agency: {
            id: agency.id,
            name: agency.name,
            slug: agency.slug,
            psraLicenceNumber: agency.psraLicenceNumber,
            status: agency.status,
          },
          initialOwnerMembership: {
            id: membership.id,
            userId: membership.userId,
            role: membership.role,
            status: membership.status,
          },
        },
        changedFields: [
          "agency.created",
          "agencyMember.created",
          "agencyMember.role",
          "agencyMember.status",
        ],
        metadata: {
          source: "bootstrap-agency.cjs",
          agentProfileId: TARGET_AGENT_PROFILE_ID,
        },
      },
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        createdAt: true,
      },
    });

    return {
      agency,
      membership,
      audit,
    };
  });

  console.log("");
  console.log("Agency bootstrap completed successfully.");
  console.dir(result, { depth: null });
  console.log("");
  console.log(
    "No existing AgentProfile, Stripe subscription, User role or Property record was changed."
  );
}

main()
  .catch((error) => {
    console.error("");
    console.error("Agency bootstrap FAILED.");
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
