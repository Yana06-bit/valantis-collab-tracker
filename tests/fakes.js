// Test doubles: an in-memory stand-in for Supabase and a fake Shopify.
// Only the query shapes this app uses are implemented.

export function fakeDb() {
  const tables = { influencers: [], shipments: [], settings: [], edits: [], login_failures: [] };
  let seq = 1, last = 0;
  const now = () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString(); }; // strictly increasing, never ahead of the real clock

  function builder(table) {
    const st = { table, filters: [], op: "select", returning: false, single: false, head: false, row: null, opts: {} };
    const rows = () => tables[table].filter((r) => st.filters.every(([op, c, v]) =>
      op === "eq" ? r[c] === v : op === "gt" ? String(r[c]) > String(v) : op === "gte" ? String(r[c]) >= String(v) : true));
    const exec = () => {
      if (st.op === "insert") {
        const r = { id: seq++, at: now(), ...st.row }; tables[table].push(r);
        return { data: st.returning ? [r] : null, error: null };
      }
      if (st.op === "upsert") {
        const key = st.opts.onConflict || "id", i = tables[table].findIndex((r) => r[key] === st.row[key]);
        let out;
        if (i >= 0) {
          if (st.opts.ignoreDuplicates) return { data: [], error: null };
          tables[table][i] = { ...tables[table][i], ...st.row }; out = tables[table][i];
        } else {
          const defaults = table === "influencers" ? { name: "", city: "", order_ids: [], code: "", pct: null }
            : table === "shipments" ? { content: "pending", content_link: "", order_name: "", influencer_id: "" } : {};
          out = { ...defaults, updated_at: now(), ...st.row }; tables[table].push(out);
        }
        return { data: st.returning ? [out] : null, error: null };
      }
      const rs = rows();
      if (st.head) return { data: null, count: rs.length, error: null };
      if (st.single) return { data: rs[0] || null, error: null };
      return { data: rs.map((r) => ({ ...r })), error: null };
    };
    const b = {
      select(_c, o = {}) { if (st.op === "select") { st.head = !!o.head; } else st.returning = true; return b; },
      eq(c, v) { st.filters.push(["eq", c, v]); return b; },
      gt(c, v) { st.filters.push(["gt", c, v]); return b; },
      gte(c, v) { st.filters.push(["gte", c, v]); return b; },
      maybeSingle() { st.single = true; return b; },
      insert(r) { st.op = "insert"; st.row = r; return b; },
      upsert(r, o = {}) { st.op = "upsert"; st.row = { ...r, updated_at: r.updated_at ? now() : r.updated_at }; st.opts = o; return b; },
      then(ok, bad) { try { ok(exec()); } catch (e) { bad ? bad(e) : null; } },
    };
    return b;
  }
  return { from: builder, tables };
}

// Minimal Shopify Admin API: token endpoint + the three GraphQL operations.
export function fakeShopify(orders, salesRows) {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.includes(".myshopify.com/")) return realFetch(url, init);
    const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (u.endsWith("/admin/oauth/access_token")) {
      const p = new URLSearchParams(init.body);
      calls.push("token");
      if (p.get("client_secret") !== "test-secret") return json({ error: "invalid_client" }, 401);
      return json({ access_token: "shpat_test", expires_in: 86399, scope: "read_orders" });
    }
    if (init.headers?.["X-Shopify-Access-Token"] !== "shpat_test") return json({ errors: "Invalid API key" }, 401);
    const { query, variables } = JSON.parse(init.body);
    if (/CollabScan/.test(query)) {
      calls.push("scan:" + (variables.q.match(/created_at:>='([^']+)'/)?.[1] || "lifetime"));
      const since = variables.q.match(/created_at:>='([^']+)'/)?.[1];
      // Shopify's search returns anything mentioning "collab", including code users; the server must filter.
      const nodes = orders.filter((o) => !since || o.createdAt >= since).map((o) => ({ id: o.id, tags: o.tags, customer: o.customer, shippingAddress: { name: o.shippingAddress.name } }));
      return json({ data: { orders: { pageInfo: { hasNextPage: false, endCursor: null }, nodes } } });
    }
    if (/CollabDetails/.test(query)) { calls.push("details:" + variables.ids.length); return json({ data: { nodes: orders.filter((o) => variables.ids.includes(o.id)) } }); }
    if (/shopifyqlQuery/.test(query)) {
      calls.push("sales:" + variables.q.match(/SINCE (\S+)/)[1]);
      return json({ data: { shopifyqlQuery: { tableData: { columns: [{ name: "discount_code" }, { name: "orders" }, { name: "net_sales" }], rows: salesRows(variables.q) }, parseErrors: [] } } });
    }
    return json({ errors: [{ message: "unknown query" }] });
  };
  return { calls, restore: () => { globalThis.fetch = realFetch; } };
}

const li = (t, v, p) => ({ title: t, variantTitle: v, quantity: 1, originalUnitPriceSet: { shopMoney: { amount: String(p) } } });
export const SAMPLE_ORDERS = [
  { id: "gid://shopify/Order/10", name: "#6854", createdAt: "2026-10-03T04:40:24Z", cancelledAt: null, tags: ["collab"], displayFulfillmentStatus: "FULFILLED",
    customer: { displayName: "danish collab" }, shippingAddress: { name: "danish collab", phone: "+919622952059", address1: "SMVDU", address2: "", city: "Katra", province: "J&K", zip: "182320" },
    lineItems: { nodes: [li("BLACK SAINT", "M", 874.5), li("RETRO CUT", "M", 1199)] },
    fulfillments: [{ status: "SUCCESS", displayStatus: "DELIVERED", deliveredAt: "2026-10-03T12:44:51Z", inTransitAt: null, trackingInfo: [{ company: "Xpressbees", number: "141", url: "https://valantis.shiprocket.co/tracking/141" }] }] },
  { id: "gid://shopify/Order/11", name: "#3814", createdAt: "2026-04-22T18:47:14Z", cancelledAt: null, tags: [], displayFulfillmentStatus: "FULFILLED",
    customer: { displayName: "danish collab" }, shippingAddress: { name: "danish collab", phone: "+919622952059", city: "Katra" },
    lineItems: { nodes: [li("SUPERMAN ORIGIN", "M", 1299)] }, fulfillments: [{ status: "SUCCESS", displayStatus: "CONFIRMED", trackingInfo: [] }] },
  { id: "gid://shopify/Order/12", name: "#1158", createdAt: "2026-01-12T10:15:43Z", cancelledAt: null, tags: [], displayFulfillmentStatus: "FULFILLED",
    customer: { displayName: "nakul jatwani" }, shippingAddress: { name: "nakul jatwani", phone: "+911111111111", city: "X" }, lineItems: { nodes: [li("A", "M", 1)] }, fulfillments: [] },
  { id: "gid://shopify/Order/13", name: "#6923", createdAt: "2026-10-05T17:23:14Z", cancelledAt: null, tags: ["collab"], displayFulfillmentStatus: "UNFULFILLED",
    customer: { displayName: "Anirudh Collab" }, shippingAddress: { name: "Anirudh Collab", phone: "+919911526464", city: "Gurugram" },
    lineItems: { nodes: [li("SUPERMAN APEX", "M", 1599)] }, fulfillments: [] },
];
export const SAMPLE_SALES = (q) => (/2024-01-01/.test(q)
  ? [{ discount_code: "Danish20", orders: "3", net_sales: "4000" }, { discount_code: "", orders: "100", net_sales: "-5" }]
  : [{ discount_code: "Danish20", orders: "1", net_sales: "1359.2" }]);

export function testEnv() {
  Object.assign(process.env, {
    TEAM_PASSWORD: "correct horse battery staple",
    SESSION_SECRET: "x".repeat(64),
    SHOPIFY_SHOP_DOMAIN: "valantis-test.myshopify.com",
    SHOPIFY_CLIENT_ID: "test-id",
    SHOPIFY_CLIENT_SECRET: "test-secret",
  });
}
