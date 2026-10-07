// POST /api/save
//   { kind: "influencer" | "shipment", id, patch, createOnly? }
//   { kind: "settings", patch }
//
// - patch: only the fields that changed, e.g. { code: "TEJAS20" } or { content: "posted" }.
// - createOnly: used when the screen finds a new influencer in Shopify. It creates the row
//   if it doesn't exist and never overwrites what the team already typed.
// Every real edit is also written to the `edits` table: who, when, what.
import { route, send, body, requirePost, HttpError } from "./_lib/http.js";
import { requireSession } from "./_lib/auth.js";
import { db, check } from "./_lib/db.js";
import { IDS, toColumns, settingsIn, influencerOut, shipmentOut, SETTINGS_DEFAULTS } from "./_lib/fields.js";

const TABLE = { influencer: "influencers", shipment: "shipments" };
const OUT = { influencer: influencerOut, shipment: shipmentOut };

export default route(async (req, res) => {
  requirePost(req);
  const who = requireSession(req).name;
  const { kind, id, patch, createOnly } = body(req);
  const now = new Date().toISOString();

  if (kind === "settings") {
    const clean = settingsIn(patch);
    const cur = check(await db().from("settings").select("*").eq("id", "reminders").maybeSingle(), "reading settings");
    const data = { ...SETTINGS_DEFAULTS, ...(cur?.data || {}), ...clean };
    check(await db().from("settings").upsert({ id: "reminders", data, updated_at: now, updated_by: who }, { onConflict: "id" }), "saving settings");
    await log(who, "settings", "reminders", clean);
    return send(res, 200, { settings: data });
  }

  if (!TABLE[kind]) throw new HttpError(400, "bad_kind", "Unknown record type.");
  if (typeof id !== "string" || !IDS[kind].test(id)) throw new HttpError(400, "bad_id", "Invalid record id.");
  const cols = toColumns(kind, patch);

  const row = { id, ...cols, updated_at: now, updated_by: who };
  const rows = check(
    await db().from(TABLE[kind]).upsert(row, { onConflict: "id", ignoreDuplicates: !!createOnly }).select(),
    `saving ${kind}`,
  );
  // Roster bookkeeping (new influencer found, new order linked) isn't a human edit; keep the log clean.
  const bookkeeping = createOnly || Object.keys(cols).every((c) => c === "order_ids");
  if (!bookkeeping) await log(who, kind, id, patch);
  send(res, 200, { row: rows?.[0] ? OUT[kind](rows[0]) : null });
});

async function log(who, kind, rowId, changes) {
  const r = await db().from("edits").insert({ who, kind, row_id: rowId, changes });
  if (r.error) console.error("[edits] could not log change", r.error.message); // never block a save on the log
}
