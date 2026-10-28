// Route timing baseline: signs up a throwaway account on the local stack, seeds
// representative records, then measures for each route (a) full document load
// and (b) in-app (client) navigation, plus the number of database/auth
// round trips the server made. Run the stand-in API with DELAY=<ms> to model
// network latency between the app server and the database.
//   node perf.mjs <server.log path> [label]
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import pg from "pg";
import fs from "node:fs";

const APP = "http://localhost:3000";
const LOG = process.argv[2];
const label = process.argv[3] ?? "run";
const db = new pg.Pool({ host: "127.0.0.1", port: 54322, user: "postgres", database: "standard" });
const q = async (s, p = []) => (await db.query(s, p)).rows;
const lines = () => fs.readFileSync(LOG, "utf8").split("\n").filter((l) => /^(GET|POST|PATCH|DELETE|PUT|HEAD) /.test(l)).length;

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true, defaultViewport: { width: 390, height: 844 } });
const page = await browser.newPage();
await page.emulateTimezone("America/New_York");
const email = `perf+${Date.now()}@example.com`;
await page.goto(APP + "/today", { waitUntil: "networkidle2" });
await page.click("button[type=button]");
await page.type("#email", email); await page.type("#password", "a-strong-password-123");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("button[type=submit]")]);
await page.$eval("input[name=display_name]", (el) => (el.value = "Perf"));
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.$eval("form button.btn-primary", (b) => b.click())]);
const [u] = await q("select id from auth.users where email=$1", [email]);
// Representative data: 2 weeks of tasks, events, journal, habits.
for (let d = -14; d <= 0; d++) {
  await q(`insert into tasks(user_id,title,scheduled_for,status) values ($1,'Task '||$2, (now() at time zone 'America/New_York')::date + $2::int, case when $2::int < 0 then 'done' else 'pending' end)`, [u.id, d]);
  await q(`insert into events(user_id,title,starts_at,ends_at) values ($1,'Meeting '||$2, now() + ($2||' days')::interval, now() + ($2||' days')::interval + interval '1 hour')`, [u.id, d]);
  await q(`insert into journal_entries(user_id,body,entry_date) values ($1,'Entry '||$2, (now() at time zone 'America/New_York')::date + $2::int)`, [u.id, d]);
}
const routes = ["/today", "/word", "/coach", "/faith", "/journal", "/rhythm", "/progress", "/plan", "/fitness", "/settings"];
const out = [];
const settle = () => page.waitForFunction(() => !document.querySelector("[aria-busy=true][aria-label^='Loading']"), { timeout: 30000 }).catch(() => {});
for (const r of routes) {
  // warm once (compiles nothing in prod, but fills connection pools)
  await page.goto(APP + r, { waitUntil: "load" }); await settle();
  const n0 = lines(); const t0 = Date.now();
  await page.goto(APP + r, { waitUntil: "load" }); await settle();
  const full = Date.now() - t0; const reqFull = lines() - n0;
  // client navigation from /more (where every link is a plain <Link>)
  await page.goto(APP + "/more", { waitUntil: "load" });
  const link = await page.$(`a[href='${r}']`);
  let nav = null, reqNav = null;
  if (link) {
    const n1 = lines(); const t1 = Date.now();
    await link.evaluate((a) => a.click());
    await page.waitForFunction((p) => location.pathname === p, {}, r); await settle();
    nav = Date.now() - t1; reqNav = lines() - n1;
  }
  out.push({ route: r, full_ms: full, db_calls: reqFull, client_nav_ms: nav, db_calls_nav: reqNav });
}
console.table(out);
fs.writeFileSync(`perf-${label}.json`, JSON.stringify({ label, delay: process.env.DELAY ?? "unknown", out }, null, 2));
await q("delete from auth.users where id=$1", [u.id]);
await browser.close(); await db.end();
