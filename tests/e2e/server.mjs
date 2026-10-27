// Local test stand-in for Supabase's REST (PostgREST) and Auth (GoTrue) APIs.
// Implements only the subset The Standard uses, against a real PostgreSQL with
// the real migration, executing every request as the JWT's role so RLS applies.
import http from "node:http";
import crypto from "node:crypto";
import pg from "pg";

const PORT = 54321;
const SECRET = "local-test-jwt-secret-at-least-32-characters-long";
const pool = new pg.Pool({ host: "127.0.0.1", port: 54322, user: "postgres", database: "standard", max: 10 });
pg.types.setTypeParser(1082, (v) => v); // date as string
pg.types.setTypeParser(1083, (v) => v); // time as string
pg.types.setTypeParser(20, (v) => Number(v));

const b64u = (b) => Buffer.from(b).toString("base64url");
export function sign(payload) {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify(payload));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
function verify(token) {
  const [h, p, s] = (token || "").split(".");
  if (!s) return null;
  const exp = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  if (exp !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  if (claims.exp && claims.exp < Date.now() / 1000) return null;
  return claims;
}
const now = () => Math.floor(Date.now() / 1000);
export const ANON = sign({ role: "anon", iss: "local", iat: now(), exp: now() + 10 * 365 * 86400 });
export const SERVICE = sign({ role: "service_role", iss: "local", iat: now(), exp: now() + 10 * 365 * 86400 });

/* ------------------------------ schema cache ------------------------------ */
let cols = null; // table -> col -> type
async function columns() {
  if (cols) return cols;
  const { rows } = await pool.query(`select c.relname t, a.attname c, format_type(a.atttypid, a.atttypmod) ty
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped`);
  cols = {};
  for (const r of rows) (cols[r.t] ??= {})[r.c] = r.ty;
  return cols;
}
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw httpErr(400, `bad identifier ${s}`);
  return `"${s}"`;
};
function httpErr(status, message, code = "PGRST000") {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  return e;
}

/* ------------------------------ filter parser ------------------------------ */
function splitList(inner) {
  const out = [];
  let cur = "", q = false;
  for (const ch of inner) {
    if (ch === '"') { q = !q; continue; }
    if (ch === "," && !q) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function buildFilter(table, col, raw, params, types) {
  const ty = types[col];
  if (!ty) throw httpErr(400, `column ${table}.${col} does not exist`, "42703");
  const c = ident(col);
  let neg = false;
  let v = raw;
  if (v.startsWith("not.")) { neg = true; v = v.slice(4); }
  const dot = v.indexOf(".");
  let op = v.slice(0, dot);
  const val = v.slice(dot + 1);
  const p = (x, t = ty) => { params.push(x); return `$${params.length}::${t}`; };
  let sql;
  const fts = op.match(/^(pl|ph|w)?fts(?:\((\w+)\))?$/);
  if (fts) {
    const fn = { pl: "plainto_tsquery", ph: "phraseto_tsquery", w: "websearch_to_tsquery", undefined: "to_tsquery" }[fts[1]];
    sql = fts[2] ? `${c} @@ ${fn}(${p(fts[2], "regconfig")}, ${p(val, "text")})` : `${c} @@ ${fn}(${p(val, "text")})`;
  } else switch (op) {
    case "eq": sql = `${c} = ${p(val)}`; break;
    case "neq": sql = `${c} <> ${p(val)}`; break;
    case "gt": sql = `${c} > ${p(val)}`; break;
    case "gte": sql = `${c} >= ${p(val)}`; break;
    case "lt": sql = `${c} < ${p(val)}`; break;
    case "lte": sql = `${c} <= ${p(val)}`; break;
    case "is": sql = `${c} is ${({ null: "null", true: "true", false: "false" })[val] ?? (() => { throw httpErr(400, "bad is") })()}`; break;
    case "in": sql = `${c} = any(${p(splitList(val.replace(/^\(|\)$/g, "")), ty.endsWith("[]") ? ty : ty + "[]")})`; break;
    case "cs": sql = `${c} @> ${p(val)}`; break;
    case "cd": sql = `${c} <@ ${p(val)}`; break;
    case "like": sql = `${c} like ${p(val.replace(/\*/g, "%"), "text")}`; break;
    case "ilike": sql = `${c} ilike ${p(val.replace(/\*/g, "%"), "text")}`; break;
    default: throw httpErr(400, `unsupported operator ${op}`);
  }
  return neg ? `not (${sql})` : sql;
}

const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

function where(table, url, params, types) {
  const parts = [];
  for (const [k, v] of url.searchParams) if (!RESERVED.has(k)) parts.push(buildFilter(table, k, v, params, types));
  return parts.length ? ` where ${parts.join(" and ")}` : "";
}
function selectList(sel, types) {
  if (!sel || sel === "*") return "*";
  return sel.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    if (s === "*") return "*";
    if (!types[s]) throw httpErr(400, `column ${s} does not exist`, "42703");
    return ident(s);
  }).join(", ");
}
function orderBy(url, types) {
  const o = url.searchParams.get("order");
  if (!o) return "";
  return " order by " + o.split(",").map((term) => {
    const [col, ...mods] = term.split(".");
    if (!types[col]) throw httpErr(400, `order column ${col}`);
    let s = ident(col);
    if (mods.includes("desc")) s += " desc"; else s += " asc";
    if (mods.includes("nullsfirst")) s += " nulls first";
    if (mods.includes("nullslast")) s += " nulls last";
    return s;
  }).join(", ");
}

/* ------------------------------ request runner ------------------------------ */
async function asRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${claims.role === "service_role" ? "service_role" : claims.role === "authenticated" ? "authenticated" : "anon"}`);
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    const r = await fn(client);
    await client.query("commit");
    return r;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

function pgError(e) {
  if (e.status) return { status: e.status, body: { code: e.code, message: e.message, details: null, hint: null } };
  const status = e.code === "42501" ? 403 : e.code === "23505" ? 409 : e.code === "P0001" ? 400 : e.code?.startsWith("22") || e.code?.startsWith("23") ? 400 : 400;
  return { status, body: { code: e.code, message: e.message, details: e.detail ?? null, hint: e.hint ?? null } };
}

async function rest(req, url, claims, body) {
  const path = url.pathname.replace(/^\/rest\/v1\//, "");
  const prefer = req.headers["prefer"] || "";
  const accept = req.headers["accept"] || "";
  const single = accept.includes("vnd.pgrst.object+json");

  if (path.startsWith("rpc/")) {
    const fn = ident(path.slice(4));
    const args = body ? Object.entries(body) : [];
    const sql = `select * from public.${fn}(${args.map(([k], i) => `${ident(k)} => $${i + 1}`).join(", ")})`;
    const rows = await asRole(claims, (c) => c.query(sql, args.map(([, v]) => v))).then((r) => r.rows);
    // Scalar functions return a single column named after the function.
    if (rows.length === 1 && Object.keys(rows[0]).length === 1 && Object.keys(rows[0])[0] === path.slice(4)) return { status: 200, body: rows[0][path.slice(4)] };
    if (prefer.includes("return=minimal")) return { status: 204 };
    return { status: 200, body: rows };
  }

  const table = path;
  const types = (await columns())[table];
  if (!types) throw httpErr(404, `relation ${table} does not exist`, "42P01");
  const params = [];
  const t = `public.${ident(table)}`;
  const wantRep = prefer.includes("return=representation");
  const wantCount = /count=exact/.test(prefer);

  if (req.method === "GET" || req.method === "HEAD") {
    const w = where(table, url, params, types);
    const lim = url.searchParams.get("limit"), off = url.searchParams.get("offset");
    const sql = `select ${selectList(url.searchParams.get("select"), types)} from ${t}${w}${orderBy(url, types)}${lim ? ` limit ${Number(lim)}` : ""}${off ? ` offset ${Number(off)}` : ""}`;
    return asRole(claims, async (c) => {
      const rows = (await c.query(sql, params)).rows;
      let total = "*";
      if (wantCount) total = (await c.query(`select count(*)::int n from ${t}${w}`, params)).rows[0].n;
      const headers = { "content-range": `0-${Math.max(0, rows.length - 1)}/${total}` };
      if (req.method === "HEAD") return { status: 200, headers };
      if (single) {
        if (rows.length !== 1) return { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned", details: `The result contains ${rows.length} rows`, hint: null } };
        return { status: 200, body: rows[0], headers };
      }
      return { status: 200, body: rows, headers };
    });
  }

  if (req.method === "POST") {
    const rows = Array.isArray(body) ? body : [body];
    const colsParam = url.searchParams.get("columns");
    const keys = colsParam ? colsParam.split(",").map((s) => s.replace(/"/g, "")) : [...new Set(rows.flatMap((r) => Object.keys(r)))];
    for (const k of keys) if (!types[k]) throw httpErr(400, `column ${k} does not exist`, "PGRST204");
    const values = rows.map((r) => "(" + keys.map((k) => {
      if (!(k in r)) return "default";
      const v = r[k];
      params.push(v === null ? null : /json/.test(types[k]) ? JSON.stringify(v) : Array.isArray(v) ? v : typeof v === "object" ? JSON.stringify(v) : v);
      return `$${params.length}::${types[k]}`;
    }).join(", ") + ")").join(", ");
    let sql = `insert into ${t} (${keys.map(ident).join(", ")}) values ${values}`;
    const resolution = prefer.match(/resolution=(ignore|merge)-duplicates/)?.[1];
    if (resolution) {
      const target = (url.searchParams.get("on_conflict") || "id").split(",").map((s) => ident(s.trim())).join(", ");
      const setCols = keys.filter((k) => !target.includes(`"${k}"`));
      sql += resolution === "ignore" || !setCols.length ? ` on conflict (${target}) do nothing` : ` on conflict (${target}) do update set ${setCols.map((k) => `${ident(k)} = excluded.${ident(k)}`).join(", ")}`;
    }
    sql += " returning *";
    return asRole(claims, async (c) => {
      const out = (await c.query(sql, params)).rows;
      if (!wantRep) return { status: 201 };
      if (single) return out.length === 1 ? { status: 201, body: out[0] } : { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { status: 201, body: out };
    });
  }

  if (req.method === "PATCH") {
    const keys = Object.keys(body || {});
    for (const k of keys) if (!types[k]) throw httpErr(400, `column ${k} does not exist`, "PGRST204");
    const sets = keys.map((k) => {
      const v = body[k];
      params.push(v === null ? null : /json/.test(types[k]) ? JSON.stringify(v) : Array.isArray(v) ? v : typeof v === "object" ? JSON.stringify(v) : v);
      return `${ident(k)} = $${params.length}::${types[k]}`;
    });
    const w = where(table, url, params, types);
    const sql = `update ${t} set ${sets.join(", ")}${w} returning *`;
    return asRole(claims, async (c) => {
      const out = (await c.query(sql, params)).rows;
      if (!wantRep) return { status: 204 };
      if (single) return out.length === 1 ? { status: 200, body: out[0] } : { status: 406, body: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
      return { status: 200, body: out };
    });
  }

  if (req.method === "DELETE") {
    const w = where(table, url, params, types);
    return asRole(claims, async (c) => {
      const out = (await c.query(`delete from ${t}${w} returning *`, params)).rows;
      return wantRep ? { status: 200, body: out } : { status: 204 };
    });
  }
  throw httpErr(405, "method not allowed");
}

/* ---------------------------------- auth ---------------------------------- */
function hash(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(pw, salt, 32).toString("hex")}`;
}
function check(pw, stored) {
  const [salt, h] = (stored || ":").split(":");
  return !!salt && crypto.timingSafeEqual(Buffer.from(h, "hex"), crypto.scryptSync(pw, salt, 32));
}
function userJson(u) {
  return {
    id: u.id, aud: "authenticated", role: "authenticated", email: u.email, email_confirmed_at: u.email_confirmed_at,
    confirmed_at: u.email_confirmed_at, last_sign_in_at: u.last_sign_in_at, app_metadata: u.raw_app_meta_data,
    user_metadata: u.raw_user_meta_data, identities: [], created_at: u.created_at, updated_at: u.updated_at, is_anonymous: false,
  };
}
async function session(u) {
  const iat = now(), exp = iat + 3600;
  const access_token = sign({
    sub: u.id, aud: "authenticated", role: "authenticated", email: u.email, iat, exp, iss: `http://127.0.0.1:${PORT}/auth/v1`,
    session_id: crypto.randomUUID(), aal: "aal1", amr: [{ method: "password", timestamp: iat }], is_anonymous: false,
    app_metadata: u.raw_app_meta_data, user_metadata: u.raw_user_meta_data,
  });
  const refresh_token = crypto.randomBytes(24).toString("hex");
  await pool.query("insert into auth.refresh_tokens(token,user_id) values($1,$2)", [refresh_token, u.id]);
  await pool.query("update auth.users set last_sign_in_at=now() where id=$1", [u.id]);
  return { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token, user: userJson(u) };
}
const authErr = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg, error: code, error_description: msg } });

async function auth(req, url, claims, body) {
  const p = url.pathname.replace(/^\/auth\/v1/, "");
  if (p === "/signup" && req.method === "POST") {
    const { email, password } = body;
    if (!email || !password || password.length < 6) return authErr(422, "weak_password", "Password should be at least 6 characters.");
    const ex = await pool.query("select 1 from auth.users where email=$1", [email.toLowerCase()]);
    if (ex.rowCount) return authErr(422, "user_already_exists", "User already registered");
    const u = (await pool.query("insert into auth.users(email,encrypted_password) values($1,$2) returning *", [email.toLowerCase(), hash(password)])).rows[0];
    return { status: 200, body: await session(u) }; // autoconfirm
  }
  if (p === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    if (grant === "password") {
      const u = (await pool.query("select * from auth.users where email=$1", [String(body.email).toLowerCase()])).rows[0];
      if (!u || !check(body.password, u.encrypted_password)) return authErr(400, "invalid_credentials", "Invalid login credentials");
      return { status: 200, body: await session(u) };
    }
    if (grant === "refresh_token") {
      const r = (await pool.query("update auth.refresh_tokens set revoked=true where token=$1 and not revoked returning user_id", [body.refresh_token])).rows[0];
      if (!r) return authErr(400, "refresh_token_not_found", "Invalid Refresh Token");
      const u = (await pool.query("select * from auth.users where id=$1", [r.user_id])).rows[0];
      return { status: 200, body: await session(u) };
    }
  }
  if (p === "/user") {
    if (!claims?.sub) return authErr(401, "no_authorization", "This endpoint requires a valid Bearer token");
    if (req.method === "PUT") {
      if (body.password) await pool.query("update auth.users set encrypted_password=$2, updated_at=now() where id=$1", [claims.sub, hash(body.password)]);
    }
    const u = (await pool.query("select * from auth.users where id=$1", [claims.sub])).rows[0];
    if (!u) return authErr(403, "user_not_found", "User from sub claim in JWT does not exist");
    return { status: 200, body: userJson(u) };
  }
  if (p === "/logout") {
    if (claims?.sub) await pool.query("update auth.refresh_tokens set revoked=true where user_id=$1", [claims.sub]);
    return { status: 204 };
  }
  const m = p.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
  if (m && req.method === "DELETE") {
    if (claims?.role !== "service_role") return authErr(403, "not_admin", "User not allowed");
    await pool.query("delete from auth.users where id=$1", [m[1]]);
    return { status: 200, body: {} };
  }
  if (p === "/otp" || p === "/recover") return { status: 200, body: {} }; // email sending not emulated
  return authErr(404, "not_found", `not implemented: ${req.method} ${p}`);
}

/* --------------------------------- server --------------------------------- */
export const log = [];
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  const token = (req.headers.authorization || "").replace(/^Bearer /, "") || req.headers.apikey;
  const claims = verify(token);
  let out;
  try {
    if (!claims) out = { status: 401, body: { code: "PGRST301", message: "JWT invalid" } };
    else if (url.pathname.startsWith("/rest/v1/")) out = await rest(req, url, claims, body);
    else if (url.pathname.startsWith("/auth/v1/")) out = await auth(req, url, claims, body);
    else out = { status: 404, body: { message: "not found" } };
  } catch (e) {
    out = pgError(e);
  }
  if (process.env.LOG || out.status >= 400) console.log(`${req.method} ${url.pathname}${url.search} -> ${out.status}${out.status >= 400 ? " " + JSON.stringify(out.body) : ""}`);
  res.writeHead(out.status, { "content-type": "application/json", ...(out.headers || {}) });
  res.end(out.body === undefined ? "" : JSON.stringify(out.body));
}).listen(PORT, () => {
  console.log(`stack on ${PORT}`);
  console.log(`ANON=${ANON}`);
  console.log(`SERVICE=${SERVICE}`);
});
