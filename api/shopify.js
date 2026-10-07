// POST /api/shopify  { op: "scan" | "details" | "sales", ...params }
// Read-only Shopify data for logged-in teammates. See _lib/shopify.js for what each op returns.
import { route, send, body, requirePost, HttpError } from "./_lib/http.js";
import { requireSession } from "./_lib/auth.js";
import { scan, details, sales } from "./_lib/shopify.js";

const OPS = { scan, details, sales };

export default route(async (req, res) => {
  requirePost(req);
  requireSession(req);
  const { op, ...params } = body(req);
  const fn = OPS[op];
  if (!fn) throw new HttpError(400, "bad_op", "Unknown request.");
  send(res, 200, await fn(params));
});
