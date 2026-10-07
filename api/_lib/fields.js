// What the team is allowed to save, and how screen fields map to database columns.
// Anything not listed here is rejected, so a bad request can't write junk into the database.
import { HttpError } from "./http.js";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const GID = /^gid:\/\/shopify\/Order\/\d{1,20}$/;
const text = (max) => (v) => {
  if (typeof v !== "string") throw new Error("must be text");
  const s = v.replace(/[\u0000-\u001f]/g, " ").trim();
  if (s.length > max) throw new Error(`must be at most ${max} characters`);
  return s;
};
const dayOrBlank = (v) => {
  if (v === "" || v == null) return null;
  if (typeof v !== "string" || !DAY.test(v)) throw new Error("must be a date");
  return v;
};
const isoTime = (v) => {
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new Error("must be a time");
  return new Date(v).toISOString();
};
const url = (v) => {
  const s = text(500)(v);
  if (s && !/^https?:\/\/[^\s]+$/i.test(s)) throw new Error("must be a link starting with http");
  return s;
};

export const IDS = {
  influencer: /^inf_[0-9a-f]{1,20}$/,
  shipment: /^o_\d{1,20}$/,
};

// screen field -> [column, validator]
const SPEC = {
  influencer: {
    name: ["name", text(120)],
    city: ["city", text(80)],
    orderIds: ["order_ids", (v) => {
      if (!Array.isArray(v) || v.length > 1000 || !v.every((x) => typeof x === "string" && GID.test(x))) throw new Error("must be Shopify order IDs");
      return [...new Set(v)];
    }],
    firstSeeded: ["first_seeded", isoTime],
    code: ["code", text(60)],
    pct: ["pct", (v) => {
      if (v === null || v === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error("must be between 0 and 100");
      return Math.round(n * 100) / 100;
    }],
  },
  shipment: {
    order: ["order_name", text(30)],
    influencer: ["influencer_id", (v) => { const s = text(40)(v); if (s && !IDS.influencer.test(s)) throw new Error("is not an influencer id"); return s; }],
    content: ["content", (v) => { if (!["pending", "posted", "skip"].includes(v)) throw new Error("must be pending, posted or skip"); return v; }],
    contentLink: ["content_link", url],
    postedOn: ["posted_on", dayOrBlank],
    deliveredOn: ["delivered_on", dayOrBlank],
    r1Sent: ["r1_sent", dayOrBlank],
    r2Sent: ["r2_sent", dayOrBlank],
  },
};

export function toColumns(kind, patch) {
  const spec = SPEC[kind];
  if (!spec) throw new HttpError(400, "bad_kind", "Unknown record type.");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new HttpError(400, "bad_patch", "Nothing to save.");
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const s = spec[k];
    if (!s) throw new HttpError(400, "bad_field", `“${k}” can’t be saved.`);
    try { out[s[0]] = s[1](v); } catch (e) { throw new HttpError(400, "bad_value", `${k} ${e.message}.`); }
  }
  return out;
}

export const SETTINGS_DEFAULTS = {
  r1Days: 3, r2Days: 7, stopDays: 30,
  r1Msg: "Hi {name}! Hope you’re loving the Valantis pieces we sent ({articles}). Whenever you’re ready, we’d love to see your content. Don’t forget to share your code {code} so your audience gets the discount. Thank you!",
  r2Msg: "Hi {name}, just following up on the Valantis collab. Could you let us know when your post with {articles} is going live? Your code {code} is active for your followers. Thanks!",
};
export function settingsIn(patch) {
  if (!patch || typeof patch !== "object") throw new HttpError(400, "bad_patch", "Nothing to save.");
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    if (["r1Days", "r2Days", "stopDays"].includes(k)) {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < 0 || n > 365) throw new HttpError(400, "bad_value", `${k} must be 0–365 days.`);
      out[k] = n;
    } else if (["r1Msg", "r2Msg"].includes(k)) {
      if (typeof v !== "string" || v.length > 1000) throw new HttpError(400, "bad_value", "Messages must be under 1,000 characters.");
      out[k] = v;
    } else throw new HttpError(400, "bad_field", `“${k}” can’t be saved.`);
  }
  return out;
}

const d = (v) => (v ? String(v).slice(0, 10) : "");
export const influencerOut = (r) => ({
  id: r.id, name: r.name || "", city: r.city || "", orderIds: r.order_ids || [], firstSeeded: r.first_seeded || "",
  code: r.code || "", pct: r.pct == null ? null : Number(r.pct), updatedAt: r.updated_at, updatedBy: r.updated_by || "",
});
export const shipmentOut = (r) => ({
  id: r.id, order: r.order_name || "", influencer: r.influencer_id || "", content: r.content || "pending", contentLink: r.content_link || "",
  postedOn: d(r.posted_on), deliveredOn: d(r.delivered_on), r1Sent: d(r.r1_sent), r2Sent: d(r.r2_sent), updatedAt: r.updated_at, updatedBy: r.updated_by || "",
});
