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

export type ListingStatusEmailPayload = {
  status: "SUBMITTED" | "APPROVED" | "REJECTED";
  listingTitle?: string;
  slug?: string;
  listingId?: string;
  userEmail?: string; // for APPROVED/REJECTED
  publicUrl?: string;
  adminUrl?: string;
  reason?: string;
};

export async function sendListingStatusEmail(p: ListingStatusEmailPayload): Promise<void> {
  if (!resend) {
    console.log("[mail] Resend not configured (missing RESEND_API_KEY/RESEND_FROM). Skipping.");
    return;
  }

  const title = safeText(p.listingTitle) || "A HAVN listing";
  const slug = safeText(p.slug);
  const listingId = safeText(p.listingId);

  const subject =
    p.status === "SUBMITTED"
      ? `New listing submitted: ${title}`
      : p.status === "APPROVED"
        ? `Your listing is live on HAVN: ${title}`
        : `Your listing needs changes: ${title}`;

  const parts: string[] = [];
  parts.push(`<h2 style="margin:0 0 12px">${escapeHtml(subject)}</h2>`);
  parts.push(`<p style="margin:0 0 8px"><strong>Title:</strong> ${escapeHtml(title)}</p>`);
  if (slug) parts.push(`<p style="margin:0 0 8px"><strong>Slug:</strong> ${escapeHtml(slug)}</p>`);
  if (listingId) parts.push(`<p style="margin:0 0 8px"><strong>ID:</strong> ${escapeHtml(listingId)}</p>`);

  if (p.status === "SUBMITTED") {
    if (!ADMIN_NOTIFY_EMAIL) {
      console.log("[mail] Missing ADMIN_NOTIFY_EMAIL. Skipping admin notification.");
      return;
    }

    if (p.adminUrl) {
      parts.push(
        `<p style="margin:16px 0 0"><a href="${escapeAttr(
          p.adminUrl
        )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">Open in Admin</a></p>`
      );
    }

    parts.push(`<p style="margin:16px 0 0;color:#444">A new listing was submitted and is awaiting moderation.</p>`);

    await sendEmail({
      to: ADMIN_NOTIFY_EMAIL,
      subject,
      html: wrapHtml(parts.join("\n")),
      text: stripTags(parts.join("\n")),
    });
    return;
  }

  const toUser = safeText(p.userEmail);
  if (!toUser) {
    console.log("[mail] Missing userEmail for status", p.status, "Skipping user notification.");
    return;
  }

  if (p.status === "APPROVED") {
    if (p.publicUrl) {
      parts.push(
        `<p style="margin:16px 0 0"><a href="${escapeAttr(
          p.publicUrl
        )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">View your listing</a></p>`
      );
    }
    parts.push(`<p style="margin:16px 0 0;color:#444">Your listing has been approved and is now public on HAVN.</p>`);
  } else {
    if (p.adminUrl) {
      parts.push(
        `<p style="margin:16px 0 0"><a href="${escapeAttr(
          p.adminUrl
        )}" style="display:inline-block;padding:10px 14px;border-radius:10px;border:1px solid #ddd;text-decoration:none">Preview</a></p>`
      );
    }
    if (p.reason) {
      parts.push(`<p style="margin:16px 0 0"><strong>Reason:</strong> ${escapeHtml(p.reason)}</p>`);
    }
    parts.push(`<p style="margin:16px 0 0;color:#444">Please update your listing and resubmit when ready.</p>`);
  }

  await sendEmail({
    to: toUser,
    subject,
    html: wrapHtml(parts.join("\n")),
    text: stripTags(parts.join("\n")),
  });
}

async function sendEmail(args: { to: string; subject: string; html: string; text: string }) {
  try {
    const result = await resend!.emails.send({
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

function wrapHtml(body: string) {
  return `<!doctype html>
<html>
  <body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4;background:#fff">
    <div style="max-width:640px;margin:0 auto;padding:24px">
      ${body}
      <hr style="margin:24px 0;border:none;border-top:1px solid #eee" />
      <p style="color:#666;font-size:12px;margin:0">HAVN.ie</p>
    </div>
  </body>
</html>`;
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
