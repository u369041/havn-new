// src/lib/mail.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "";
const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL || "";

// If not configured, all sends become no-ops (and your core flows keep working).
const resend = RESEND_API_KEY && RESEND_FROM ? new Resend(RESEND_API_KEY) : null;

function safeText(input: unknown) {
  return String(input ?? "").trim();
}

function stripTags(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(s: string) {
  return s.replace(/"/g, "%22").replace(/</g, "%3C").replace(/>/g, "%3E");
}

function wrapHtml(body: string) {
  return `<!doctype html>
<html>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4;background:#fff">
    <div style="max-width:680px;margin:0 auto;padding:24px">
      ${body}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee" />
      <p style="color:#666;font-size:12px;margin:0">HAVN.ie</p>
    </div>
  </body>
</html>`;
}

async function sendEmail(args: { to: string; subject: string; html: string; text: string }) {
  try {
    if (!resend) {
      console.log("[mail] Resend not configured (missing RESEND_API_KEY/RESEND_FROM). Skipping.");
      return;
    }

    const result = await resend.emails.send({
      from: RESEND_FROM,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    const id = (result as any)?.data?.id ?? (result as any)?.id ?? "unknown";
    console.log("[mail] sent", { to: args.to, id });
  } catch (err) {
    console.error("[mail] send failed", err);
  }
}

/**
 * ADMIN: new submission waiting moderation
 */
export async function sendAdminNewSubmissionEmail(p: {
  listingTitle?: string;
  slug?: string;
  listingId?: number | string;
  adminUrl?: string;
}) {
  const to = safeText(ADMIN_NOTIFY_EMAIL);
  if (!to) {
    console.log("[mail] Missing ADMIN_NOTIFY_EMAIL. Skipping admin notification.");
    return;
  }

  const title = safeText(p.listingTitle) || "A HAVN listing";
  const slug = safeText(p.slug);
  const id = safeText(p.listingId);

  const subject = `New listing submitted: ${title}`;

  const parts: string[] = [];
  parts.push(`<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>`);
  parts.push(`<p style="margin:0 0 8px"><strong>Title:</strong> ${escapeHtml(title)}</p>`);
  if (slug) parts.push(`<p style="margin:0 0 8px"><strong>Slug:</strong> ${escapeHtml(slug)}</p>`);
  if (id) parts.push(`<p style="margin:0 0 8px"><strong>ID:</strong> ${escapeHtml(id)}</p>`);

  if (p.adminUrl) {
    parts.push(
      `<p style="margin:16px 0 0"><a href="${escapeAttr(
        p.adminUrl
      )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">Open in Admin</a></p>`
    );
  }

  parts.push(`<p style="margin:16px 0 0;color:#444">A new listing was submitted and is awaiting moderation.</p>`);

  await sendEmail({
    to,
    subject,
    html: wrapHtml(parts.join("\n")),
    text: stripTags(parts.join("\n")),
  });
}

/**
 * USER: listing lifecycle emails (now includes CLOSED)
 */
export type UserListingEmailEvent =
  | "DRAFT_CREATED"
  | "DRAFT_SAVED"
  | "SUBMITTED_FOR_APPROVAL"
  | "APPROVED_LIVE"
  | "REJECTED"
  | "CLOSED";

export async function sendUserListingEmail(p: {
  to: string;
  event: UserListingEmailEvent;
  listingTitle?: string;
  slug?: string;
  listingId?: number | string;
  publicUrl?: string;
  myListingsUrl?: string;
  reason?: string;
  closeOutcome?: "SOLD" | "RENTED" | "CLOSED";
}) {
  const to = safeText(p.to);
  if (!to) {
    console.log("[mail] Missing user email for", p.event, "Skipping.");
    return;
  }

  const title = safeText(p.listingTitle) || "your HAVN listing";
  const slug = safeText(p.slug);
  const id = safeText(p.listingId);

  const myListingsUrl = p.myListingsUrl || "https://havn.ie/my-listings.html";
  const publicUrl = p.publicUrl || (slug ? `https://havn.ie/property.html?slug=${slug}` : "");

  let subject = "";
  if (p.event === "DRAFT_CREATED") subject = `Your draft has been created: ${title}`;
  if (p.event === "DRAFT_SAVED") subject = `Your draft has been saved: ${title}`;
  if (p.event === "SUBMITTED_FOR_APPROVAL") subject = `Your listing has been submitted for approval: ${title}`;
  if (p.event === "APPROVED_LIVE") subject = `Your listing is now live on HAVN: ${title}`;
  if (p.event === "REJECTED") subject = `Your listing submission was rejected: ${title}`;
  if (p.event === "CLOSED") subject = `Congratulations — Your Listing Has Been Closed: ${title}`;

  const parts: string[] = [];
  parts.push(`<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>`);
  parts.push(`<p style="margin:0 0 8px"><strong>Title:</strong> ${escapeHtml(title)}</p>`);
  if (slug) parts.push(`<p style="margin:0 0 8px"><strong>Slug:</strong> ${escapeHtml(slug)}</p>`);
  if (id) parts.push(`<p style="margin:0 0 8px"><strong>ID:</strong> ${escapeHtml(id)}</p>`);

  if (p.event === "CLOSED") {
    const outcome = p.closeOutcome || "CLOSED";
    const outcomeText =
      outcome === "SOLD" ? "sold" : outcome === "RENTED" ? "rented" : "closed";

    parts.push(
      `<p style="margin:16px 0 0;color:#444">Congratulations — your listing has been successfully ${escapeHtml(
        outcomeText
      )} and is now marked as closed on HAVN.</p>`
    );
    parts.push(
      `<p style="margin:16px 0 0"><a href="${escapeAttr(
        myListingsUrl
      )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">View My Listings</a></p>`
    );
  }

  if (p.event === "APPROVED_LIVE") {
    parts.push(`<p style="margin:16px 0 0;color:#444">Good news — your listing has been approved and is now live.</p>`);
    if (publicUrl) {
      parts.push(
        `<p style="margin:16px 0 0"><a href="${escapeAttr(
          publicUrl
        )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">View live listing</a></p>`
      );
    }
  }

  if (p.event === "SUBMITTED_FOR_APPROVAL") {
    parts.push(`<p style="margin:16px 0 0;color:#444">Your listing has been submitted for approval. We’ll notify you once it’s reviewed.</p>`);
    parts.push(
      `<p style="margin:16px 0 0"><a href="${escapeAttr(
        myListingsUrl
      )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">Track status</a></p>`
    );
  }

  if (p.event === "REJECTED") {
    parts.push(`<p style="margin:16px 0 0;color:#444">Your listing submission for approval has been rejected for the following reason(s):</p>`);
    const reason = safeText(p.reason);
    parts.push(
      `<div style="margin:12px 0;padding:12px;border:1px solid #eee;border-radius:10px;background:#fafafa">${
        reason ? escapeHtml(reason) : "No rejection reason was provided."
      }</div>`
    );
    parts.push(`<p style="margin:16px 0 0;color:#444">Please re-submit your listing taking into account this feedback.</p>`);
    parts.push(
      `<p style="margin:16px 0 0"><a href="${escapeAttr(
        myListingsUrl
      )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">Edit & re-submit</a></p>`
    );
  }

  await sendEmail({
    to,
    subject,
    html: wrapHtml(parts.join("\n")),
    text: stripTags(parts.join("\n")),
  });
}
