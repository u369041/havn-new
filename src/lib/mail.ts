import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

const FROM = process.env.RESEND_FROM || "HAVN <noreply@havn.ie>";
const ADMIN_NOTIFY_EMAIL =
  process.env.ADMIN_NOTIFY_EMAIL ||
  process.env.ADMIN_EMAIL ||
  "admin@havn.ie";

/**
 * ----------------------------
 * ADMIN EMAIL (status-based)
 * ----------------------------
 * Used for: "New listing submitted" etc.
 * This MUST accept { status: ... } payloads because properties.ts already calls it that way.
 */
export type ListingStatusEmailPayload = {
  status: string; // e.g. "SUBMITTED"
  listingTitle?: string;
  slug?: string;
  listingId?: string | number;
  adminUrl?: string;

  // allow future fields without breaking TS
  [key: string]: any;
};

export async function sendListingStatusEmail(payload: ListingStatusEmailPayload) {
  try {
    const title = payload.listingTitle || "Untitled listing";
    const subject =
      String(payload.status || "").toUpperCase() === "SUBMITTED"
        ? `New listing submitted: ${title}`
        : `Listing update: ${title}`;

    const html = `
      <h2>${escapeHtml(subject)}</h2>
      <p><strong>Title:</strong> ${escapeHtml(title)}</p>
      ${payload.slug ? `<p><strong>Slug:</strong> ${escapeHtml(String(payload.slug))}</p>` : ""}
      ${payload.listingId ? `<p><strong>ID:</strong> ${escapeHtml(String(payload.listingId))}</p>` : ""}
      ${payload.adminUrl ? `<p><a href="${escapeAttr(payload.adminUrl)}">Open in Admin</a></p>` : ""}
      <p style="color:#64748b;font-size:12px;margin-top:18px">HAVN.ie</p>
    `;

    return await resend.emails.send({
      from: FROM,
      to: ADMIN_NOTIFY_EMAIL,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendListingStatusEmail failed:", err);
    return null;
  }
}

/**
 * ----------------------------
 * USER EMAIL (event-based)
 * ----------------------------
 * Used for: DRAFT_CREATED, DRAFT_SAVED, APPROVED_LIVE, REJECTED, CLOSED, SUBMITTED (optional)
 */
export type ListingEmailEvent =
  | "DRAFT_CREATED"
  | "DRAFT_SAVED"
  | "SUBMITTED"
  | "APPROVED_LIVE"
  | "REJECTED"
  | "CLOSED";

export type UserListingEmailPayload = {
  to: string;
  event: ListingEmailEvent;

  listingTitle?: string;
  slug?: string;
  listingId?: string | number;

  reason?: string;
  publicUrl?: string;
  myListingsUrl?: string;
  closeOutcome?: "SOLD" | "RENTED";

  [key: string]: any;
};

export async function sendUserListingEmail(payload: UserListingEmailPayload) {
  try {
    const title = payload.listingTitle || "your listing";
    const myListingsUrl = payload.myListingsUrl || "https://havn.ie/my-listings.html";

    let subject = "HAVN.ie update";
    let body = "";

    switch (payload.event) {
      case "DRAFT_CREATED":
        subject = "Your draft listing has been created";
        body = `
          <h2>Your draft listing has been created</h2>
          <p>Congratulations — your draft listing has been created on HAVN.ie.</p>
          <p><strong>${escapeHtml(title)}</strong></p>
          <p><a href="${escapeAttr(myListingsUrl)}">Go to My Listings</a></p>
        `;
        break;

      case "DRAFT_SAVED":
        subject = "Your draft listing has been saved";
        body = `
          <h2>Your draft listing has been saved</h2>
          <p>Good news — your draft listing was saved successfully.</p>
          <p><strong>${escapeHtml(title)}</strong></p>
          <p><a href="${escapeAttr(myListingsUrl)}">Go to My Listings</a></p>
        `;
        break;

      case "SUBMITTED":
        subject = "Your listing has been sent for approval";
        body = `
          <h2>Your listing has been sent for approval</h2>
          <p>Congratulations — your listing has been submitted to the HAVN.ie moderation team for review.</p>
          <p><strong>${escapeHtml(title)}</strong></p>
          <p>You can check status anytime in <a href="${escapeAttr(myListingsUrl)}">My Listings</a>.</p>
        `;
        break;

      case "APPROVED_LIVE":
        subject = "Your listing is now live on HAVN";
        body = `
          <h2>Your listing is now live on HAVN</h2>
          <p>Congratulations — your listing has been approved and is now live.</p>
          ${payload.slug ? `<p><strong>Listing reference:</strong> ${escapeHtml(String(payload.slug))}</p>` : ""}
          ${payload.publicUrl ? `<p><a href="${escapeAttr(payload.publicUrl)}">View your listing</a></p>` : ""}
        `;
        break;

      case "REJECTED":
        subject = "Your listing was rejected";
        body = `
          <h2>Your listing was rejected</h2>
          <p>Unfortunately, your listing was rejected by the HAVN.ie moderation team for the following reason:</p>
          <blockquote style="border-left:4px solid #e5e7eb;padding-left:12px;color:#0f172a">
            ${escapeHtml(payload.reason || "No reason provided")}
          </blockquote>
          <p>Please re-submit your listing taking this feedback into account.</p>
          <p><a href="${escapeAttr(myListingsUrl)}">Go to My Listings</a></p>
        `;
        break;

      case "CLOSED":
        subject = "Congratulations — Your Listing Has Been Closed";
        body = `
          <h2>Congratulations — Your Listing Has Been Closed</h2>
          <p>Your listing has been marked as closed (${escapeHtml(String(payload.closeOutcome || "CLOSED"))}).</p>
          <p><strong>${escapeHtml(title)}</strong></p>
          <p><a href="${escapeAttr(myListingsUrl)}">Go to My Listings</a></p>
        `;
        break;
    }

    const html = `
      ${body}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="color:#64748b;font-size:12px">HAVN.ie</p>
    `;

    return await resend.emails.send({
      from: FROM,
      to: payload.to,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendUserListingEmail failed:", err);
    return null;
  }
}

/**
 * ----------------------------
 * WELCOME EMAIL (signup)
 * ----------------------------
 */
export async function sendWelcomeEmail(args: { to: string; name?: string | null }) {
  try {
    const subject = "Welcome to HAVN.ie";
    const displayName = (args.name || "").trim();

    const html = `
      <h2>Welcome to HAVN.ie</h2>
      <p>${displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,"}</p>
      <p>Your account has been created successfully.</p>
      <p>You can create, save and submit property listings for approval anytime.</p>
      <p><a href="https://havn.ie/my-listings.html">Go to My Listings</a></p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="color:#64748b;font-size:12px">HAVN.ie</p>
    `;

    return await resend.emails.send({
      from: FROM,
      to: args.to,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendWelcomeEmail failed:", err);
    return null;
  }
}

/**
 * ----------------------------
 * PASSWORD RESET EMAIL
 * ----------------------------
 * Used by POST /api/auth/forgot-password
 */
export async function sendPasswordResetEmail(args: {
  to: string;
  name?: string | null;
  resetUrl: string;
}) {
  try {
    const displayName = (args.name || "").trim();
    const subject = "Reset your HAVN.ie password";

    const html = `
      <h2>Reset your password</h2>
      <p>${displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,"}</p>
      <p>We received a request to reset your HAVN.ie password.</p>
      <p><a href="${escapeAttr(args.resetUrl)}">Click here to reset your password</a></p>
      <p style="color:#64748b;font-size:12px;margin-top:14px">
        If you didn’t request this, you can ignore this email.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="color:#64748b;font-size:12px">HAVN.ie</p>
    `;

    return await resend.emails.send({
      from: FROM,
      to: args.to,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendPasswordResetEmail failed:", err);
    return null;
  }
}

/**
 * ----------------------------
 * EMAIL VERIFICATION EMAIL
 * ----------------------------
 * Used by POST /api/auth/request-email-verify and also on signup (register)
 */
export async function sendEmailVerificationEmail(args: {
  to: string;
  name?: string | null;
  verifyUrl: string;
}) {
  try {
    const displayName = (args.name || "").trim();
    const subject = "Verify your email for HAVN.ie";

    const html = `
      <h2>Verify your email</h2>
      <p>${displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,"}</p>
      <p>Please verify your email address to finish setting up your HAVN.ie account.</p>
      <p><a href="${escapeAttr(args.verifyUrl)}">Verify your email</a></p>
      <p style="color:#64748b;font-size:12px;margin-top:14px">
        This link expires in 30 minutes.
      </p>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="color:#64748b;font-size:12px">HAVN.ie</p>
    `;

    return await resend.emails.send({
      from: FROM,
      to: args.to,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendEmailVerificationEmail failed:", err);
    return null;
  }
}

/**
 * Helpers
 */
function escapeHtml(input: string) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(input: string) {
  // for href attributes etc.
  return escapeHtml(String(input || ""));
}
