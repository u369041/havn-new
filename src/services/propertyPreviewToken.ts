import crypto from "crypto";

const PREVIEW_PREFIX = "havn-preview";
const DEFAULT_TTL_SECONDS = 10 * 60;
const MAX_TTL_SECONDS = 30 * 60;

export type PropertyPreviewTokenPayload = {
  v: 1;
  inventoryPropertyId: number;
  agencyId: number;
  exp: number;
};

function previewSecret(): string {
  const secret = String(process.env.PROPERTY_PREVIEW_SECRET || "").trim();
  if (!secret) {
    throw new Error("PROPERTY_PREVIEW_SECRET missing");
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(payloadPart: string): string {
  return crypto
    .createHmac("sha256", previewSecret())
    .update(`${PREVIEW_PREFIX}.${payloadPart}`)
    .digest("base64url");
}

export function createPropertyPreviewToken(
  inventoryPropertyId: number,
  agencyId: number,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): { token: string; expiresAt: Date } {
  if (!Number.isSafeInteger(inventoryPropertyId) || inventoryPropertyId <= 0) {
    throw new Error("Invalid inventory property id");
  }
  if (!Number.isSafeInteger(agencyId) || agencyId <= 0) {
    throw new Error("Invalid agency id");
  }

  const ttl = Math.max(60, Math.min(MAX_TTL_SECONDS, Math.round(ttlSeconds)));
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload: PropertyPreviewTokenPayload = {
    v: 1,
    inventoryPropertyId,
    agencyId,
    exp,
  };

  const payloadPart = base64url(JSON.stringify(payload));
  const signature = sign(payloadPart);

  return {
    token: `${PREVIEW_PREFIX}.${payloadPart}.${signature}`,
    expiresAt: new Date(exp * 1000),
  };
}

export function parsePropertyPreviewToken(
  raw: unknown,
): PropertyPreviewTokenPayload | null {
  const token = String(raw || "").trim();
  if (!token.startsWith(`${PREVIEW_PREFIX}.`)) return null;

  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== PREVIEW_PREFIX) return null;

  const payloadPart = parts[1];
  const suppliedSignature = parts[2];

  let expectedSignature: string;
  try {
    expectedSignature = sign(payloadPart);
  } catch {
    return null;
  }

  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(supplied, expected)) return null;

  let payload: PropertyPreviewTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (
    payload?.v !== 1 ||
    !Number.isSafeInteger(payload.inventoryPropertyId) ||
    payload.inventoryPropertyId <= 0 ||
    !Number.isSafeInteger(payload.agencyId) ||
    payload.agencyId <= 0 ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return payload;
}

export function isPropertyPreviewToken(raw: unknown): boolean {
  return String(raw || "").trim().startsWith(`${PREVIEW_PREFIX}.`);
}
