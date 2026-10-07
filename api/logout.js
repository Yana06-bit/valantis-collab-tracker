// POST /api/logout — clears the login cookie on this device.
import { route, send, requirePost } from "./_lib/http.js";
import { clearSessionCookie } from "./_lib/auth.js";

export default route(async (req, res) => {
  requirePost(req);
  res.setHeader("Set-Cookie", clearSessionCookie());
  send(res, 200, { ok: true });
});
