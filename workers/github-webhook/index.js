const encoder = new TextEncoder();

function equalConstantTime(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function validSignature(body, header, secret) {
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, body);
  const expected = "sha256=" + Array.from(new Uint8Array(digest), b =>
    b.toString(16).padStart(2, "0")).join("");
  return equalConstantTime(expected, header);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ service: "askme-github-webhook", status: "ok" });
    }
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.GITHUB_WEBHOOK_SECRET) {
      return Response.json({ error: "Webhook secret is not configured" }, { status: 503 });
    }
    const body = await request.arrayBuffer();
    const signature = request.headers.get("X-Hub-Signature-256");
    if (!(await validSignature(body, signature, env.GITHUB_WEBHOOK_SECRET))) {
      return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    const event = request.headers.get("X-GitHub-Event") || "unknown";
    const delivery = request.headers.get("X-GitHub-Delivery") || "unknown";
    // Acknowledge verified deliveries without logging or persisting payloads.
    // Event forwarding/automation will be added only after the Ask.Me backend
    // receiver is identified and can be tested independently.
    console.log(JSON.stringify({ service: "askme-github-webhook", event, delivery }));
    return Response.json({ accepted: true, event, delivery }, { status: 202 });
  }
};
