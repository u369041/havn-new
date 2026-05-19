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
          <p><strong>${escapeHtml(title)}</strong></p>
          ${payload.slug ? `<p><strong>Listing reference:</strong> ${escapeHtml(String(payload.slug))}</p>` : ""}
          ${payload.publicUrl ? `<p><a href="${escapeAttr(payload.publicUrl)}">View your listing</a></p>` : ""}
          <p><a href="${escapeAttr(myListingsUrl)}">Go to My Listings</a></p>
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