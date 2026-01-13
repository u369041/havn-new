import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = "HAVN <noreply@havn.ie>";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "admin@havn.ie";

/**
 * Email event types
 */
export type ListingEmailEvent =
  | "DRAFT_CREATED"
  | "DRAFT_SAVED"
  | "SUBMITTED"
  | "APPROVED_LIVE"
  | "REJECTED"
  | "CLOSED";

/**
 * Base payload (future-proof)
 * NOTE: `to` is optional by design
 */
export type ListingEmailPayload = {
  to?: string;                 // customer email (optional)
  event: ListingEmailEvent;

  listingTitle?: string;
  slug?: string;
  listingId?: string | number;

  reason?: string;
  status?: string;

  adminUrl?: string;
  publicUrl?: string;
  myListingsUrl?: string;

  closeOutcome?: "SOLD" | "RENTED";

  // allow future additions without breaking TS
  [key: string]: any;
};

/**
 * ADMIN notifications (submission etc)
 */
export async function sendListingStatusEmail(payload: ListingEmailPayload) {
  try {
    const subject =
      payload.event === "SUBMITTED"
        ? `New listing submitted: ${payload.listingTitle}`
        : `Listing update`;

    const html = `
      <h2>${subject}</h2>
      <p><strong>Title:</strong> ${payload.listingTitle}</p>
      <p><strong>Slug:</strong> ${payload.slug}</p>
      <p><strong>ID:</strong> ${payload.listingId}</p>
      ${payload.adminUrl ? `<p><a href="${payload.adminUrl}">Open in Admin</a></p>` : ""}
    `;

    await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendListingStatusEmail failed:", err);
  }
}

/**
 * CUSTOMER notifications
 */
export async function sendUserListingEmail(payload: ListingEmailPayload) {
  if (!payload.to) {
    console.warn("sendUserListingEmail called without `to` — skipping");
    return;
  }

  let subject = "HAVN.ie update";
  let body = "";

  switch (payload.event) {
    case "DRAFT_CREATED":
      subject = "Your draft listing has been created";
      body = `
        <p>Congratulations — your draft listing has been created.</p>
        <p><strong>${payload.listingTitle}</strong></p>
        <p><a href="${payload.myListingsUrl}">View your listings</a></p>
      `;
      break;

    case "DRAFT_SAVED":
      subject = "Your draft listing has been saved";
      body = `
        <p>Your draft listing has been saved successfully.</p>
        <p><strong>${payload.listingTitle}</strong></p>
        <p><a href="${payload.myListingsUrl}">View your listings</a></p>
      `;
      break;

    case "SUBMITTED":
      subject = "Your listing has been sent for approval";
      body = `
        <p>Your listing has been sent to the HAVN.ie moderation team.</p>
        <p><strong>${payload.listingTitle}</strong></p>
      `;
      break;

    case "APPROVED_LIVE":
      subject = "Your listing is now live on HAVN";
      body = `
        <p>Congratulations — your listing has been approved and is now live.</p>
        <p><a href="${payload.publicUrl}">View your listing</a></p>
      `;
      break;

    case "REJECTED":
      subject = "Your listing was rejected";
      body = `
        <p>Unfortunately your listing was rejected for the following reason:</p>
        <blockquote>${payload.reason || "No reason provided"}</blockquote>
        <p><a href="${payload.myListingsUrl}">Edit and resubmit</a></p>
      `;
      break;

    case "CLOSED":
      subject = "Your listing has been closed";
      body = `
        <p>Congratulations — your listing has been marked as ${payload.closeOutcome}.</p>
        <p><strong>${payload.listingTitle}</strong></p>
        <p><a href="${payload.myListingsUrl}">View your listings</a></p>
      `;
      break;
  }

  try {
    await resend.emails.send({
      from: FROM,
      to: payload.to,
      subject,
      html: body,
    });
  } catch (err) {
    console.error("sendUserListingEmail failed:", err);
  }
}
