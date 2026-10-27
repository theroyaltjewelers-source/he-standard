// End-to-end test of The Standard's Phase 1 against real PostgreSQL (with the
// real migration and RLS) via the local API stand-in, driving the production
// build in headless Chromium.
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import http from "node:http";
import https from "node:https";
import crypto from "node:crypto";
import ece from "http_ece";
import pg from "pg";
import fs from "node:fs";

const APP = "http://localhost:3000";
const env = Object.fromEntries(fs.readFileSync(new URL("../../.env.local", import.meta.url), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const db = new pg.Pool({ host: "127.0.0.1", port: 54322, user: "postgres", database: "standard" });
const q = async (sql, p = []) => (await db.query(sql, p)).rows;

// Scheduler secret: env override, else the server-managed value in app_config.
const CRON = env.CRON_SECRET || (await q("select value from app_config where key='cron_secret'"))[0].value;

let passed = 0, failed = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} ${extra}`); }
};
const section = (s) => console.log(`\n${s}`);

/* ---------- fake push service that decrypts what it receives ---------- */
const receiver = crypto.createECDH("prime256v1");
receiver.generateKeys();
const authSecret = crypto.randomBytes(16);
const received = [];
const pushServer = https.createServer({ key: fs.readFileSync("push.key"), cert: fs.readFileSync("push.crt") }, async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  let payload = null;
  try {
    payload = JSON.parse(ece.decrypt(body, { version: "aes128gcm", privateKey: receiver, authSecret }).toString());
  } catch (e) { payload = { decryptError: e.message }; }
  received.push({ headers: req.headers, payload });
  res.writeHead(201); res.end();
}).listen(54400);

const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true, defaultViewport: { width: 390, height: 844, deviceScaleFactor: 2 } });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
await page.emulateTimezone("America/New_York");

const go = (p) => page.goto(APP + p, { waitUntil: "networkidle2" });
const text = () => page.evaluate(() => document.body.innerText);
const shot = (n) => page.screenshot({ path: `shot-${n}.png`, fullPage: true });
// DOM click: avoids the fixed mobile nav bar intercepting coordinate clicks.
const domClick = (selector) => page.$eval(selector, (b) => b.click());
async function submit(selector = "form button.btn-primary") {
  await Promise.all([page.waitForNetworkIdle({ idleTime: 500, concurrency: 1, timeout: 20000 }).catch(() => console.log("    (idle wait timed out)")), domClick(selector)]);
}
async function fill(sel, v) {
  await page.$eval(sel, (el) => { el.value = ""; });
  await page.type(sel, v);
}

const email = `tahir.test+${Date.now()}@example.com`;
const password = "a-strong-password-123";

try {
  section("1. Sign up and sign in");
  await go("/today");
  ok(page.url().includes("/login"), "signed-out visit redirects to login");
  await page.click("button[type=button]"); // switch to "Create an account"
  await fill("#email", email);
  await fill("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click("button[type=submit]")]);
  ok(page.url().includes("/onboarding"), "new account lands on onboarding", page.url());
  const [user] = await q("select id from auth.users where email=$1", [email]);
  ok(!!user, "auth user created");
  const [prof] = await q("select * from profiles where id=$1", [user.id]);
  ok(!!prof && !prof.onboarding_completed_at, "profile row auto-created by trigger");

  section("2. Onboarding");
  await page.$eval("input[name=display_name]", (el) => (el.value = "Tahir"));
  await page.click("label.chip:has(input[value=honesty])");
  await page.click("label.chip:has(input[value=attention])");
  await page.click("label.chip:has(input[value='Avoidance'])");
  await shot("onboarding");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  ok(page.url().includes("/today"), "onboarding completes to Today", page.url());
  const [p2] = await q("select * from profiles where id=$1", [user.id]);
  ok(p2.onboarding_completed_at && p2.timezone === "America/New_York", "onboarding saved (timezone detected)", p2.timezone);
  ok(p2.focus_areas.includes("honesty") && p2.challenges.includes("Avoidance"), "focus areas and challenges saved");
  ok(p2.ai_analysis_consent === false, "AI consent defaults to off");
  const checkins = await q("select dedupe_key, send_at from reminders where user_id=$1 and entity_type='checkin' order by send_at", [user.id]);
  ok(checkins.length >= 2, `check-in reminders scheduled (${checkins.map((c) => c.dedupe_key).join(", ")})`);
  let t = await text();
  ok(/1448 AH/.test(t), "dashboard shows Hijri date");
  ok(/Nothing was committed or scheduled/.test(t), "no score shown when nothing recorded (no invented number)");
  await shot("today-empty");

  section("3. Morning accountability interview");
  await go("/checkin/morning");
  await fill("input[name=c1_title]", "Send the revised quote to the Hendricks client");
  await page.$eval("input[name=c1_time]", (el) => (el.value = "23:00"));
  await fill("input[name=c1_outcome]", "Client has the revised quote PDF");
  await fill("input[name=c1_effort]", "45");
  await fill("input[name=c1_obstacle]", "Instagram after lunch");
  await fill("input[name=c1_first]", "Open last week's quote file");
  await domClick("button.btn-quiet[type=button]"); // add a second priority
  await page.waitForSelector("input[name=c2_title]");
  await fill("input[name=c2_title]", "Review October cash flow");
  await page.$eval("input[name=c2_time]", (el) => (el.value = "23:30"));
  await fill("input[name=c2_outcome]", "Know this month's net and top three expenses");
  await fill("input[name=c2_first]", "Export the bank CSV");
  await fill("input[name=c2_to]", "Ali");
  await fill("textarea[name=contingency]", "busy");
  await page.click("input[name=skip_spiritual_intention]");
  await fill("textarea[name=avoid_behavior]", "Scrolling social media before noon");
  await fill("textarea[name=character_plan]", "Tell clients real timelines, wait before replying when irritated, finish the quote before email");
  await fill("input[name=intention]", "Finish what I start before starting anything new.");
  await submit();
  t = await text();
  if (/Schedule check/.test(t)) {
    ok(true, "schedule conflicts shown before saving");
    await page.click("input[name=ack_conflicts]");
    await submit();
    t = await text();
  }
  ok(/need more detail/.test(t), "vague answer is not accepted");
  ok(/What specifically occupied your time|specific/i.test(t), "follow-up question asked respectfully");
  ok((await page.$eval("input[name=c1_title]", (e) => e.value)).includes("Hendricks"), "typed answers preserved after follow-up");
  await shot("morning-followup");
  await fill("textarea[name=contingency]", "If I open Instagram I will close it and start the quote for 25 minutes");
  // The follow-up field remains; answer it too.
  if (await page.$("textarea[name=fu_contingency]")) await fill("textarea[name=fu_contingency]", "I will put the phone in the drawer");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  ok(page.url().includes("checkin=morning"), "morning check-in recorded", page.url());
  const cs = await q("select * from commitments where user_id=$1 order by promised_by", [user.id]);
  ok(cs.length === 2 && cs[1].made_to === "Ali", "two commitments created with promised-to person");
  ok(cs[0].expected_outcome?.includes("revised quote") && cs[0].effort_minutes === 45 && cs[0].first_action?.includes("quote file") && cs[0].obstacles?.includes("Instagram"), "priority stores outcome, effort, obstacle and first action");
  const crem = await q("select * from reminders where user_id=$1 and entity_type='commitment'", [user.id]);
  ok(crem.length === 4 && crem.filter((r) => r.dedupe_key.includes(":pre:")).length === 2 && crem.filter((r) => r.dedupe_key.includes(":due:")).length === 2, "each commitment gets a reminder 1 hr before and one at the promised time");
  const ans = await q("select a.* from accountability_answers a join accountability_sessions s on s.id=a.session_id where s.user_id=$1", [user.id]);
  ok(ans.length >= 4, `interview answers stored (${ans.length})`);
  ok(ans.some((a) => a.question_key === "spiritual_intention" && a.skipped === true && a.answer === ""), "skipped question recorded as skipped, not answered");
  const [plan] = await q("select * from daily_plans where user_id=$1", [user.id]);
  ok(plan?.intention?.startsWith("Finish what I start"), "daily intention saved");
  t = await text();
  ok(/Finish what I start/.test(t) && /Send the revised quote/.test(t), "dashboard shows intention and commitments");
  await shot("today-after-morning");

  section("4. Tasks, goals, habits");
  await fill("input[name=title][aria-label='New task']", "Call the diamond supplier about the 2ct stone");
  await submit("form:has(input[aria-label='New task']) button.btn-quiet");
  await go("/today");
  t = await text();
  ok(/Call the diamond supplier/.test(t), "task created from dashboard");
  const [task] = await q("select * from tasks where user_id=$1", [user.id]);
  // complete with evidence via the inline form
  const titleBtn = await page.$$("li button.text-left");
  await titleBtn[0].click();
  await page.waitForSelector("input[name=evidence]");
  await page.type("input[name=evidence][placeholder='Evidence (optional)']", "Confirmed price by phone, notes in CRM");
  await Promise.all([page.waitForNetworkIdle({ idleTime: 500, concurrency: 1 }), domClick("form:has(input[placeholder='Evidence (optional)']) button")]);
  const [task2] = await q("select * from tasks where id=$1", [task.id]);
  ok(task2.status === "done" && task2.verification === "evidence", "task completed with evidence (verification=evidence)", JSON.stringify([task2.status, task2.verification]));

  await go("/goals/new");
  await fill("#title", "Personal cash reserve");
  await fill("#desired_outcome", "Three months of personal expenses held separately from business accounts");
  await fill("#success_criteria", "Reserve account balance reaches target by March 31");
  await page.$eval("#target_date", (el) => (el.value = "2027-03-31"));
  await fill("#recovery_plan", "If I miss a monthly transfer, transfer half within 48 hours and review the spending that caused it");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  ok(/\/goals\/[0-9a-f-]{36}$/.test(page.url()), "goal created");
  await page.type("textarea[name=note]", "Opened the separate reserve account and set an automatic transfer");
  await page.type("input[name=progress_pct]", "10");
  await submit("form:has(textarea[name=note]) button");
  const prog = await q("select * from goal_progress where user_id=$1", [user.id]);
  ok(prog.length === 1 && prog[0].progress_pct === 10, "goal progress logged");

  await go("/goals");
  ok(page.url().includes("/progress"), "old Goals URL leads to Progress");
  await go("/rhythm");
  await page.type("input[aria-label=Habit]", "Fajr on time");
  await submit("form:has(input[aria-label=Habit]) button.btn-quiet");
  const [habit] = await q("select * from habits where user_id=$1", [user.id]);
  ok(!!habit, "habit created");
  await go("/today");
  await submit("form:has(input[name=habit_id]) button[value=done]");
  const hl = await q("select * from habit_logs where habit_id=$1", [habit.id]);
  ok(hl.length === 1 && hl[0].status === "done", "habit logged done for today");

  section("5. Calendar and appointment reminders");
  await go("/plan/new");
  await fill("#title", "Client consultation, engagement ring");
  const tomorrow = new Date(Date.now() + 86400000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await page.$eval("#date", (el, v) => (el.value = v), tomorrow);
  await page.$eval("#time", (el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, "20:00"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("#prep", (el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, "30"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("#travel", (el) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; s.call(el, "25"); el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.click("label:has(input[type=checkbox]:not([name])) input");
  await new Promise((r) => setTimeout(r, 200));
  t = await text();
  ok(/7:05 PM\s*Start preparing/.test(t) && /7:35 PM\s*Leave/.test(t), "form calculates prep (7:05 PM) and departure (7:35 PM) for 8:00 PM");
  await shot("event-form");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  ok(page.url().includes("/plan?date="), "appointment saved");
  const [ev] = await q("select * from events where user_id=$1", [user.id]);
  const evr = await q("select dedupe_key, send_at, title from reminders where entity_id=$1 order by send_at", [ev.id]);
  const keys = evr.map((r) => r.dedupe_key.split(":").pop());
  const beforeEve = Number(new Date().toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" })) < 19;
  ok([...(beforeEve ? ["eve"] : []), "before-60", "prep", "leave"].every((k) => keys.includes(k)) && (beforeEve || !keys.includes("eve")), `appointment reminders: ${keys.join(", ")} (evening-before heads-up only while 7 PM hasn't passed)`);
  const leave = evr.find((r) => r.dedupe_key.endsWith(":leave"));
  ok(new Date(leave.send_at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" }) === "7:35 PM", "leave-now reminder at 7:35 PM local");
  await go(`/plan?view=month&date=${tomorrow}`);
  await shot("plan-month");
  await go(`/plan?view=week&date=${tomorrow}`);
  t = await text();
  ok(/Client consultation/.test(t), "week view shows appointment");

  section("6. Journal");
  await go("/journal/new");
  await page.type("textarea[name=body]", "Lost about forty minutes scrolling after lunch. The urge came right after a frustrating call with a vendor.");
  await page.click("label.chip:has(input[value=habits])");
  await page.click("label:has(input[name=mood][value='2'])");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  ok(/\/journal\/[0-9a-f-]{36}$/.test(page.url()), "journal entry saved");
  await go("/journal?q=scroll");
  t = await text();
  ok(/frustrating call/.test(t), "full-text search finds the entry (stemmed: 'scroll' → 'scrolling')");
  await go("/journal?q=zebra");
  ok(/No entries match/.test(await text()), "search excludes non-matching entries");

  section("7. Scheduled push notifications");
  const pub = receiver.getPublicKey().toString("base64url");
  await q("insert into push_subscriptions(user_id,endpoint,p256dh,auth,device_label) values($1,$2,$3,$4,'Test device')", [user.id, `https://127.0.0.1:54400/push/${Date.now()}`, pub, authSecret.toString("base64url")]);
  // Reminder due one minute ago, outside quiet-hours concerns
  const [rem] = await q("insert into reminders(user_id,entity_type,title,body,url,send_at,respect_quiet_hours) values($1,'custom','Review cash flow','You committed to this by 2:00 PM. Are you still on track?','/today', now() - interval '1 minute', false) returning id", [user.id]);
  const unauth = await fetch(`${APP}/api/cron/dispatch`, { method: "POST" });
  ok(unauth.status === 401, "dispatcher rejects calls without the cron secret");
  const d = await (await fetch(`${APP}/api/cron/dispatch`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } })).json();
  ok(d.ok && d.sent >= 1, `dispatcher sent due reminder ${JSON.stringify(d)}`);
  const got = received.find((r) => r.payload?.title === "Review cash flow");
  ok(!!got, "push service received an encrypted message, decrypted with the device keys");
  ok(got?.headers?.authorization?.startsWith("vapid t="), "message carries a VAPID signature");
  const [rem2] = await q("select status from reminders where id=$1", [rem.id]);
  ok(rem2.status === "sent", "reminder marked sent only after push service returned 201");
  const [n] = await q("select * from notifications where reminder_id=$1", [rem.id]);
  ok(n?.status === "accepted" && n.push_service_status === 201, "delivery log says accepted (not 'delivered')");
  // Simulate the service worker acknowledging display, using the signed-in session cookies
  const cookies = (await page.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const ack = await fetch(`${APP}/api/notifications/ack`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookies }, body: JSON.stringify({ id: got.payload.id, event: "displayed" }) });
  ok(ack.ok, "service-worker acknowledgement accepted");
  const [n2] = await q("select status, displayed_at from notifications where id=$1", [n.id]);
  ok(n2.status === "displayed" && n2.displayed_at, "notification marked displayed after device confirms");
  // Commitment reminder for a resolved commitment should not be sent
  const todayNY = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  await q("insert into reminders(user_id,entity_type,dedupe_key,title,url,send_at,respect_quiet_hours) values($1,'checkin',$2,'Morning commitments','/checkin/morning', now() - interval '1 minute', false)", [user.id, `checkin:morning:${todayNY}`]);
  const d2 = await (await fetch(`${APP}/api/cron/dispatch`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } })).json();
  ok(d2.skipped === 1 && d2.sent === 0, `already-completed morning check-in prompt is not sent ${JSON.stringify(d2)}`);
  // Planner
  const pl = await (await fetch(`${APP}/api/cron/plan`, { method: "POST", headers: { Authorization: `Bearer ${CRON}` } })).json();
  ok(pl.ok && pl.users >= 1, `planner ran ${JSON.stringify(pl)}`);
  // Reminders page wording
  await go("/reminders");
  t = await text();
  ok(/Shown on the device/.test(t) && /Test device/.test(t), "reminders page shows device and confirmed delivery");
  await shot("reminders");

  section("8. Evening accountability interview");
  await go("/checkin/evening");
  // Try finishing with open commitments
  await page.type("textarea[name=evidence]", "x");
  await submit("form:has(textarea[name=evidence]) button.btn-primary");
  ok(/Record each of today's commitments first/.test(await text()), "cannot finish with unrecorded commitments");
  // Kept with evidence
  let chips = await page.$$("li button.chip");
  await chips[0].click();
  await page.waitForSelector("input[name=evidence][placeholder^='e.g.']");
  await page.type("input[name=evidence][placeholder^='e.g.']", "Quote PDF sent 1:40 PM, client replied");
  await submit("form:has(input[placeholder^='e.g.']) button.btn-primary");
  // Not kept, require context
  chips = await page.$$("li button.chip");
  const notKept = (await Promise.all(chips.map(async (c) => [c, await c.evaluate((e) => e.textContent)]))).find(([, l]) => l === "Not kept")[0];
  await notKept.click();
  await page.waitForSelector("textarea[name=failure_context]");
  await page.type("textarea[name=failure_context]", "Started scrolling Instagram after the vendor call and lost the hour");
  await submit("form:has(textarea[name=failure_context]) button.btn-primary");
  const cs2 = await q("select status, verification, failure_context from commitments where user_id=$1 order by promised_by", [user.id]);
  ok(cs2[0].status === "kept" && cs2[0].verification === "evidence", "commitment 1 kept with evidence");
  ok(cs2[1].status === "broken" && cs2[1].failure_context.includes("Instagram"), "commitment 2 recorded as not kept, with context");
  await go("/checkin/evening");
  const answers = {
    evidence: "Quote PDF in sent mail at 1:40 and the supplier call notes",
    failure_trigger: "I was busy",
    chose_instead: "Scrolled Instagram and answered non-urgent texts",
    honest_communication: "Yes, told Ali the review would slip to tomorrow",
    emotions: "Irritated after the vendor call, took a walk before replying",
    money: "Nowhere",
    consideration: "Stayed late to help a walk-in client choose a band",
    self_control: "Did not reply to the vendor while irritated",
    distraction_minutes: "About 60 minutes on Instagram",
    change_tomorrow: "Do the cash flow review at 9 AM before opening any apps",
  };
  for (const [k, v] of Object.entries(answers)) await fill(`textarea[name=${k}]`, v);
  t = await text();
  ok(/You missed something you promised Ali/.test(t), "adaptive question about the promise to Ali appears");
  await submit("form:has(textarea[name=evidence]) button.btn-primary");
  t = await text();
  ok(/What specifically occupied your time/.test(t), "'I was busy' prompts: what specifically occupied your time?");
  const fuText = await page.$eval("textarea[name=fu_failure_trigger]", (el) => el.closest("div").innerText);
  ok(!/lying|lazy|excuse|should have|fail(ed|ure)? again/i.test(fuText), "no shaming language in follow-up", fuText);
  await shot("evening-followup");
  await page.type("textarea[name=fu_failure_trigger]", "Two walk-in clients from 2 to 3:30, then I scrolled until 4:30");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form:has(textarea[name=evidence]) button.btn-primary")]);
  ok(page.url().includes("checkin=evening"), "evening review completed");
  const [fu] = await q("select follow_up_question, follow_up_answer, follow_up_source from accountability_answers where question_key='failure_trigger' and user_id=$1", [user.id]);
  ok(fu?.follow_up_answer?.includes("walk-in") && fu.follow_up_source === "rule", "follow-up question and answer stored together");

  section("8b. Midday check-in");
  await go("/checkin/midday");
  await fill("textarea[name=completed]", "Sent the quote and called the supplier");
  await fill("textarea[name=outstanding]", "Cash flow review");
  await fill("textarea[name=distracted_by]", "Nothing");
  await page.click("input[name=skip_afternoon_change]");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  ok(page.url().includes("checkin=midday"), "midday check-in recorded (one answer skipped)");

  section("8c. Rhythm: focus and impulse interruption");
  await go("/rhythm");
  await domClick("form:has(input[name=minutes]) button.btn-primary");
  await page.waitForFunction(() => document.body.innerText.includes("I got distracted"), { timeout: 15000 });
  const [fsess] = await q("select * from focus_sessions where user_id=$1 and status='active'", [user.id]);
  ok(fsess?.planned_minutes === 25, "25-minute focus session started");
  await domClick("button.btn-quiet.w-full");
  await page.waitForSelector("input[name=note][aria-label=Distraction]");
  await page.type("input[name=note][aria-label=Distraction]", "Checked email");
  await submit("form:has(input[aria-label=Distraction]) button");
  await page.waitForFunction(() => document.body.innerText.includes("1 distraction logged"), { timeout: 10000 }).catch(() => {});
  await submit("button[name=status][value=completed]");
  const [fs2] = await q("select status, distractions from focus_sessions where id=$1", [fsess.id]);
  ok(fs2.status === "completed" && fs2.distractions.length === 1 && fs2.distractions[0].note === "Checked email", "focus session completed with one distraction logged");
  await go("/rhythm");
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("I feel an urge"))?.click());
  await page.evaluate(() => [...document.querySelectorAll("button.chip")].find((b) => b.textContent.includes("Scroll social media"))?.click());
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Pause 60 seconds"))?.click());
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("ready now"))?.click());
  await page.waitForSelector("input[name=alternative]");
  await page.type("input[name=feeling]", "Restless");
  await page.type("input[name=alternative]", "Ten minutes on the cash flow sheet");
  await submit("form:has(input[name=alternative]) button.btn-primary");
  await page.waitForFunction(() => document.body.innerText.includes("Recorded. Go do the alternative"), { timeout: 10000 });
  const [imp] = await q("select * from impulse_logs where user_id=$1", [user.id]);
  ok(imp?.kind === "social_media" && imp.intervention === "pause" && imp.alternative.includes("cash flow") && imp.outcome === null, "urge, intervention and alternative recorded; outcome left for later");
  await go("/rhythm");
  await submit("form:has(input[name=id]) button[value=resisted]");
  const [imp2] = await q("select outcome from impulse_logs where id=$1", [imp.id]);
  ok(imp2.outcome === "resisted", "outcome recorded honestly afterwards");

  section("8d. Money");
  await go("/money");
  await page.type("input[name=amount]", "42.50");
  await page.type("input[name=description]", "Takeout lunch");
  await page.click("input[name=discretionary]");
  await submit("form:has(input[name=amount]) button.btn-primary");
  const [fe] = await q("select * from financial_entries where user_id=$1", [user.id]);
  ok(fe && Number(fe.amount) === 42.5 && fe.kind === "expense" && fe.discretionary === true, "discretionary expense recorded");
  ok(/\$42\.50/.test(await text()), "money page totals the entry");

  section("8e. Guided reflection and calendar");
  await go("/journal/new?mode=after_slip");
  const guidedAreas = await page.$$("form label textarea");
  await guidedAreas[0].type("Planned the cash flow review at 2 PM; scrolled instead");
  await guidedAreas[1].type("At the counter after the vendor call, irritated");
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form button.btn-primary")]);
  const [gj] = await q("select guided_mode, body from journal_entries where user_id=$1 and guided_mode<>'free'", [user.id]);
  ok(gj?.guided_mode === "after_slip" && gj.body.includes("What did I intend to do") && gj.body.includes("scrolled instead") && !gj.body.includes("What will I put in place"), "guided entry saves answered prompts only");
  t = await text();
  ok(/Turn on AI analysis in Settings/.test(t), "Reflect Deeper is consent-gated (AI analysis off)");
  await go("/journal?view=calendar");
  ok((await page.$$("a span.bg-emerald")).length >= 1, "calendar view marks days with entries");

  section("8f. Progress and weekly report");
  await go("/progress");
  await submit("form button[name=week][value=this]");
  const [wr] = await q("select * from weekly_reports where user_id=$1", [user.id]);
  ok(!!wr && wr.sample && wr.metrics?.commitments?.made === 2, "weekly report generated from records", JSON.stringify(wr?.sample));
  t = await text();
  ok(/Where Your Actions Matched Your Values/.test(t) && /Where Your Actions Did Not Match Your Intentions/.test(t), "report shows both sections");
  ok(/Based on/.test(t), "report states its sample size");
  ok(/Not kept|Review October cash flow|never recorded|Missed|did not/i.test(t), "shortfall listed under intentions");

  section("8g. Memory approval and preferences");
  const [pm] = await q("insert into ai_memory(user_id,kind,category,evidence_status,content,status,source_type) values($1,'hypothesis','difficulty','unverified','Afternoons after vendor calls are when scrolling starts','proposed','conversation') returning id", [user.id]);
  await q("insert into ai_memory_sources(user_id,memory_id,source_type,excerpt) values($1,$2,'conversation','I always scroll after those vendor calls')", [user.id, pm.id]);
  await go("/today");
  ok(/proposed 1 thing to remember/.test(await text()), "Today surfaces the pending memory");
  await go("/settings/memory");
  t = await text();
  ok(/Waiting for your approval/.test(t) && /Where this came from/.test(t), "proposed memory shown with its source");
  await submit("form:has(input[value=active]) button");
  const [pm2] = await q("select status from ai_memory where id=$1", [pm.id]);
  ok(pm2.status === "active", "memory kept only after approval");
  const [al] = await q("select action from audit_logs where user_id=$1 and entity_id=$2", [user.id, pm.id]);
  ok(al?.action === "memory.approved", "approval written to the audit log");
  await go("/settings");
  await page.click("input[name=theme][value=light]");
  await page.click("input[name=reminder_intensity][value=firm]");
  await page.click("input[name=cat_finance]");
  await submit("form:has(input[name=reminder_intensity]) button.btn-primary");
  const [prefs] = await q("select * from user_preferences where user_id=$1", [user.id]);
  ok(prefs.theme === "light" && prefs.reminder_intensity === "firm" && prefs.categories.finance.enabled === false, "preferences saved (theme, intensity, categories)");
  await go("/today");
  ok((await page.$eval("html", (h) => h.dataset.theme)) === "light", "light theme applied across the app");
  await go("/settings/calendar");
  t = await text();
  ok(/Google Calendar/.test(t) && (/Connect Google Calendar/.test(t) || /isn't set up on the server yet/.test(t)), "calendar settings show connection state honestly");
  await go("/settings/activity");
  ok(/memory approved/.test(await text()), "activity log lists the approval");
  await go("/word");
  t = await text();
  ok(/My Word/.test(t) && /Your record, last 14 days/.test(t), "My Word page renders");

  section("9. Integrity score");
  await go("/today");
  t = await text();
  const m = t.match(/Daily integrity\s*\n?\s*(\d+)/);
  ok(!!m, `score displayed: ${m?.[1]}`);
  ok(/1 of 2 commitments kept, 1 of 1 tasks done/.test(t), "score explanation counts kept vs claimed");
  ok(/2 with evidence, 0 self-reported/.test(t), "evidence vs self-reported distinguished");
  // Expected: commitments (1.0 + 0.3)/2 = 65; tasks 100; perf = (65*.55+100*.3)/.85 = 77.35; reporting 100 → 0.85*77.35+15 = 80.75 → 81
  ok(m?.[1] === "81", "score matches the published formula (81)", m?.[1]);
  await shot("today-final");

  section("10. Privacy: isolation, export, erase, delete");
  // Second user via auth API cannot read the first user's rows
  const s2 = await (await fetch("http://127.0.0.1:54321/auth/v1/signup", { method: "POST", headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: `other+${Date.now()}@example.com`, password: "another-password-1" }) })).json();
  const peek = await (await fetch("http://127.0.0.1:54321/rest/v1/journal_entries?select=*", { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${s2.access_token}` } })).json();
  ok(Array.isArray(peek) && peek.length === 0, "another account sees none of this user's journal (RLS)");
  const peekAnon = await fetch("http://127.0.0.1:54321/rest/v1/journal_entries?select=*", { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } });
  const pa = await peekAnon.json();
  ok(!Array.isArray(pa) || pa.length === 0, "anonymous key reads nothing");
  const html = await (await fetch(`${APP}/today`, { headers: { Cookie: cookies } })).text();
  ok(!html.includes(env.SUPABASE_SERVICE_ROLE_KEY) && !html.includes((await q("select value from app_config where key='vapid_private_key'"))[0].value) && !html.includes(CRON), "no server secrets in page HTML");
  const exp = await fetch(`${APP}/api/export`, { headers: { Cookie: cookies } });
  const data = await exp.json();
  ok(exp.ok && data.journal_entries.length === 2 && data.commitments.length === 2 && data.goals.length === 1 && data.accountability_answers.length > 5, "export contains journal, commitments, goals, answers");
  ok(/attachment/.test(exp.headers.get("content-disposition")), "export downloads as a file");
  ok(!JSON.stringify(data).includes(pub), "export omits device push keys");

  // memory page add/edit/delete
  await go("/settings/memory");
  await page.type("textarea[name=content][aria-label='New memory']", "Mornings before 10 are my best focus time.");
  await submit("form:has(textarea[aria-label='New memory']) button");
  const mem = await q("select * from ai_memory where user_id=$1", [user.id]);
  ok(mem.length === 2 && mem.some((m) => m.kind === "self_report" && m.evidence_status === "self_reported"), "memory added and labelled as self-report");

  await go("/settings");
  await shot("settings");
  await page.type("input[aria-label='Type ERASE to confirm']", "ERASE");
  await submit("form:has(input[aria-label='Type ERASE to confirm']) button");
  const left = await q(`select (select count(*) from journal_entries where user_id=$1) + (select count(*) from commitments where user_id=$1) + (select count(*) from tasks where user_id=$1) + (select count(*) from ai_memory where user_id=$1) + (select count(*) from notifications where user_id=$1) n`, [user.id]);
  ok(Number(left[0].n) === 0, "erase removes every record");
  const [still] = await q("select onboarding_completed_at from profiles where id=$1", [user.id]);
  ok(!!still, "erase keeps account and settings");

  await go("/settings");
  await page.type("input[aria-label='Type your email to confirm']", email);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), domClick("form:has(input[aria-label='Type your email to confirm']) button")]);
  const gone = await q("select (select count(*) from auth.users where id=$1) + (select count(*) from profiles where id=$1) + (select count(*) from push_subscriptions where user_id=$1) + (select count(*) from reminders where user_id=$1) n", [user.id]);
  ok(Number(gone[0].n) === 0, "account deletion removes the user and every row (cascade)");
  ok(page.url().includes("/login"), "signed out after deletion");

  section("Browser errors");
  ok(errors.length === 0, "no uncaught page errors", errors.join(" | "));
} catch (e) {
  failed++;
  console.log("FATAL", e);
  await shot("fatal").catch(() => {});
} finally {
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
  pushServer.close();
  await db.end();
  process.exit(failed ? 1 : 0);
}
