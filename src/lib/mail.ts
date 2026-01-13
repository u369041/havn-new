import { Resend } from "resend";

/* ===========================
   CONFIG
=========================== */

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "";
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "";

const resend = RESEND_API_KEY && RESEND_FROM ? new Resend(RESEND_API_KEY) : null;

/* ===========================
   HELPERS
=========================== */

function strip(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function wrap(html: string) {
  return `<!doctype html>
<html>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:640px;margin:0 auto;padding:24px">
      ${html}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee" />
      <p style="color:#666;font-size:12px;margin:0">HAVN.ie</p>
    </div>
  </body>
</html>`;
}

async function sendMail(to: string, subject: string, html: string) {
  if (!resend) {
    console.log("[mail] Resend not configured — skipping email:", subject);
    return;
  }

  await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    text: strip(html),
  });
}

/* ===========================
   WELCOME EMAIL (signup)
=========================== */

export async function sendWelcomeEmail(p: { to: string; firstName?: string | null }) {
  const name = (p.firstName || "").trim();
  const subject = "Welcome to HAVN.ie";
  const html = wrap(`
    <h2>Welcome to HAVN.ie${name ? `, ${name}` : ""} 👋</h2>
    <p>Your account has been created successfully.</p>
    <p>You can now create a listing, save drafts, and submit for moderation.</p>
    <p><a href="https://havn.ie/my-listings.html">Go to My Listings</a></p>
  `);

  await sendMail(p.to, subject, html);
}

/* ===========================
   ADMIN EMAIL
=========================== */

export async function sendAdminNewSubmissionEmail(p: {
  listingTitle?: string;
  slug?: string;
  listingId?: number | string;
  adminUrl?: string;
}) {
  if (!ADMIN_NOTIFY_EMAIL) return;

  const subject = `New listing submitted: ${p.listingTitle || "HAVN Listing"}`;

  const html = wrap(`
    <h2>${subject}</h2>
    <p><strong>Title:</strong> ${p.listingTitle || ""}</p>
    <p><strong>Slug:</strong> ${p.slug || ""}</p>
    <p><strong>ID:</strong> ${p.listingId || ""}</p>
    ${p.adminUrl ? `<p><a href="${p.adminUrl}">Open in Admin</a></p>` : ""}
    <p>This listing is awaiting moderation.</p>
  `);

  await sendMail(ADMIN_NOTIFY_EMAIL, subject, html);
}

/* ===========================
   USER LISTING EMAILS
=========================== */

export type ListingEmailEvent =
  | "DRAFT_CREATED"
  | "DRAFT_SAVED"
  | "SUBMITTED_FOR_APPROVAL"
  | "APPROVED_LIVE"
  | "REJECTED"
  | "CLOSED";

/**
 * NOTE:
 * - `event` optional for backward compatibility
 * - `to` REQUIRED
 * - extra fields allowed (future-proof)
 */
export async function sendUserListingEmail(p: {
  to: string;
  event?: ListingEmailEvent;

  listingTitle?: string;
  slug?: string;
  reason?: string;

  listingId?: number | string;
  status?: string;

  publicUrl?: string;
  myListingsUrl?: string;
  adminUrl?: string;
  closeOutcome?: string;

  [key: string]: any;
}) {
  const title = p.listingTitle || "Your HAVN listing";
  const event: ListingEmailEvent = p.event ?? "SUBMITTED_FOR_APPROVAL";

  let subject = "";
  let body = "";

  switch (event) {
    case "DRAFT_CREATED":
      subject = "Congratulations — your draft listing has been created";
      body = "Your draft listing has been created and is ready to edit.";
      break;

    case "DRAFT_SAVED":
      subject = "Congratulations — your draft listing has been saved";
      body = "Your draft listing has been saved successfully.";
      break;

    case "SUBMITTED_FOR_APPROVAL":
      subject = "Congratulations — your listing has been sent for approval";
      body = "Congratulations — your listing has been sent to the HAVN.ie moderation team for approval.";
      break;

    case "APPROVED_LIVE":
      subject = "Your listing is now live on HAVN";
      body = "Congratulations — your listing has been approved and is now live.";
      break;

    case "REJECTED":
      subject = "Unfortunately — your listing was rejected";
      body = `Unfortunately your listing was rejected by the HAVN.ie moderation team for the following reasons:<br/><br/>
              <em>${p.reason || "No reason provided."}</em><br/><br/>
              Please re-submit your listing taking into account this feedback.`;
      break;

    case "CLOSED":
      subject = "Congratulations — Your Listing Has Been Closed";
      body = "Congratulations — your listing has been successfully closed.";
      if (p.closeOutcome) {
        body += `<br/><br/><strong>Outcome:</strong> ${p.closeOutcome}`;
      }
      break;
  }

  const links: string[] = [];
  if (p.publicUrl) links.push(`<a href="${p.publicUrl}">View your listing</a>`);
  if (p.myListingsUrl) links.push(`<a href="${p.myListingsUrl}">My listings</a>`);
  if (p.adminUrl) links.push(`<a href="${p.adminUrl}">Open in admin</a>`);

  const html = wrap(`
    <h2>${subject}</h2>
    <p>${body}</p>
    ${p.slug ? `<p><strong>Listing reference:</strong> ${p.slug}</p>` : ""}
    ${links.length ? `<p>${links.join(" &nbsp;•&nbsp; ")}</p>` : ""}
  `);

  await sendMail(p.to, subject, html);
}

/* ===========================
   BACKWARD COMPAT
=========================== */

export const sendListingStatusEmail = sendUserListingEmail;
