// GET /api/data?since=<ISO time>
// Returns the team's saved data. With `since`, only rows changed after that moment,
// which is how each open screen picks up teammates' edits every few seconds.
import { route, send, HttpError } from "./_lib/http.js";
import { requireSession } from "./_lib/auth.js";
import { db, check } from "./_lib/db.js";
import { influencerOut, shipmentOut, SETTINGS_DEFAULTS } from "./_lib/fields.js";

export default route(async (req, res) => {
  if (req.method !== "GET") throw new HttpError(405, "method", "Use GET.");
  requireSession(req);
  const since = String(req.query?.since || "");
  if (since && Number.isNaN(Date.parse(since))) throw new HttpError(400, "bad_since", "Invalid time.");

  // Read the clock first (minus a small margin) so an edit saved while we query is never missed.
  const serverTime = new Date(Date.now() - 3000).toISOString();
  const pick = (table) => {
    let q = db().from(table).select("*");
    if (since) q = q.gt("updated_at", since);
    return q;
  };
  const [inf, ship, settings] = await Promise.all([
    pick("influencers"),
    pick("shipments"),
    db().from("settings").select("*").eq("id", "reminders").maybeSingle(),
  ]);

  send(res, 200, {
    serverTime,
    influencers: check(inf, "reading influencers").map(influencerOut),
    shipments: check(ship, "reading shipments").map(shipmentOut),
    settings: { ...SETTINGS_DEFAULTS, ...(check(settings, "reading settings")?.data || {}) },
  });
});
