const encoder = new TextEncoder();
let cachedInstallationToken = null;
let cachedInstallationTokenExpiresAt = 0;

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function pemToBytes(pem) {
  const encoded = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function encodeBase64(text) {
  const bytes = encoder.encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
async function appJwt(env) {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) throw new Error("GitHub App credentials are not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(encoder.encode(JSON.stringify({ iat: now - 30, exp: now + 480, iss: env.GITHUB_APP_ID })));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey("pkcs8", pemToBytes(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  return unsigned + "." + base64Url(new Uint8Array(signature));
}
async function installationToken(env) {
  if (cachedInstallationToken && Date.now() < cachedInstallationTokenExpiresAt - 60000) return cachedInstallationToken;
  if (!env.GITHUB_APP_INSTALLATION_ID) throw new Error("GitHub App installation ID is not configured.");
  const jwt = await appJwt(env);
  const response = await fetch("https://api.github.com/app/installations/" + encodeURIComponent(env.GITHUB_APP_INSTALLATION_ID) + "/access_tokens", {
    method: "POST",
    headers: { Authorization: "Bearer " + jwt, Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AskMe-GitHub-Agent" }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.token) throw new Error("GitHub App token request failed (HTTP " + response.status + ").");
  cachedInstallationToken = data.token;
  cachedInstallationTokenExpiresAt = Date.parse(data.expires_at || "") || Date.now() + 3000000;
  return cachedInstallationToken;
}
async function githubRequest(env, path, options = {}) {
  const token = await installationToken(env);
  const response = await fetch("https://api.github.com" + path, {
    ...options,
    headers: { Accept: "application/vnd.github+json", Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AskMe-GitHub-Agent",
      ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error("GitHub API " + response.status + ": " + (data.message || "request failed"));
    error.status = response.status;
    throw error;
  }
  return data;
}
function assertAllowedRepository(owner, repo, env) {
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner || "") || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo || "")) {
    throw new Error("A valid GitHub owner and repository are required.");
  }
  const fullName = owner + "/" + repo;
  const allowed = (env.ALLOWED_REPOSITORIES || "blvckson/Ask.Me").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (!allowed.includes(fullName.toLowerCase())) throw new Error("Repository is not in the Ask.Me Worker allowlist.");
  return fullName;
}
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers }); }
function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return {};
  if (!env.ASKME_ALLOWED_ORIGIN || origin !== env.ASKME_ALLOWED_ORIGIN) return null;
  return { "Access-Control-Allow-Origin": env.ASKME_ALLOWED_ORIGIN, "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type" };
}
async function validWebhookSignature(body, header, secret) {
  if (!header || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, body);
  const expected = "sha256=" + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  return constantTimeEqual(expected, header);
}
function decodeGitHubContent(content) {
  const binary = atob(String(content || "").replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 1000000) throw new Error("Request body exceeds the 1 MB limit.");
  try { return JSON.parse(raw); } catch { throw new Error("Request body must be valid JSON."); }
}
async function handleGitHubApi(request, env, url) {
  if (!env.ASKME_AGENT_API_KEY) return json({ error: "Ask.Me agent API key is not configured." }, 503);
  if (!constantTimeEqual(request.headers.get("Authorization") || "", "Bearer " + env.ASKME_AGENT_API_KEY)) {
    return json({ error: "Unauthorized." }, 401);
  }
  const owner = url.searchParams.get("owner"), repo = url.searchParams.get("repo");
  const fullName = assertAllowedRepository(owner, repo, env);
  const apiRepo = "/repos/" + encodeURIComponent(owner) + "/" + encodeURIComponent(repo);
  if (request.method === "GET" && url.pathname === "/api/github/repo") {
    const data = await githubRequest(env, apiRepo);
    return json({ full_name: data.full_name, default_branch: data.default_branch,
      private: data.private, html_url: data.html_url });
  }
  if (request.method === "GET" && url.pathname === "/api/github/tree") {
    const ref = url.searchParams.get("ref") || "main";
    const prefix = url.searchParams.get("path") || "";
    const branchRef = await githubRequest(env, apiRepo + "/git/ref/heads/" +
      ref.split("/").map(encodeURIComponent).join("/"));
    const tree = await githubRequest(env, apiRepo + "/git/trees/" + branchRef.object.sha + "?recursive=1");
    const cleanPrefix = prefix.split("/").filter(Boolean).join("/");
    const entries = (tree.tree || []).filter(item => item.type === "blob" &&
      (!cleanPrefix || item.path.startsWith(cleanPrefix + "/") || item.path === cleanPrefix))
      .slice(0, 500).map(item => ({ path: item.path, sha: item.sha, size: item.size }));
    return json({ repository: fullName, ref, truncated: Boolean(tree.truncated), files: entries });
  }
  if (request.method === "GET" && url.pathname === "/api/github/file") {
    const path = url.searchParams.get("path");
    if (!path || path.startsWith("/") || path.split("/").includes("..")) return json({ error: "Safe relative file path required." }, 400);
    const ref = url.searchParams.get("ref");
    const file = await githubRequest(env, apiRepo + "/contents/" + path.split("/").map(encodeURIComponent).join("/") +
      (ref ? "?ref=" + encodeURIComponent(ref) : ""));
    if (Array.isArray(file) || file.type !== "file") return json({ error: "Path is not a file." }, 400);
    return json({ repository: fullName, path: file.path, sha: file.sha, content: decodeGitHubContent(file.content), html_url: file.html_url });
  }
  if (request.method === "POST" && url.pathname === "/api/github/branch") {
    const body = await readJson(request), branch = String(body.branch || ""), base = String(body.base || "");
    if (!/^askme\/[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes("..") || !base || base.startsWith("-")) {
      return json({ error: "Branch must begin askme/ and include a valid base ref." }, 400);
    }
    const baseRef = await githubRequest(env, apiRepo + "/git/ref/heads/" + base.split("/").map(encodeURIComponent).join("/"));
    const created = await githubRequest(env, apiRepo + "/git/refs", {
      method: "POST", body: JSON.stringify({ ref: "refs/heads/" + branch, sha: baseRef.object.sha })
    });
    return json({ repository: fullName, branch, base, sha: created.object.sha }, 201);
  }
  if (request.method === "PUT" && url.pathname === "/api/github/file") {
    const body = await readJson(request), path = String(body.path || ""), branch = String(body.branch || "");
    if (!path || path.startsWith("/") || path.split("/").includes("..") ||
        !/^askme\/[A-Za-z0-9._/-]{1,100}$/.test(branch) || branch.includes("..") ||
        typeof body.content !== "string" || body.content.length > 900000) {
      return json({ error: "Safe path, askme/ branch, and text content under 900 KB required." }, 400);
    }
    const filePath = path.split("/").map(encodeURIComponent).join("/");
    const current = await githubRequest(env, apiRepo + "/contents/" + filePath + "?ref=" + encodeURIComponent(branch))
      .catch(error => { if (error.status === 404) return null; throw error; });
    if (current && (Array.isArray(current) || current.type !== "file")) return json({ error: "Path is not a file." }, 400);
    const payload = { message: String(body.message || "Ask.Me: update " + path),
      content: encodeBase64(body.content), branch };
    if (current) payload.sha = current.sha;
    const updated = await githubRequest(env, apiRepo + "/contents/" + filePath, {
      method: "PUT", body: JSON.stringify(payload)
    });
    return json({ repository: fullName, path, branch, commit_sha: updated.commit.sha, content_sha: updated.content.sha });
  }
  if (request.method === "POST" && url.pathname === "/api/github/pull-request") {
    const body = await readJson(request), head = String(body.head || ""), base = String(body.base || ""), title = String(body.title || "");
    if (!/^askme\/[A-Za-z0-9._/-]{1,100}$/.test(head) || head.includes("..") || !base || !title) {
      return json({ error: "A title, base branch, and askme/ head branch are required." }, 400);
    }
    const pr = await githubRequest(env, apiRepo + "/pulls", {
      method: "POST", body: JSON.stringify({ title, body: String(body.body || "Proposed by Ask.Me GitHub coding agent."),
        head, base, draft: body.draft !== false })
    });
    return json({ number: pr.number, html_url: pr.html_url, state: pr.state, draft: pr.draft }, 201);
  }
  return json({ error: "Unknown GitHub agent endpoint." }, 404);
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url), cors = corsHeaders(request, env);
    if (cors === null) return json({ error: "Origin is not allowed." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors || {} });
    if (request.method === "GET" && url.pathname === "/health") return json({ service: "askme-github-agent", status: "ok" }, 200, cors || {});
    if (request.method === "POST" && url.pathname === "/webhook") {
      if (!env.GITHUB_WEBHOOK_SECRET) return json({ error: "Webhook secret is not configured." }, 503, cors || {});
      const body = await request.arrayBuffer();
      if (!(await validWebhookSignature(body, request.headers.get("X-Hub-Signature-256"), env.GITHUB_WEBHOOK_SECRET))) {
        return json({ error: "Invalid webhook signature." }, 401, cors || {});
      }
      const event = request.headers.get("X-GitHub-Event") || "unknown";
      const delivery = request.headers.get("X-GitHub-Delivery") || "unknown";
      console.log(JSON.stringify({ service: "askme-github-agent", event, delivery }));
      return json({ accepted: true, event, delivery }, 202, cors || {});
    }
    if (url.pathname.startsWith("/api/github/")) {
      try {
        const result = await handleGitHubApi(request, env, url);
        const headers = new Headers(result.headers);
        for (const [key, value] of Object.entries(cors || {})) headers.set(key, value);
        return new Response(result.body, { status: result.status, headers });
      } catch (error) {
        console.error("Ask.Me GitHub agent error:", error?.message || error);
        return json({ error: error?.message || "GitHub agent request failed." }, 400, cors || {});
      }
    }
    return new Response("Not found", { status: 404, headers: cors || {} });
  }
};
