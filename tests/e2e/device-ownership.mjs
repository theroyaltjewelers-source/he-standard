// Device ownership: a browser with notification permission whose subscription
// belongs to another account is re-assigned when the current user opens the app;
// signing out detaches it.
import chromium from "@sparticuz/chromium"; import puppeteer from "puppeteer-core"; import pg from "pg";
const APP = "http://localhost:3000";
const db = new pg.Pool({ host: "127.0.0.1", port: 54322, user: "postgres", database: "standard" });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const ctx = b.defaultBrowserContext(); await ctx.overridePermissions(APP, ["notifications"]);
const p = await b.newPage(); await p.emulateTimezone("America/New_York");
const ENDPOINT = `https://push.example.test/device-${Date.now()}`;
// Fake PushManager subscription for this "device"
await p.evaluateOnNewDocument((ep) => {
  const sub = { endpoint: ep, toJSON: () => ({ endpoint: ep, keys: { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" } }), unsubscribe: async () => true };
  const pm = { getSubscription: async () => sub, subscribe: async () => sub };
  Object.defineProperty(window, "PushManager", { value: function () {} });
  try { Object.defineProperty(Notification, "permission", { get: () => "granted" }); } catch {}
  const ready = Promise.resolve({ pushManager: pm });
  Object.defineProperty(navigator, "serviceWorker", { value: { register: async () => ({}), ready } });
}, ENDPOINT);
async function signup(email, name) {
  await p.goto(APP + "/today", { waitUntil: "networkidle2" }); await p.click("button[type=button]");
  await p.type("#email", email); await p.type("#password", "a-strong-password-123");
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2" }), p.click("button[type=submit]")]);
  await p.$eval("input[name=display_name]", (el, n) => (el.value = n), name);
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2" }), p.$eval("form button.btn-primary", (x) => x.click())]);
  const r = await q("select id from auth.users where email=$1", [email]); if (!r.length) console.log("SIGNUP FAIL", p.url(), (await p.evaluate(() => document.body.innerText)).slice(0, 400)); return r[0].id;
}
const owner = async () => (await q("select user_id from push_subscriptions where endpoint=$1", [ENDPOINT]))[0]?.user_id ?? null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = Date.now();
const A = await signup(`deva+${stamp}@example.com`, "A");
await wait(1500);
console.log("dbg", await p.evaluate(async () => ({ perm: Notification.permission, pm: "PushManager" in window, sw: !!navigator.serviceWorker, sub: !!(await (await navigator.serviceWorker.ready).pushManager.getSubscription()), ss: JSON.stringify(sessionStorage) })));
p.on("response", (r) => { if (r.url().includes("/api/push")) console.log("push resp", r.status()); });
await p.reload({ waitUntil: "networkidle2" }); await wait(1500);
console.log("after A opens app, owner is A:", (await owner()) === A);
// Sign out from More (detaches device)
await p.goto(APP + "/more", { waitUntil: "networkidle2" });
await Promise.all([p.waitForNavigation({ waitUntil: "networkidle2" }), p.$$eval("button", (bs) => bs.find((x) => x.textContent === "Sign out").click())]);
console.log("after sign out, device detached:", (await owner()) === null, p.url());
// Second account on same device, then simulate stale ownership by B and A opening again
const B = await signup(`devb+${stamp}@example.com`, "B");
await wait(1500);
console.log("after B opens app, owner is B:", (await owner()) === B);
await q("update push_subscriptions set user_id=$2 where endpoint=$1", [ENDPOINT, A]); // stale: device registered to A while B is signed in
await p.evaluate(() => sessionStorage.clear());
await p.goto(APP + "/today", { waitUntil: "networkidle2" }); await wait(1500);
console.log("stale device re-assigned to signed-in account:", (await owner()) === B);
await q("delete from auth.users where id = any($1)", [[A, B]]); await b.close(); await db.end();
