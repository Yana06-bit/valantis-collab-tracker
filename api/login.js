// POST /api/login  { password, name }
// Checks the shared team password and sets the login cookie.
// Too many wrong passwords from one network in 15 minutes → locked for a while.
import { route, send, body, requirePost, clientIp, HttpError } from "./_lib/http.js";
import { passwordMatches, makeSessionCookie } from "./_lib/auth.js";
import { db, check } from "./_lib/db.js";

const WINDOW_MIN = 15, MAX_FAILS = 10;

export default route(async (req, res) => {
  requirePost(req);
  const { password, name } = body(req);
  const who = String(name || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!who) throw new HttpError(400, "name_required", "Enter your name so the team can see who changed what.");

  const ip = clientIp(req);
  const since = new Date(Date.now() - WINDOW_MIN * 60000).toISOString();
  const { count } = await db().from("login_failures").select("*", { count: "exact", head: true }).eq("ip", ip).gte("at", since);
  if ((count || 0) >= MAX_FAILS) throw new HttpError(429, "locked", `Too many wrong passwords. Try again in ${WINDOW_MIN} minutes.`);

  if (!passwordMatches(password)) {
    check(await db().from("login_failures").insert({ ip }), "recording a failed login");
    await new Promise((ok) => setTimeout(ok, 600)); // slow down guessing
    throw new HttpError(401, "wrong_password", "That password isn’t right.");
  }

  res.setHeader("Set-Cookie", makeSessionCookie(who));
  send(res, 200, { name: who });
});
