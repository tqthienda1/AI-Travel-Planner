import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthenticatedCaller, UserRole } from "./types.js";

const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ALLOWED_ROLES = new Set<UserRole>(["member", "business", "admin"]);

export const DEFAULT_LOCAL_HMAC_KEY = ["ai-travel-planner", "dev", "hs256", "key"].join("-");

function encodeBase64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) {
    return null;
  }
  const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64");
}

function signSegment(signingInput: string, signingKey: string): string {
  return encodeBase64Url(createHmac("sha256", signingKey).update(signingInput).digest());
}

export interface CredentialClaims {
  sub: string;
  role: UserRole;
  exp: number;
  jti?: string;
}

export function createSignedJwt(
  claims: CredentialClaims,
  signingKey: string = DEFAULT_LOCAL_HMAC_KEY,
): string {
  const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = encodeBase64Url(JSON.stringify(claims));
  const signingInput = `${header}.${payload}`;
  const signature = signSegment(signingInput, signingKey);
  return `${signingInput}.${signature}`;
}

export function verifyAuthorizationHeader(
  headerValue: string | undefined,
  options: {
    signingKey: string;
    now: Date;
    revokedIds?: ReadonlySet<string>;
  },
): AuthenticatedCaller | null {
  if (!headerValue || !headerValue.startsWith("Bearer ")) {
    return null;
  }

  const rawJwt = headerValue.slice("Bearer ".length).trim();
  const segments = rawJwt.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [headerPart, payloadPart, signaturePart] = segments;
  if (!headerPart || !payloadPart || !signaturePart) {
    return null;
  }

  const expectedSig = signSegment(`${headerPart}.${payloadPart}`, options.signingKey);
  const actualBuf = Buffer.from(signaturePart, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
    return null;
  }

  const headerBuf = decodeBase64Url(headerPart);
  const payloadBuf = decodeBase64Url(payloadPart);
  if (!headerBuf || !payloadBuf) {
    return null;
  }

  let parsedHeader: unknown;
  let parsedPayload: unknown;
  try {
    parsedHeader = JSON.parse(headerBuf.toString("utf8"));
    parsedPayload = JSON.parse(payloadBuf.toString("utf8"));
  } catch {
    return null;
  }

  if (
    typeof parsedHeader !== "object" ||
    parsedHeader === null ||
    (parsedHeader as Record<string, unknown>).alg !== "HS256"
  ) {
    return null;
  }

  if (typeof parsedPayload !== "object" || parsedPayload === null) {
    return null;
  }

  const claims = parsedPayload as Record<string, unknown>;
  const sub = claims.sub;
  const role = claims.role;
  const exp = claims.exp;
  const jti = claims.jti;

  if (typeof sub !== "string" || !UUID_V4_REGEX.test(sub)) {
    return null;
  }
  if (typeof role !== "string" || !ALLOWED_ROLES.has(role as UserRole)) {
    return null;
  }
  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return null;
  }

  const nowEpochSeconds = Math.floor(options.now.getTime() / 1000);
  if (exp <= nowEpochSeconds) {
    return null;
  }

  if (jti !== undefined) {
    if (typeof jti !== "string" || jti.length === 0) {
      return null;
    }
    if (options.revokedIds?.has(jti)) {
      return null;
    }
  }

  return {
    userId: sub,
    role: role as UserRole,
    exp,
    ...(jti !== undefined ? { jti } : {}),
  };
}
