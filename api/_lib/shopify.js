// Shopify access, server-side only.
//
// The app is a private "Dev Dashboard" app installed on the Valantis store. Every 24 hours
// Shopify issues a fresh access token in exchange for the app's client ID + secret
// (the "client credentials grant"). We keep the token in memory and renew it before it expires.
//
// The browser never sends GraphQL. It can only ask for the fixed, read-only operations below,
// so a logged-in teammate can't use this server to read or change anything else in Shopify.
import { HttpError } from "./http.js";

const API_VERSION = process.env.SHOPIFY_API_VERSION || "2026-07";
let token = null, tokenExpiresAt = 0;

function shop() {
  const d = (process.env.SHOPIFY_SHOP_DOMAIN || "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9-]+\.myshopify\.com$/i.test(d)) throw new Error("SHOPIFY_SHOP_DOMAIN must look like your-store.myshopify.com");
  return d;
}

async function getToken() {
  if (token && Date.now() < tokenExpiresAt - 5 * 60 * 1000) return token;
  const r = await fetch(`https://${shop()}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.SHOPIFY_CLIENT_ID || "",
      client_secret: process.env.SHOPIFY_CLIENT_SECRET || "",
    }),
  });
  if (!r.ok) {
    console.error("[shopify] token request failed", r.status, await r.text().catch(() => ""));
    throw new HttpError(502, "shopify_auth", "The server couldn’t log in to Shopify. Check the Shopify app’s client ID, secret and that it is installed on the store.");
  }
  const j = await r.json();
  token = j.access_token;
  tokenExpiresAt = Date.now() + (Number(j.expires_in) || 3600) * 1000;
  return token;
}

async function gql(query, variables = {}, retry = true) {
  const r = await fetch(`https://${shop()}/admin/api/${API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await getToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (r.status === 401 && retry) { token = null; return gql(query, variables, false); }
  if (r.status === 429 && retry) { await new Promise((ok) => setTimeout(ok, 1500)); return gql(query, variables, false); }
  if (!r.ok) {
    console.error("[shopify] graphql http", r.status, await r.text().catch(() => ""));
    throw new HttpError(502, "shopify_http", `Shopify answered with an error (${r.status}). Try again in a minute.`);
  }
  const j = await r.json();
  if (j.errors?.length) {
    const msg = j.errors.map((e) => e.message).join("; ");
    console.error("[shopify] graphql errors", msg);
    if (/access denied|scope|protected customer data/i.test(msg)) throw new HttpError(502, "shopify_scope", "The Shopify app is missing a permission: " + msg);
    if (/throttled/i.test(msg) && retry) { await new Promise((ok) => setTimeout(ok, 2000)); return gql(query, variables, false); }
    throw new HttpError(502, "shopify_graphql", "Shopify returned an error: " + msg);
  }
  return j.data;
}

// ---- fixed operations ----

const COLLAB_TAGS = ["collab", "influencer-collab"];
const hasCollab = (n) => /\bcollab\b/i.test(n || "");
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const GID = /^gid:\/\/shopify\/Order\/\d{1,20}$/;
const IST_MS = 330 * 60000;
const istStartISO = (ymd) => new Date(new Date(ymd + "T00:00:00Z").getTime() - IST_MS).toISOString().replace(".000", "");

const SCAN = `query CollabScan($first: Int!, $after: String, $q: String) {
  orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    nodes { id tags customer { displayName } shippingAddress { name } }
  }
}`;

const DETAIL = `query CollabDetails($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id name createdAt cancelledAt tags displayFulfillmentStatus
      customer { displayName }
      shippingAddress { name phone address1 address2 city province zip }
      lineItems(first: 30) { nodes { title variantTitle quantity originalUnitPriceSet { shopMoney { amount } } } }
      fulfillments(first: 5) { status displayStatus deliveredAt inTransitAt trackingInfo(first: 3) { company number url } }
    }
  }
}`;

const SALES = `query CodeSales($q: String!) {
  shopifyqlQuery(query: $q) { tableData { columns { name } rows } parseErrors }
}`;

// One page of collab order IDs. since = IST day "YYYY-MM-DD", or null for lifetime.
export async function scan({ since, after }) {
  if (since != null && !DAY.test(since)) throw new HttpError(400, "bad_since", "Invalid start date.");
  if (after != null && (typeof after !== "string" || after.length > 500)) throw new HttpError(400, "bad_cursor", "Invalid page cursor.");
  const q = (since ? `created_at:>='${istStartISO(since)}' AND ` : "") + "(collab OR tag:collab OR tag:influencer-collab)";
  const data = await gql(SCAN, { first: 100, q, after: after || null });
  const conn = data.orders;
  // Shopify's search also matches paying orders that used codes like "collab35"; keep seeding orders only.
  const ids = conn.nodes
    .filter((o) => (o.tags || []).some((t) => COLLAB_TAGS.includes(t.toLowerCase())) || hasCollab(o.customer?.displayName) || hasCollab(o.shippingAddress?.name))
    .map((o) => o.id);
  return { ids, next: conn.pageInfo.hasNextPage ? conn.pageInfo.endCursor : null, scanned: conn.nodes.length };
}

export async function details({ ids }) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 25 || !ids.every((x) => typeof x === "string" && GID.test(x))) {
    throw new HttpError(400, "bad_ids", "Send 1–25 Shopify order IDs.");
  }
  const data = await gql(DETAIL, { ids });
  return { orders: (data.nodes || []).filter((o) => o && o.id) };
}

// Net sales and order count per discount code between two IST days.
export async function sales({ since, until }) {
  if (!DAY.test(since || "") || !DAY.test(until || "")) throw new HttpError(400, "bad_range", "Invalid date range.");
  const q = `FROM sales SHOW orders, net_sales GROUP BY discount_code SINCE ${since} UNTIL ${until} ORDER BY net_sales DESC LIMIT 1000`;
  const data = await gql(SALES, { q });
  const r = data.shopifyqlQuery;
  if (r?.parseErrors?.length) throw new HttpError(502, "shopifyql", "Sales report error: " + r.parseErrors.join("; "));
  const rows = (r?.tableData?.rows || []).map((row) => {
    // Rows come back as objects keyed by column name. Older API versions used arrays; handle both.
    const get = (k, i) => (Array.isArray(row) ? row[i] : row[k]);
    return { code: String(get("discount_code", 0) || "").trim(), orders: Number(get("orders", 1)) || 0, net: Number(get("net_sales", 2)) || 0 };
  }).filter((x) => x.code);
  return { rows };
}
