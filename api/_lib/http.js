// Small helpers shared by every API route.
// Files in api/_lib start with "_" so Vercel does not expose them as endpoints.

export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

// Vercel parses JSON bodies for us; tolerate a raw string just in case.
export function body(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body) {
    try { return JSON.parse(req.body); } catch { throw new HttpError(400, "bad_json", "Request body is not valid JSON."); }
  }
  return {};
}

// Every state-changing request must come from our own page:
// - SameSite=Lax cookies already stop other sites from POSTing with our cookie,
// - and this custom header can't be set by a plain cross-site form.
export function requirePost(req) {
  if (req.method !== "POST") throw new HttpError(405, "method", "Use POST.");
  if (req.headers["x-requested-with"] !== "fetch") throw new HttpError(403, "csrf", "Request blocked.");
}

export function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "");
  return (fwd.split(",")[0] || req.socket?.remoteAddress || "unknown").trim();
}

// Wrap a route so thrown HttpErrors become clean JSON and anything else is logged, not leaked.
export function route(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: { code: e.code, message: e.message } });
      console.error("[api error]", req.url, e);
      return send(res, 500, { error: { code: "server", message: "Something went wrong on the server. Try again." } });
    }
  };
}
