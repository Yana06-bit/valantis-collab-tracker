// Team login with one shared password.
//
// How it works:
// 1. Someone types the team password + their name on the login screen.
// 2. If the password matches TEAM_PASSWORD, we set a signed cookie (valid 30 days).
//    The cookie holds their name (for the "who changed what" log) and is signed with
//    SESSION_SECRET, so nobody can forge or edit it.
// 3. The cookie also carries a fingerprint of the current password, so changing
//    TEAM_PASSWORD in Vercel logs everyone out immediately.
import crypto from "node:crypto";
import { HttpError } from "./http.js";

const COOKIE = "vct_session";
const MAX_AGE_S = 30 * 24 * 60 * 60;

function secret() {
  const s = process.env.SESSION_SECRET || "";
  if (s.length < 32) throw new Error("SESSION_SECRET is missing or shorter than 32 characters.");
  return s;
}
const b64 = (buf) => Buffer.from(buf).toString("base64url");
const hmac = (data) => crypto.createHmac("sha256", secret()).update(data).digest();
const passwordFingerprint = () => b64(hmac("pw:" + (process.env.TEAM_PASSWORD || ""))).slice(0, 16);

export function passwordMatches(input) {
  const real = process.env.TEAM_PASSWORD || "";
  if (real.length < 8) throw new Error("TEAM_PASSWORD is missing or shorter than 8 characters.");
  // Compare fixed-length digests so the check takes the same time whatever was typed.
  const a = hmac("cmp:" + String(input || "")), b = hmac("cmp:" + real);
  return crypto.timingSafeEqual(a, b);
}

export function makeSessionCookie(name) {
  const payload = b64(JSON.stringify({ n: name, pv: passwordFingerprint(), exp: Math.floor(Date.now() / 1000) + MAX_AGE_S }));
  const token = payload + "." + b64(hmac(payload));
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`;
}
export const clearSessionCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

function readCookie(req, name) {
  const raw = String(req.headers.cookie || "");
  for (const part of raw.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return "";
}

// Returns { name } for a valid session, otherwise null.
export function getSession(req) {
  const token = readCookie(req, COOKIE);
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = b64(hmac(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return null; }
  if (!data || data.exp < Date.now() / 1000 || data.pv !== passwordFingerprint()) return null;
  return { name: String(data.n || "Team member").slice(0, 60) };
}

export function requireSession(req) {
  const s = getSession(req);
  if (!s) throw new HttpError(401, "login_required", "Please log in again.");
  return s;
}
