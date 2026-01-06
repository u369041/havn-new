// src/lib/resendMail.ts
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "no-reply@havn.ie";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

function assertResendConfigured() {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is missing. Set it in Render env vars.");
  }
}

export async function sendListingApprovedEmail(to: string, opts: { title: string; slug: string }) {
  assertResendConfigured();

  const subject = "✅ Your HAVN listing is now live";
  const url = `https://havn.ie/property.html?slug=${encodeURIComponent(opts.slug)}`;

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6; color:#0b1220;">
      <h2 style="margin:0 0 8px;">Your listing is approved 🎉</h2>
      <p style="margin:0 0 10px;">Your HAVN listing is now live:</p>
      <p style="margin:0 0 10px;"><strong>${escapeHtml(opts.title)}</strong></p>
      <p style="margin:0 0 16px;">
        <a href="${url}" style="display:inline-block; padding:10px 14px; border-radius:12px; background:#2563eb; color:#fff; text-decoration:none; font-weight:700;">
          View listing
        </a>
      </p>
      <p style="margin:0; color:#5c6b86; font-size:13px;">Thanks for listing with havn.ie.</p>
    </div>
  `;

  await resend!.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });
}

export async function sendListingRejectedEmail(
  to: string,
  opts: { title: string; reason?: string; editUrl: string }
) {
  assertResendConfigured();

  const subject = "❌ Your HAVN listing needs changes";
  const reason = (opts.reason || "").trim();

  const html = `
    <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.6; color:#0b1220;">
      <h2 style="margin:0 0 8px;">Your listing was not approved</h2>
      <p style="margin:0 0 10px;">Your listing requires changes before it can go live:</p>
      <p style="margin:0 0 10px;"><strong>${escapeHtml(opts.title)}</strong></p>

      ${
        reason
          ? `<div style="padding:12px 14px; border-radius:14px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.20); margin:10px 0 16px;">
              <strong style="display:block; margin-bottom:6px;">Reason:</strong>
              <div>${escapeHtml(reason)}</div>
            </div>`
          : `<p style="margin:0 0 16px; color:#5c6b86;">No reason was provided.</p>`
      }

      <p style="margin:0 0 16px;">
        <a href="${opts.editUrl}" style="display:inline-block; padding:10px 14px; border-radius:12px; background:#0b1220; color:#fff; text-decoration:none; font-weight:700;">
          Edit & resubmit
        </a>
      </p>

      <p style="margin:0; color:#5c6b86; font-size:13px;">If you have questions, reply to this email.</p>
    </div>
  `;

  await resend!.emails.send({
    from: FROM_EMAIL,
    to,
    subject,
    html,
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
