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
 * Accepts BOTH:
 * - { status: "SUBMITTED" }
 * - { event: "SUBMITTED" }
 */
export type ListingStatusEmailPayload = {
  status?: string;
  event?: string;
  listingTitle?: string;
  slug?: string;
  listingId?: string | number;
  adminUrl?: string;
  [key: string]: any;
};

export async function sendListingStatusEmail(payload: ListingStatusEmailPayload) {
  try {
    const title = payload.listingTitle || "Untitled listing";
    const statusLike = String(payload.status || payload.event || "").toUpperCase();

    const subject =
      statusLike === "SUBMITTED"
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
 * PROPERTY LEAD EMAIL
 * ----------------------------
 * TO: listing owner
 * BCC: admin@havn.ie
 * Reply-To: buyer email
 */
export type PropertyLeadEmailPayload = {
  to: string;
  buyerName: string;
  buyerEmail: string;
  buyerPhone?: string;
  message: string;
  intent?: "VIEWING" | "QUESTION" | string;
  listingTitle?: string;
  slug?: string;
  listingId?: string | number;
  propertyUrl?: string;
};

export async function sendPropertyLeadEmail(payload: PropertyLeadEmailPayload) {
  try {
    const listingTitle = payload.listingTitle || "your HAVN listing";
    const intent = String(payload.intent || "QUESTION").toUpperCase();

    const subject =
      intent === "VIEWING"
        ? `New viewing request for: ${listingTitle}`
        : `New enquiry for: ${listingTitle}`;

    const html = `
      <h2>${escapeHtml(subject)}</h2>

      <p><strong>Property:</strong> ${escapeHtml(listingTitle)}</p>
      ${payload.slug ? `<p><strong>Slug:</strong> ${escapeHtml(String(payload.slug))}</p>` : ""}
      ${payload.listingId ? `<p><strong>ID:</strong> ${escapeHtml(String(payload.listingId))}</p>` : ""}
      ${payload.propertyUrl ? `<p><a href="${escapeAttr(payload.propertyUrl)}">View listing</a></p>` : ""}

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0" />

      <p><strong>Name:</strong> ${escapeHtml(payload.buyerName)}</p>
      <p><strong>Email:</strong> ${escapeHtml(payload.buyerEmail)}</p>
      ${payload.buyerPhone ? `<p><strong>Phone:</strong> ${escapeHtml(payload.buyerPhone)}</p>` : ""}
      <p><strong>Intent:</strong> ${escapeHtml(intent)}</p>

      <div style="margin-top:16px">
        <p><strong>Message:</strong></p>
        <div style="border:1px solid #e5e7eb;border-radius:12px;padding:12px;background:#fafafa;white-space:pre-wrap;line-height:1.55;color:#0f172a;">
          ${escapeHtml(payload.message)}
        </div>
      </div>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
      <p style="color:#64748b;font-size:12px">Sent via HAVN.ie</p>
    `;

    return await resend.emails.send({
      from: FROM,
      to: payload.to,
      bcc: ADMIN_NOTIFY_EMAIL,
      replyTo: payload.buyerEmail,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendPropertyLeadEmail failed:", err);
    return null;
  }
}

/**
 * ----------------------------
 * WELCOME EMAIL
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

function escapeHtml(input: string) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(input: string) {
  return escapeHtml(String(input || ""));
}