// Run with: npm test
// Exercises the real API code against a fake Shopify and an in-memory database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../scripts/dev-server.js";
import { fakeDb, fakeShopify, SAMPLE_ORDERS, SAMPLE_SALES, testEnv } from "./fakes.js";

let server, base, shopify, db;
before(async () => {
  testEnv();
  db = globalThis.__TEST_DB__ = fakeDb();
  shopify = fakeShopify(SAMPLE_ORDERS, SAMPLE_SALES);
  server = createServer();
  await new Promise((ok) => server.listen(0, ok));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); shopify.restore(); });

let cookie = "";
async function call(path, payload, { headers = {}, ip = "1.1.1.1" } = {}) {
  const init = payload === undefined
    ? { headers: { cookie, "x-forwarded-for": ip, ...headers } }
    : { method: "POST", headers: { "content-type": "application/json", "x-requested-with": "fetch", "x-forwarded-for": ip, cookie, ...headers }, body: JSON.stringify(payload) };
  const r = await fetch(base + path, init);
  const set = r.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  return { status: r.status, body: await r.json().catch(() => null) };
}

test("everything except login needs a session", async () => {
  for (const [p, b] of [["/api/me"], ["/api/data"], ["/api/shopify", { op: "scan" }], ["/api/save", { kind: "settings", patch: {} }]]) {
    const r = await call(p, b);
    assert.equal(r.status, 401, p);
  }
});

test("wrong password is refused, needs a name, and locks after 10 tries", async () => {
  assert.equal((await call("/api/login", { name: "", password: "x" })).status, 400);
  const r = await call("/api/login", { name: "Riya", password: "nope" }, { ip: "9.9.9.9" });
  assert.equal(r.status, 401);
  assert.equal(r.body.error.code, "wrong_password");
  for (let i = 0; i < 9; i++) await call("/api/login", { name: "Riya", password: "nope" }, { ip: "9.9.9.9" });
  const locked = await call("/api/login", { name: "Riya", password: process.env.TEAM_PASSWORD }, { ip: "9.9.9.9" });
  assert.equal(locked.status, 429, "11th attempt from same network is locked, even with the right password");
  assert.equal(cookie, "", "no session was issued");
});

test("requests from other sites are blocked", async () => {
  const r = await call("/api/login", { name: "A", password: process.env.TEAM_PASSWORD }, { headers: { "x-requested-with": "" } });
  assert.equal(r.status, 403);
});

test("correct password logs in and remembers the name", async () => {
  const r = await call("/api/login", { name: "  Riya   Sharma ", password: process.env.TEAM_PASSWORD });
  assert.equal(r.status, 200);
  assert.match(cookie, /^vct_session=/);
  const me = await call("/api/me");
  assert.equal(me.body.name, "Riya Sharma");
});

test("a forged cookie is rejected", async () => {
  const good = cookie;
  const [name, val] = good.split("=");
  const [payload, sig] = val.split(".");
  const forged = Buffer.from(JSON.stringify({ n: "Hacker", pv: "x", exp: 9999999999 })).toString("base64url");
  cookie = `${name}=${forged}.${sig}`;
  assert.equal((await call("/api/me")).status, 401);
  cookie = good;
});

test("Shopify scan keeps seeding orders only and lifetime vs dated scans work", async () => {
  const life = await call("/api/shopify", { op: "scan", since: null });
  assert.deepEqual(life.body.ids.sort(), ["gid://shopify/Order/10", "gid://shopify/Order/11", "gid://shopify/Order/13"], "the collab35 buyer (#1158) is filtered out");
  const recent = await call("/api/shopify", { op: "scan", since: "2026-08-09" });
  assert.deepEqual(recent.body.ids.sort(), ["gid://shopify/Order/10", "gid://shopify/Order/13"]);
  assert.ok(shopify.calls.includes("scan:2026-08-08T18:30:00Z"), "IST midnight converted to UTC");
  assert.equal((await call("/api/shopify", { op: "scan", since: "8 Aug" })).status, 400);
});

test("details and sales come back in the shape the screen expects", async () => {
  const d = await call("/api/shopify", { op: "details", ids: ["gid://shopify/Order/10"] });
  assert.equal(d.body.orders[0].name, "#6854");
  assert.equal((await call("/api/shopify", { op: "details", ids: ["1; drop table"] })).status, 400);
  const s = await call("/api/shopify", { op: "sales", since: "2024-01-01", until: "2026-10-07" });
  assert.deepEqual(s.body.rows, [{ code: "Danish20", orders: 3, net: 4000 }], "blank code row dropped, numbers parsed");
  assert.equal((await call("/api/shopify", { op: "graphql", query: "mutation{...}" })).status, 400, "no free-form Shopify access");
});

test("saving: roster create never overwrites, edits are validated and logged", async () => {
  const id = "inf_abc123";
  let r = await call("/api/save", { kind: "influencer", id, createOnly: true, patch: { name: "Danish", city: "Katra", orderIds: ["gid://shopify/Order/10"], firstSeeded: "2026-10-03T04:40:24Z" } });
  assert.equal(r.status, 200);
  r = await call("/api/save", { kind: "influencer", id, patch: { code: "Danish20", pct: 12.5 } });
  assert.equal(r.body.row.code, "Danish20");
  assert.equal(r.body.row.pct, 12.5);
  assert.equal(r.body.row.updatedBy, "Riya Sharma");
  // A second roster create (another teammate's screen) must not wipe the code.
  await call("/api/save", { kind: "influencer", id, createOnly: true, patch: { name: "Danish", city: "Katra", orderIds: [], firstSeeded: "2026-10-03T04:40:24Z" } });
  assert.equal(db.tables.influencers.find((x) => x.id === id).code, "Danish20");
  // Bad input is refused with a readable reason.
  for (const [patch, why] of [[{ pct: 150 }, /between 0 and 100/], [{ secret: 1 }, /can’t be saved/], [{ code: 5 }, /text/]]) {
    const bad = await call("/api/save", { kind: "influencer", id, patch });
    assert.equal(bad.status, 400); assert.match(bad.body.error.message, why);
  }
  assert.equal((await call("/api/save", { kind: "influencer", id: "../../etc", patch: { code: "x" } })).status, 400);
  // Shipments
  r = await call("/api/save", { kind: "shipment", id: "o_10", patch: { order: "#6854", influencer: id, content: "posted", postedOn: "2026-10-07", contentLink: "https://instagram.com/p/xyz" } });
  assert.equal(r.body.row.content, "posted");
  assert.equal((await call("/api/save", { kind: "shipment", id: "o_10", patch: { content: "maybe" } })).status, 400);
  assert.equal((await call("/api/save", { kind: "shipment", id: "o_10", patch: { contentLink: "javascript:alert(1)" } })).status, 400);
  // Log: human edits only (not roster creates).
  const logged = db.tables.edits.map((e) => `${e.who}|${e.kind}|${Object.keys(e.changes).join(",")}`);
  assert.deepEqual(logged, ["Riya Sharma|influencer|code,pct", "Riya Sharma|shipment|order,influencer,content,postedOn,contentLink"]);
});

test("data endpoint returns everything, then only what changed", async () => {
  const all = await call("/api/data");
  assert.equal(all.body.influencers.length, 1);
  assert.equal(all.body.shipments.length, 1);
  assert.equal(all.body.settings.r1Days, 3);
  await new Promise((ok) => setTimeout(ok, 5));
  const since = new Date().toISOString();
  await call("/api/save", { kind: "settings", patch: { r1Days: 4 } });
  await call("/api/save", { kind: "shipment", id: "o_13", patch: { order: "#6923", deliveredOn: "2026-10-06" } });
  const changed = await call("/api/data?since=" + encodeURIComponent(since));
  assert.deepEqual(changed.body.shipments.map((s) => s.id), ["o_13"]);
  assert.equal(changed.body.influencers.length, 0);
  assert.equal(changed.body.settings.r1Days, 4);
  assert.equal((await call("/api/save", { kind: "settings", patch: { r1Days: 999 } })).status, 400);
});

test("changing the team password logs everyone out", async () => {
  const old = process.env.TEAM_PASSWORD;
  process.env.TEAM_PASSWORD = "a brand new team password";
  assert.equal((await call("/api/me")).status, 401);
  process.env.TEAM_PASSWORD = old;
  assert.equal((await call("/api/me")).status, 200);
});

test("logout clears the session", async () => {
  await call("/api/logout", {});
  assert.equal(cookie, "vct_session=");
  assert.equal((await call("/api/me")).status, 401);
});
