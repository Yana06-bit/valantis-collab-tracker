// GET /api/me — who is logged in on this device (401 if nobody).
import { route, send } from "./_lib/http.js";
import { requireSession } from "./_lib/auth.js";

export default route(async (req, res) => {
  const s = requireSession(req);
  send(res, 200, { name: s.name, shop: process.env.SHOPIFY_SHOP_DOMAIN || "" });
});
