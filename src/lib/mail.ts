import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "";
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "";

const resend = RESEND_API_KEY && RESEND_FROM ? new Resend(RESEND_API_KEY) : null;

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

export async function sendUserListingEmail(p: {
  to: string;
  event: ListingEmailEvent;
  listingTitle?: string;
  slug?: string;
  reason?: string;

  // ✅ widened (fixes TS2353)
  listingId?: number | string;
  status?: string;
}) {
  const title = p.listingTitle || "Your HAVN listing";

  let subject = "";
  let body = "";

  switch (p.event) {
    case "DRAFT_CREATED":
      subject = `Draft created: ${title}`;
      body = `Your draft listing has been created.`;
      break;

    case "DRAFT_SAVED":
      subject = `Draft saved: ${title}`;
      body = `Your draft listing has been saved.`;
      break;

    case "SUBMITTED_FOR_APPROVAL":
      subject = `Listing submitted for approval: ${title}`;
      body = `Your listing has been submitted for approval.`;
      break;

    case "APPROVED_LIVE":
      subject = `Your listing is now live on HAVN`;
      body = `Congratulations — your listing has been approved and is now live.`;
      break;

    case "REJECTED":
      subject = `Listing rejected: ${title}`;
      body = `Your listing was rejected for the following reason:<br/><br/>
              <em>${p.reason || "No reason provided."}</em>`;
      break;

    case "CLOSED":
      subject = `Congratulations — Your Listing Has Been Closed`;
      body = `Your listing has been successfully closed.`;
      break;
  }

  const html = wrap(`
    <h2>${subject}</h2>
    <p>${body}</p>
    ${p.slug ? `<p>Listing reference: ${p.slug}</p>` : ""}
  `);

  await sendMail(p.to, subject, html);
}

/* ===========================
   BACKWARD-COMPAT EXPORT
=========================== */

export const sendListingStatusEmail = sendUserListingEmail;
