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
 * HAVN TRANSACTIONAL EMAIL DESIGN SYSTEM
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
  recipientName?: string | null;
  listingTitle?: string;
  slug?: string;
  listingId?: string | number;
  reason?: string;
  publicUrl?: string;
  myListingsUrl?: string;
  editUrl?: string;
  closeOutcome?: "SOLD" | "RENTED";
  coverImageUrl?: string | null;
  propertyAddress?: string | null;
  propertyMode?: string | null;
  listingPackage?: "STANDARD" | "FEATURED" | string | null;
  durationDays?: number | null;
  amountPaidCents?: number | null;
  paymentReference?: string | null;
  submittedAt?: Date | string | null;
  price?: number | null;
  [key: string]: any;
};

const HAVN_NAVY = "#0A1A33";
const HAVN_BLUE = "#346FB6";
const HAVN_BUTTON = "#000000";
const HAVN_LIGHT = "#F5F8FC";
const HAVN_TEXT = "#0F172A";
const HAVN_MUTED = "#64748B";
const HAVN_BORDER = "#E2E8F0";

function formatCurrencyFromCents(value?: number | null) {
  const cents = Number(value);
  if (!Number.isFinite(cents)) return null;

  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatPropertyPrice(value?: number | null) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;

  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDateTime(value?: Date | string | null) {
  if (!value) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Dublin",
  }).format(date);
}

function humanMode(value?: string | null) {
  const mode = String(value || "").trim().toUpperCase();

  if (mode === "BUY") return "Property for Sale";
  if (mode === "RENT") return "Property to Rent";
  if (mode === "SHARE") return "Room Share";

  return value ? String(value) : "Property Listing";
}

function humanPackage(value?: string | null) {
  const selected = String(value || "").trim().toUpperCase();

  if (selected === "FEATURED") return "Featured Listing";
  if (selected === "STANDARD") return "Standard Listing";

  return value ? String(value) : "Listing Package";
}

function emailButton(label: string, url: string) {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto 0;">
      <tr>
        <td bgcolor="${HAVN_BUTTON}" style="border-radius:10px;">
          <a href="${escapeAttr(url)}"
             style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;border-radius:10px;">
            ${escapeHtml(label)}
          </a>
        </td>
      </tr>
    </table>
  `;
}

function emailTextLink(label: string, url: string) {
  return `
    <div style="margin-top:26px;text-align:center;">
      <a href="${escapeAttr(url)}"
         style="color:#000000;text-decoration:none;font-size:14px;font-weight:800;">
        ${escapeHtml(label)}
      </a>
    </div>
  `;
}

function emailDetailRow(label: string, value?: string | null, accent = false) {
  if (!value) return "";

  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid ${HAVN_BORDER};color:${HAVN_MUTED};font-size:13px;font-weight:700;width:42%;">
        ${escapeHtml(label)}
      </td>
      <td align="right" style="padding:10px 0;border-bottom:1px solid ${HAVN_BORDER};color:${accent ? HAVN_BLUE : HAVN_TEXT};font-size:13px;font-weight:800;">
        ${escapeHtml(value)}
      </td>
    </tr>
  `;
}

function renderApprovedLiveEmail(args: {
  preheader: string;
  recipientName?: string | null;
  listingTitle: string;
  propertyAddress?: string | null;
  propertyMode?: string | null;
  listingPackage?: string | null;
  propertyPrice?: string | null;
  slug?: string | null;
  publicUrl: string;
  coverImageUrl?: string | null;
}) {
  const displayName = String(args.recipientName || "").trim();
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,";
  const imageUrl = args.coverImageUrl ? escapeAttr(args.coverImageUrl) : "";

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>Your HAVN Listing Is Now Live</title>
      </head>
      <body style="margin:0;padding:0;background:${HAVN_LIGHT};font-family:Arial,Helvetica,sans-serif;color:${HAVN_TEXT};">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          ${escapeHtml(args.preheader)}
        </div>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="width:100%;background:${HAVN_LIGHT};padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid ${HAVN_BORDER};box-shadow:0 14px 34px rgba(10,26,51,.10);">
                <tr>
                  <td align="center" style="background:${HAVN_NAVY};padding:20px 28px 18px;">
                    <div style="font-size:25px;line-height:1;font-weight:900;letter-spacing:-1px;color:#ffffff;">
                      havn<span style="color:${HAVN_BLUE};">.ie</span>
                    </div>
                    <div style="margin-top:6px;color:#D8E3F2;font-size:11px;font-weight:700;letter-spacing:.04em;">
                      Find Your Haven
                    </div>
                  </td>
                </tr>

                <tr>
                  <td ${imageUrl ? `background="${imageUrl}"` : ""}
                      style="background-color:${HAVN_NAVY};${imageUrl ? `background-image:url('${imageUrl}');background-position:center;background-size:cover;` : ""}">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td width="58%" valign="top" style="width:58%;padding:30px 30px 31px;background:rgba(3,16,36,.88);">
                          <div style="display:inline-block;width:38px;height:38px;line-height:38px;text-align:center;border-radius:50%;background:#10B981;color:#ffffff;font-size:23px;font-weight:900;">
                            ✓
                          </div>
                          <h1 style="margin:14px 0 16px;color:#ffffff;font-size:28px;line-height:1.12;letter-spacing:-.8px;">
                            Great News!<br />Your HAVN Listing<br />Is Now Live
                          </h1>
                          <p style="margin:0 0 9px;color:#ffffff;font-size:14px;line-height:1.6;">${greeting}</p>
                          <p style="margin:0;color:#E2E8F0;font-size:14px;line-height:1.65;">
                            Your listing has been approved and is now live on HAVN.ie.
                          </p>
                        </td>
                        <td width="42%" style="width:42%;background:rgba(3,16,36,.18);">&nbsp;</td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:26px 30px 30px;background:#ffffff;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        ${imageUrl ? `
                          <td width="180" valign="top" style="width:180px;padding-right:22px;">
                            <img src="${imageUrl}" alt="${escapeAttr(args.listingTitle)}" width="180"
                                 style="display:block;width:180px;max-width:100%;height:170px;object-fit:cover;border:0;border-radius:12px;" />
                          </td>
                        ` : ""}
                        <td valign="top">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            ${emailDetailRow("Property", args.listingTitle)}
                            ${emailDetailRow("Address", args.propertyAddress || null)}
                            ${emailDetailRow("Type", args.propertyMode || null)}
                            ${emailDetailRow("Package", args.listingPackage || null, true)}
                            ${emailDetailRow("Price", args.propertyPrice || null)}
                            ${emailDetailRow("Reference", args.slug || null)}
                            ${emailDetailRow("Status", "Live on HAVN.ie", true)}
                          </table>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px auto 0;">
                      <tr>
                        <td bgcolor="${HAVN_BLUE}" style="border-radius:9px;">
                          <a href="${escapeAttr(args.publicUrl)}"
                             style="display:inline-block;padding:14px 34px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;border-radius:9px;">
                            View My Listing
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="background:${HAVN_NAVY};padding:22px 28px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td valign="top">
                          <div style="font-size:21px;font-weight:900;color:#ffffff;">
                            havn<span style="color:${HAVN_BLUE};">.ie</span>
                          </div>
                          <div style="margin-top:6px;color:#CBD5E1;font-size:11px;font-weight:700;">Find Your Haven</div>
                        </td>
                        <td align="center" valign="top" style="color:#CBD5E1;font-size:10px;line-height:1.6;">
                          Questions?<br />
                          Reply to this email or contact<br />
                          <a href="mailto:support@havn.ie" style="color:#ffffff;text-decoration:none;">support@havn.ie</a>
                        </td>
                        <td align="right" valign="top" style="color:#CBD5E1;font-size:10px;line-height:1.6;">
                          Ireland's Property<br />Intelligence Platform<br />
                          <a href="https://havn.ie" style="color:#ffffff;text-decoration:none;">www.havn.ie</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function renderHavnEmail(args: {
  preheader: string;
  heading: string;
  introHtml: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaUrl?: string;
  ctaStyle?: "button" | "text";
  coverImageUrl?: string | null;
  statusTone?: "success" | "warning" | "neutral";
}) {
  const tone =
    args.statusTone === "success"
      ? { bg: "#ECFDF5", border: "#A7F3D0", icon: "#059669" }
      : args.statusTone === "warning"
      ? { bg: "#FFF7ED", border: "#FED7AA", icon: "#EA580C" }
      : { bg: "#EFF6FF", border: "#BFDBFE", icon: HAVN_BLUE };

  return `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <title>${escapeHtml(args.heading)}</title>
      </head>
      <body style="margin:0;padding:0;background:${HAVN_LIGHT};font-family:Arial,Helvetica,sans-serif;color:${HAVN_TEXT};">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
          ${escapeHtml(args.preheader)}
        </div>

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${HAVN_LIGHT};padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="width:680px;max-width:100%;background:#ffffff;border-radius:20px;overflow:hidden;border:1px solid ${HAVN_BORDER};box-shadow:0 14px 34px rgba(10,26,51,.08);">
                <tr>
                  <td align="center" style="background:${HAVN_NAVY};padding:27px 28px 25px;">
                    <div style="font-size:28px;line-height:1;font-weight:900;letter-spacing:-1.2px;color:#ffffff;">
                      havn<span style="color:${HAVN_BLUE};">.ie</span>
                    </div>
                    <div style="margin-top:7px;color:#D8E3F2;font-size:12px;font-weight:700;letter-spacing:.08em;">
                      Find Your Haven
                    </div>
                  </td>
                </tr>

                ${
                  args.coverImageUrl
                    ? `
                      <tr>
                        <td style="padding:0;line-height:0;">
                          <img src="${escapeAttr(args.coverImageUrl)}" alt="Property" width="680"
                               style="display:block;width:100%;height:290px;object-fit:cover;border:0;" />
                        </td>
                      </tr>
                    `
                    : ""
                }

                <tr>
                  <td style="padding:38px 38px 34px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td style="padding:0 0 24px;">
                          <div style="display:inline-block;width:42px;height:42px;line-height:42px;text-align:center;border-radius:14px;background:${tone.bg};border:1px solid ${tone.border};color:${tone.icon};font-size:22px;font-weight:900;">
                            ${args.statusTone === "warning" ? "!" : "✓"}
                          </div>
                        </td>
                      </tr>
                    </table>

                    <h1 style="margin:0 0 18px;color:${HAVN_NAVY};font-size:31px;line-height:1.12;letter-spacing:-1.1px;">
                      ${escapeHtml(args.heading)}
                    </h1>

                    <div style="font-size:15px;line-height:1.7;color:#334155;">
                      ${args.introHtml}
                    </div>

                    ${args.bodyHtml}

                    ${
                      args.ctaLabel && args.ctaUrl
                        ? args.ctaStyle === "text" || args.ctaLabel === "View My Listings"
                          ? emailTextLink(args.ctaLabel, args.ctaUrl)
                          : emailButton(args.ctaLabel, args.ctaUrl)
                        : ""
                    }
                  </td>
                </tr>

                <tr>
                  <td style="background:${HAVN_NAVY};padding:24px 30px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td valign="top">
                          <div style="font-size:21px;font-weight:900;color:#ffffff;">
                            havn<span style="color:${HAVN_BLUE};">.ie</span>
                          </div>
                          <div style="margin-top:6px;color:#CBD5E1;font-size:12px;font-weight:700;">
                            Find Your Haven
                          </div>
                        </td>
                        <td align="right" valign="top" style="color:#CBD5E1;font-size:11px;line-height:1.6;">
                          Questions?<br />
                          Reply to this email or contact<br />
                          <a href="mailto:support@havn.ie" style="color:#ffffff;text-decoration:none;">support@havn.ie</a>
                        </td>
                      </tr>
                    </table>

                    <div style="border-top:1px solid rgba(255,255,255,.14);margin-top:18px;padding-top:14px;color:#94A3B8;font-size:10px;line-height:1.6;">
                      HAVN.ie · Ireland's Property Intelligence Platform
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

export async function sendUserListingEmail(payload: UserListingEmailPayload) {
  try {
    const title = payload.listingTitle || "your listing";
    const myListingsUrl =
      payload.myListingsUrl || "https://havn.ie/my-listings.html";
    const editUrl =
      payload.editUrl ||
      (payload.listingId
        ? `https://havn.ie/property-upload.html?id=${encodeURIComponent(String(payload.listingId))}`
        : myListingsUrl);

    const displayName = String(payload.recipientName || "").trim();
    const greeting = displayName
      ? `Hi ${escapeHtml(displayName)},`
      : "Hi,";

    const packageName = humanPackage(payload.listingPackage);
    const modeName = humanMode(payload.propertyMode);
    const amountPaid = formatCurrencyFromCents(payload.amountPaidCents);
    const propertyPrice = formatPropertyPrice(payload.price);
    const submittedAt = formatDateTime(payload.submittedAt);

    let subject = "HAVN.ie update";
    let html = "";

    switch (payload.event) {
      case "DRAFT_CREATED":
        subject = "Your HAVN draft listing has been created";
        html = renderHavnEmail({
          preheader: "Your HAVN draft listing is ready.",
          heading: "Your Draft Listing Has Been Created",
          introHtml: `
            <p style="margin:0 0 12px;">${greeting}</p>
            <p style="margin:0;">Your draft listing has been created successfully. You can return at any time to complete it.</p>
          `,
          bodyHtml: `
            <div style="margin-top:26px;padding:20px;border:1px solid ${HAVN_BORDER};border-radius:16px;background:#F8FAFC;">
              <div style="font-size:16px;font-weight:900;color:${HAVN_NAVY};">${escapeHtml(title)}</div>
            </div>
          `,
          ctaLabel: "Continue My Listing",
          ctaUrl: editUrl,
          coverImageUrl: payload.coverImageUrl,
          statusTone: "neutral",
        });
        break;

      case "DRAFT_SAVED":
        subject = "Your HAVN draft listing has been saved";
        html = renderHavnEmail({
          preheader: "Your latest changes have been saved.",
          heading: "Your Draft Has Been Saved",
          introHtml: `
            <p style="margin:0 0 12px;">${greeting}</p>
            <p style="margin:0;">Your latest listing changes were saved successfully.</p>
          `,
          bodyHtml: `
            <div style="margin-top:26px;padding:20px;border:1px solid ${HAVN_BORDER};border-radius:16px;background:#F8FAFC;">
              <div style="font-size:16px;font-weight:900;color:${HAVN_NAVY};">${escapeHtml(title)}</div>
            </div>
          `,
          ctaLabel: "View My Listings",
          ctaUrl: myListingsUrl,
          coverImageUrl: payload.coverImageUrl,
          statusTone: "neutral",
        });
        break;

      case "SUBMITTED":
        subject = "Your HAVN Listing Has Been Submitted";
        html = renderHavnEmail({
          preheader: "Your listing and payment have been received.",
          heading: "Your HAVN Listing Has Been Submitted",
          introHtml: `
            <p style="margin:0 0 12px;">${greeting}</p>
            <p style="margin:0 0 12px;">Thank you for choosing <strong>HAVN.ie</strong>.</p>
            <p style="margin:0;">We've successfully received your listing submission${amountPaid ? " and payment" : ""}.</p>
          `,
          bodyHtml: `
            <div style="margin-top:28px;padding:22px;border:1px solid ${HAVN_BORDER};border-radius:18px;background:#ffffff;">
              <div style="font-size:17px;font-weight:900;color:${HAVN_NAVY};margin-bottom:13px;">Listing Details</div>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                ${emailDetailRow("Property", title)}
                ${emailDetailRow("Address", payload.propertyAddress || null)}
                ${emailDetailRow("Type", modeName)}
                ${emailDetailRow("Package", packageName, true)}
                ${emailDetailRow("Duration", payload.durationDays ? `${payload.durationDays} Days` : null)}
                ${emailDetailRow("Property Price", propertyPrice)}
                ${emailDetailRow("Amount Paid", amountPaid)}
                ${emailDetailRow("Payment Reference", payload.paymentReference || null)}
                ${emailDetailRow("Status", "Submitted for Verification", true)}
                ${emailDetailRow("Submitted On", submittedAt)}
              </table>
            </div>

            <div style="margin-top:22px;padding:22px;border:1px solid #E2E8F0;border-radius:18px;background:#FFFFFF;">
              <div style="font-size:17px;font-weight:900;color:${HAVN_NAVY};margin-bottom:9px;">What happens next?</div>
              <p style="margin:0;color:#334155;font-size:14px;line-height:1.7;">
                Every listing submitted to HAVN is manually reviewed by our verification team.
                Your listing will normally be verified and published within <strong>24 hours</strong>.
                This process helps us maintain the highest standards of quality, trust and transparency for everyone using HAVN.
              </p>
            </div>
          `,
          ctaLabel: "View My Listings",
          ctaUrl: myListingsUrl,
          ctaStyle: "text",
          coverImageUrl: null,
          statusTone: "success",
        });
        break;

      case "APPROVED_LIVE":
        subject = "Your HAVN Listing Is Now Live";
        html = renderApprovedLiveEmail({
          preheader: "Great news — your listing is now live on HAVN.ie.",
          recipientName: payload.recipientName,
          listingTitle: title,
          propertyAddress: payload.propertyAddress,
          propertyMode: modeName,
          listingPackage: packageName,
          propertyPrice,
          slug: payload.slug,
          publicUrl: payload.publicUrl || myListingsUrl,
          coverImageUrl: payload.coverImageUrl,
        });
        break;

      case "REJECTED":
        subject = "Your HAVN Listing Requires Attention";
        html = renderHavnEmail({
          preheader: "Your listing needs an update before it can go live.",
          heading: "Your HAVN Listing Requires Attention",
          introHtml: `
            <p style="margin:0 0 12px;">${greeting}</p>
            <p style="margin:0;">Your listing was not approved during verification. Please review the feedback below and update the listing before resubmitting.</p>
          `,
          bodyHtml: `
            <div style="margin-top:26px;padding:22px;border:1px solid #FED7AA;border-radius:18px;background:#FFF7ED;">
              <div style="font-size:14px;font-weight:900;color:#9A3412;margin-bottom:10px;">Reason for Review</div>
              <div style="font-size:14px;line-height:1.7;color:#7C2D12;">
                ${escapeHtml(payload.reason || "Additional information is required before this listing can be approved.")}
              </div>
            </div>
          `,
          ctaLabel: "Edit My Listing",
          ctaUrl: editUrl,
          coverImageUrl: payload.coverImageUrl,
          statusTone: "warning",
        });
        break;

      case "CLOSED":
        subject = "Your HAVN Listing Has Been Closed";
        html = renderHavnEmail({
          preheader: "Your HAVN listing has been marked as closed.",
          heading: "Your HAVN Listing Has Been Closed",
          introHtml: `
            <p style="margin:0 0 12px;">${greeting}</p>
            <p style="margin:0;">Your listing has been marked as <strong>${escapeHtml(String(payload.closeOutcome || "closed").toLowerCase())}</strong>.</p>
          `,
          bodyHtml: `
            <div style="margin-top:26px;padding:20px;border:1px solid ${HAVN_BORDER};border-radius:16px;background:#F8FAFC;">
              <div style="font-size:16px;font-weight:900;color:${HAVN_NAVY};">${escapeHtml(title)}</div>
            </div>
          `,
          ctaLabel: "View My Listings",
          ctaUrl: myListingsUrl,
          coverImageUrl: payload.coverImageUrl,
          statusTone: "neutral",
        });
        break;
    }

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
 * SAVED SEARCH MATCH EMAIL
 * ----------------------------
 */
export async function sendSavedSearchMatchEmail(args: {
  to: string;
  propertyTitle: string;
  propertyPrice?: number | null;
  propertyLocation?: string | null;
  propertyUrl: string;
  mode?: string | null;
}) {
  try {
    const price =
      typeof args.propertyPrice === "number" && Number.isFinite(args.propertyPrice)
        ? new Intl.NumberFormat("en-IE", {
            style: "currency",
            currency: "EUR",
            maximumFractionDigits: 0,
          }).format(args.propertyPrice)
        : "Price on request";

    const subject = `New matching property on HAVN: ${args.propertyTitle}`;

    const html = `
      <h2>New matching property on HAVN</h2>
      <p>A new property matching one of your saved alerts has just gone live.</p>

      <div style="border:1px solid #e5e7eb;border-radius:14px;padding:14px;margin:18px 0;background:#fafafa;">
        <p style="margin:0 0 8px;"><strong>${escapeHtml(args.propertyTitle)}</strong></p>
        <p style="margin:0 0 8px;"><strong>${escapeHtml(price)}</strong></p>
        ${args.propertyLocation ? `<p style="margin:0 0 8px;color:#64748b;">${escapeHtml(args.propertyLocation)}</p>` : ""}
        ${args.mode ? `<p style="margin:0;color:#64748b;">${escapeHtml(String(args.mode).toUpperCase())}</p>` : ""}
      </div>

      <p><a href="${escapeAttr(args.propertyUrl)}">View property on HAVN</a></p>

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
    console.error("sendSavedSearchMatchEmail failed:", err);
    return null;
  }
}

/**
 * ----------------------------
 * PROPERTY LEAD EMAIL
 * ----------------------------
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
    const displayName = String(args.name || "").trim();
    const subject = "Welcome to HAVN.ie";

    const html = renderHavnEmail({
      preheader: "Welcome to HAVN.ie — Find Your Haven",
      heading: "Welcome to HAVN.ie",
      introHtml: `
        <p style="margin:0 0 12px;">${displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,"}</p>
        <p style="margin:0 0 12px;">Your HAVN account has been created successfully.</p>
        <p style="margin:0;">You can now create property listings, save searches and manage your property journey in one place.</p>
      `,
      bodyHtml: `
        <div style="margin-top:24px;padding:22px;border:1px solid #BFDBFE;border-radius:18px;background:#EFF6FF;">
          <div style="font-size:16px;font-weight:900;color:${HAVN_NAVY};margin-bottom:8px;">A cleaner, more trusted property experience</div>
          <div style="font-size:14px;line-height:1.7;color:#334155;">Explore homes, manage listings and connect with serious buyers, renters and sharers across Ireland.</div>
        </div>
      `,
      ctaLabel: "Go to My Listings",
      ctaUrl: "https://havn.ie/my-listings.html",
      statusTone: "success",
    });

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
    const displayName = String(args.name || "").trim();
    const subject = "Reset your HAVN.ie password";

    const html = renderHavnEmail({
      preheader: "Reset your HAVN.ie password securely.",
      heading: "Reset Your Password",
      introHtml: `
        <p style="margin:0 0 12px;">${displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,"}</p>
        <p style="margin:0;">We received a request to reset your HAVN.ie password.</p>
      `,
      bodyHtml: `
        <div style="margin-top:24px;padding:20px;border:1px solid ${HAVN_BORDER};border-radius:16px;background:#F8FAFC;color:${HAVN_MUTED};font-size:13px;line-height:1.7;">
          If you did not request this password reset, you can safely ignore this email.
        </div>
      `,
      ctaLabel: "Reset My Password",
      ctaUrl: args.resetUrl,
      statusTone: "neutral",
    });

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
    const displayName = String(args.name || "").trim();
    const subject = "Verify your email for HAVN.ie";

    const html = renderHavnEmail({
      preheader: "Verify your email to finish setting up your HAVN.ie account.",
      heading: "Verify Your Email",
      introHtml: `
        <p style="margin:0 0 12px;">${displayName ? `Hi ${escapeHtml(displayName)},` : "Hi,"}</p>
        <p style="margin:0;">Please verify your email address to finish setting up your HAVN.ie account.</p>
      `,
      bodyHtml: `
        <div style="margin-top:24px;padding:20px;border:1px solid ${HAVN_BORDER};border-radius:16px;background:#F8FAFC;color:${HAVN_MUTED};font-size:13px;line-height:1.7;">
          This verification link expires in 30 minutes.
        </div>
      `,
      ctaLabel: "Verify My Email",
      ctaUrl: args.verifyUrl,
      statusTone: "success",
    });

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
 * ----------------------------
 * HAVN WEEKLY DIGEST EMAIL
 * ----------------------------
 */
export type HavnWeeklyDigestProperty = {
  title: string;
  price?: number | null;
  location?: string | null;
  beds?: number | null;
  baths?: number | null;
  url: string;
  imageUrl?: string | null;
  badge?: string | null;
};

export async function sendHavnWeeklyDigestEmail(args: {
  to: string;
  name?: string | null;
  newMatchesCount: number;
  featuredCount: number;
  priceDropsCount?: number;
  trendingAreasCount?: number;
  recentlyViewedCount?: number;
  matchesUrl: string;
  manageAlertsUrl?: string;
  properties: HavnWeeklyDigestProperty[];
}) {
  try {
    const displayName = (args.name || "").trim();
    const newMatchesCount = Math.max(0, Number(args.newMatchesCount || 0));
    const featuredCount = Math.max(0, Number(args.featuredCount || 0));
    const priceDropsCount = Math.max(0, Number(args.priceDropsCount || 0));
    const trendingAreasCount = Math.max(0, Number(args.trendingAreasCount || 0));
    const recentlyViewedCount = Math.max(0, Number(args.recentlyViewedCount || 0));

    const subject =
      newMatchesCount > 0
        ? `Your HAVN Weekly: ${newMatchesCount} new matching ${newMatchesCount === 1 ? "home" : "homes"}`
        : "Your HAVN Weekly property update";

    const propertiesHtml = (args.properties || []).slice(0, 4).map((p) => {
      const price =
        typeof p.price === "number" && Number.isFinite(p.price)
          ? new Intl.NumberFormat("en-IE", {
              style: "currency",
              currency: "EUR",
              maximumFractionDigits: 0,
            }).format(p.price)
          : "Price on request";

      const meta = [
        p.beds ? `${p.beds} Bed` : "",
        p.baths ? `${p.baths} Bath` : "",
      ].filter(Boolean).join(" • ");

      return `
        <td width="25%" valign="top" style="width:25%;padding:8px;vertical-align:top;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;background:#ffffff;">
            <tr>
              <td align="center" style="padding:0;">
                <table role="presentation" width="170" cellspacing="0" cellpadding="0" style="width:170px;">
                  <tr>
                    <td width="170" height="120" style="width:170px;height:120px;overflow:hidden;background:#e5e7eb;line-height:0;font-size:0;">
                      ${
                        p.imageUrl
                          ? `<img src="${escapeAttr(p.imageUrl)}" alt="${escapeAttr(p.title)}" width="170" height="120" style="display:block;width:170px;height:120px;border:0;outline:none;text-decoration:none;" />`
                          : `<div style="width:170px;height:120px;background:linear-gradient(135deg,#eef2ff,#f8fafc);"></div>`
                      }
                    </td>
                  </tr>

                  ${
                    p.badge
                      ? `
                        <tr>
                          <td style="background:#4f46e5;color:#ffffff;font-size:11px;font-weight:800;padding:6px 10px;text-align:center;">
                            ${escapeHtml(p.badge)}
                          </td>
                        </tr>
                      `
                      : ``
                  }
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:12px;">
                <div style="font-size:17px;font-weight:900;color:#071326;margin-bottom:5px;">
                  ${escapeHtml(price)}
                </div>

                ${
                  meta
                    ? `<div style="font-size:13px;color:#334155;margin-bottom:5px;">${escapeHtml(meta)}</div>`
                    : ``
                }

                <div style="font-size:13px;color:#071326;line-height:1.35;font-weight:700;">
                  ${escapeHtml(p.title)}
                </div>

                ${
                  p.location
                    ? `<div style="font-size:12px;color:#64748b;line-height:1.45;margin-top:6px;">${escapeHtml(p.location)}</div>`
                    : ``
                }

                <div style="margin-top:12px;">
                  <a href="${escapeAttr(p.url)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-size:12px;font-weight:800;padding:9px 14px;border-radius:8px;">
                    View property →
                  </a>
                </div>
              </td>
            </tr>
          </table>
        </td>
      `;
    }).join("");

    const html = `
      <div style="margin:0;padding:0;background:#f5f7fb;font-family:Arial,Helvetica,sans-serif;color:#071326;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fb;padding:24px 0;">
          <tr>
            <td align="center">
              <table role="presentation" width="760" cellspacing="0" cellpadding="0" style="width:760px;max-width:100%;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e5e7eb;">
                
                <tr>
                  <td style="background:#071326;padding:22px 28px;border-top:6px solid #4f46e5;">
                    <table role="presentation" width="100%">
                      <tr>
                        <td>
                          <div style="display:inline-block;border:1px solid rgba(255,255,255,0.35);border-radius:10px;padding:12px 16px;color:#fff;font-weight:900;letter-spacing:.04em;">LOGO</div>
                          <span style="font-size:28px;font-weight:900;color:#fff;margin-left:14px;vertical-align:middle;">havn.ie</span>
                          <div style="font-size:13px;color:#cbd5e1;margin-top:6px;">Ireland’s curated property marketplace.</div>
                        </td>
                        <td align="right" style="font-size:13px;">
                          <a href="${escapeAttr(args.matchesUrl)}" style="color:#e0e7ff;text-decoration:underline;">View in browser</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:42px 34px 30px;background:linear-gradient(90deg,#ffffff 0%,#ffffff 50%,#eff6ff 100%);">
                    <div style="color:#4f46e5;font-size:14px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;">Your HAVN Weekly</div>
                    <h1 style="font-size:42px;line-height:1.05;margin:0 0 16px;color:#071326;letter-spacing:-1.5px;">
                      Your property <span style="color:#4f46e5;">update</span> is here. 🏡
                    </h1>
                    <p style="font-size:17px;line-height:1.55;color:#334155;margin:0 0 24px;max-width:470px;">
                      ${displayName ? `Hi ${escapeHtml(displayName)}, ` : ""}here’s your personalised weekly update with new listings that match your saved searches, featured homes, price changes and market insights.
                    </p>
                    <a href="${escapeAttr(args.matchesUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:900;padding:15px 22px;border-radius:9px;">
                      View all matches →
                    </a>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 24px 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:18px;">
                      <tr>
                        ${metricCell(newMatchesCount, "NEW MATCHES", "Across your searches")}
                        ${metricCell(featuredCount, "FEATURED HOMES", "Hand-picked for you")}
                        ${metricCell(priceDropsCount, "PRICE DROPS", "Great new opportunities")}
                        ${metricCell(trendingAreasCount, "TRENDING AREAS", "Heating up this week")}
                        ${metricCell(recentlyViewedCount, "RECENTLY VIEWED", "New since you last visited")}
                      </tr>
                    </table>
                  </td>
                </tr>

                ${
                  propertiesHtml
                    ? `
                      <tr>
                        <td style="padding:12px 24px 8px;">
                          <table role="presentation" width="100%">
                            <tr>
                              <td>
                                <h2 style="font-size:24px;margin:0;color:#071326;">New matches for your searches</h2>
                              </td>
                              <td align="right">
                                <a href="${escapeAttr(args.matchesUrl)}" style="color:#4f46e5;font-weight:900;text-decoration:none;">View all (${newMatchesCount}) →</a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                      <tr>
                        <td style="padding:0 16px 24px;">
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                            <tr>${propertiesHtml}</tr>
                          </table>
                        </td>
                      </tr>
                    `
                    : `
                      <tr>
                        <td style="padding:20px 28px 30px;">
                          <div style="border:1px solid #e5e7eb;background:#f8fafc;border-radius:16px;padding:22px;text-align:center;">
                            <h2 style="margin:0 0 8px;font-size:22px;color:#071326;">No new matches this week</h2>
                            <p style="margin:0;color:#64748b;line-height:1.5;">We’ll keep watching your saved searches and let you know when the right homes appear.</p>
                          </div>
                        </td>
                      </tr>
                    `
                }

                <tr>
                  <td style="padding:0 24px 24px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        ${insightCard("PRICE DROPS", `${priceDropsCount} properties with price reductions`, "Save on your next move", "View price drops →", args.matchesUrl)}
                        ${insightCard("TRENDING THIS WEEK", `${trendingAreasCount || 3} areas are heating up`, "See where buyer demand is moving", "Explore areas →", args.matchesUrl)}
                        ${insightCard("FEATURED HOMES", `${featuredCount} homes hand-picked for you`, "Don’t miss these", "See featured homes →", args.matchesUrl)}
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 24px 28px;">
                    <table role="presentation" width="100%" style="background:#f5f3ff;border:1px solid #ede9fe;border-radius:16px;">
                      <tr>
                        <td style="padding:20px;">
                          <div style="font-size:18px;font-weight:900;color:#071326;">Never miss a match</div>
                          <div style="font-size:14px;color:#334155;line-height:1.5;margin-top:4px;">Weekly updates for homes that match your top searches. You’re in control.</div>
                        </td>
                        <td align="right" style="padding:20px;">
                          <a href="${escapeAttr(args.manageAlertsUrl || "https://havn.ie/my-listings.html")}" style="display:inline-block;border:1px solid #4f46e5;color:#4f46e5;text-decoration:none;font-weight:900;padding:13px 18px;border-radius:9px;">Manage alerts →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="background:#071326;padding:24px 28px;color:#cbd5e1;">
                    <table role="presentation" width="100%">
                      <tr>
                        <td>
                          <div style="font-size:22px;font-weight:900;color:#fff;">havn.ie</div>
                          <div style="font-size:12px;margin-top:4px;">Ireland’s curated property marketplace.</div>
                        </td>
                        <td align="right" style="font-size:13px;line-height:1.5;">
                          We’re here to help.<br />
                          hello@havn.ie
                        </td>
                      </tr>
                    </table>
                    <div style="border-top:1px solid rgba(255,255,255,0.14);margin-top:18px;padding-top:14px;font-size:11px;color:#94a3b8;">
                      HAVN Property Group Ltd. Registered in Ireland.
                      <span style="float:right;"><a href="${escapeAttr(args.manageAlertsUrl || "https://havn.ie/my-listings.html")}" style="color:#cbd5e1;">Unsubscribe</a></span>
                    </div>
                  </td>
                </tr>

              </table>
            </td>
          </tr>
        </table>
      </div>
    `;

    return await resend.emails.send({
      from: FROM,
      to: args.to,
      subject,
      html,
    });
  } catch (err) {
    console.error("sendHavnWeeklyDigestEmail failed:", err);
    return null;
  }
}

function metricCell(value: number, label: string, sub: string) {
  return `
    <td align="center" style="padding:22px 10px;border-right:1px solid #e5e7eb;">
      <div style="font-size:30px;font-weight:900;color:#071326;line-height:1;">${escapeHtml(String(value))}</div>
      <div style="font-size:12px;font-weight:900;color:#071326;margin-top:8px;">${escapeHtml(label)}</div>
      <div style="font-size:12px;color:#64748b;margin-top:5px;">${escapeHtml(sub)}</div>
    </td>
  `;
}

function insightCard(label: string, title: string, sub: string, cta: string, url: string) {
  return `
    <td style="width:33.333%;padding:8px;vertical-align:top;">
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:16px;padding:18px;min-height:138px;">
        <div style="font-size:11px;font-weight:900;color:#4f46e5;letter-spacing:.05em;margin-bottom:12px;">${escapeHtml(label)}</div>
        <div style="font-size:20px;line-height:1.15;font-weight:900;color:#071326;margin-bottom:8px;">${escapeHtml(title)}</div>
        <div style="font-size:13px;color:#334155;margin-bottom:14px;">${escapeHtml(sub)}</div>
        <a href="${escapeAttr(url)}" style="color:#4f46e5;text-decoration:none;font-weight:900;font-size:13px;">${escapeHtml(cta)}</a>
      </div>
    </td>
  `;
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