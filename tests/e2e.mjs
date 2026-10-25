// End-to-end check with three simulated phones against a running server.
// Usage: npm run build && npm start, then in another terminal: npm run e2e
// Screenshots land in tests/screens/.
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const phone = { ...devices['iPhone 13'], defaultBrowserType: 'chromium' };
delete phone.defaultBrowserType;

const log = (...a) => console.log('[e2e]', ...a);
let failures = 0;
const check = (ok, what) => { log(ok ? 'PASS' : 'FAIL', what); if (!ok) failures++; };

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const mk = async (name) => {
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { log(`${name} page error:`, e.message); failures++; });
  page.on('console', (m) => { if (m.type() === 'error') log(`${name} console:`, m.text()); });
  await page.goto(BASE);
  return page;
};
const hs = (page, expr) => page.evaluate(`(() => { const h = window.__hs; return ${expr}; })()`);

const [a, b, c] = [await mk('Ana'), await mk('Ben'), await mk('Cy')];
await a.fill('#name', 'Ana');
await a.screenshot({ path: OUT + '1-home.png' });
await a.click('#create');
await a.waitForSelector('#lobby:not([hidden])');
const code = (await a.textContent('#room-code')).trim();
check(/^[A-Z2-9]{6}$/.test(code), `room code looks right (${code})`);

for (const [p, n] of [[b, 'Ben'], [c, 'Cy']]) {
  await p.fill('#name', n);
  await p.fill('#code', code);
  await p.click('#join');
  await p.waitForSelector('#lobby:not([hidden])');
}
await sleep(300);
check((await a.locator('#players li').count()) === 3, 'host sees 3 players');
await b.click('#ready');
await a.selectOption('#set-hide', '30');
await a.selectOption('#set-seek', '120');
await a.selectOption('#set-rounds', '1');
await sleep(300);
check((await c.inputValue('#set-hide')) === '30', 'settings sync to other players');
check(await c.isDisabled('#set-hide'), 'non-host cannot edit settings');
await b.screenshot({ path: OUT + '2-lobby.png' });

// Wrong code shows an error.
const d = await mk('Dee');
await d.fill('#code', 'ZZZZZZ');
await d.click('#join');
await sleep(400);
check((await d.textContent('#home-error')).includes('not found'), 'wrong code shows "Room not found"');
await d.context().close();

await a.click('#start');
await a.waitForSelector('#game:not([hidden])');
await sleep(800);
const seekerId = await hs(a, 'h.room.seekerId');
const pages = [a, b, c];
const ids = await Promise.all(pages.map((p) => hs(p, 'h.me')));
const seeker = pages[ids.indexOf(seekerId)];
const hiders = pages.filter((p) => p !== seeker);
check(!!seeker, 'one seeker picked');
check((await hiders[0].textContent('#intro-role')).includes('hiding'), 'hider sees hiding intro');
check((await seeker.textContent('#intro-role')).includes('seeker'), 'seeker sees seeker intro');
await hiders[0].screenshot({ path: OUT + '3-countdown.png' });

await hiders[0].waitForFunction(() => window.__hs.room?.phase === 'hiding', null, { timeout: 15000 });
await sleep(500);
check(await seeker.isVisible('#blindfold'), 'seeker is blindfolded while hiders hide');
await seeker.screenshot({ path: OUT + '4-seeker-blind.png' });

// Hider walks with the joystick (drag on the stick) and then swaps.
const h0 = hiders[0];
const before = await hs(h0, 'h.pred && { ...h.pred }');
const box = await h0.locator('.stick-base').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
await h0.mouse.move(cx, cy);
await h0.mouse.down();
await h0.mouse.move(cx + 40, cy - 40, { steps: 4 });
await sleep(900);
await h0.mouse.up();
await sleep(400);
const after = await hs(h0, 'h.pred && { ...h.pred }');
const serverPos = await hs(h0, '(() => { const p = h.snaps().players.get(h.me); return { x: p.x, z: p.z }; })()');
const moved = Math.hypot(after.x - before.x, after.z - before.z);
check(moved > 1, `hider moved with the joystick (${moved.toFixed(2)} units)`);
check(Math.hypot(after.x - serverPos.x, after.z - serverPos.z) < 0.6, 'client prediction matches the server');
await h0.screenshot({ path: OUT + '5-hider-walk.png' });

for (const h of hiders) {
  // Keep walking up/left a little until something swappable is in range.
  for (let i = 0; i < 12 && !(await hs(h, 'h.selected')); i++) {
    await h.keyboard.down(i % 2 ? 'a' : 'w');
    await sleep(250);
    await h.keyboard.up(i % 2 ? 'a' : 'w');
  }
  const target = await hs(h, 'h.selected');
  check(!!target, 'hider has a prop in range to swap into');
  await h.click('#b-swap');
  await sleep(500);
  const disguise = await hs(h, 'h.snaps().players.get(h.me).d');
  check(!!disguise, `hider became a ${disguise || 'nothing'}`);
}
await h0.click('#b-lock');
await sleep(400);
check((await h0.textContent('#b-lock')).includes('Locked'), 'lock button locks the disguise');
await h0.screenshot({ path: OUT + '6-hider-disguised.png' });

await seeker.waitForFunction(() => window.__hs.room?.phase === 'seeking', null, { timeout: 40000 });
await sleep(800);
check(!(await seeker.isVisible('#blindfold')), 'blindfold lifts when seeking starts');
// The seeker sees no hider names and no real hider ids.
const seen = await hs(seeker, '[...h.snaps().players.keys()]');
check(!seen.some((id) => ids.includes(id) && id !== seekerId), 'seeker snapshot hides real hider ids');
await seeker.screenshot({ path: OUT + '7-seeker-seeking.png' });

// Seeker tags whatever is selected near spawn: probably a real prop, so a 5 s penalty.
for (let i = 0; i < 10 && !(await hs(seeker, 'h.selected')); i++) {
  await seeker.keyboard.down('w'); await sleep(200); await seeker.keyboard.up('w');
}
const leftBefore = await hs(seeker, 'h.snaps().left');
const sel = await hs(seeker, 'h.selected');
check(!!sel, 'seeker has something in range to tag');
await seeker.click('#b-tag');
await sleep(500);
const leftAfter = await hs(seeker, 'h.snaps().left');
const tagMiss = leftBefore - leftAfter > 4000;
const foundSomeone = (await hs(seeker, 'h.room.players.filter(p => p.role === "hider" && !p.alive).length')) > 0;
check(tagMiss || foundSomeone, `tag resolved (${tagMiss ? 'miss, -5 s' : 'found a hider'})`);
await seeker.screenshot({ path: OUT + '8-seeker-tag.png' });

// Reconnect: reload a hider mid-round and make sure they come back into the game.
await hiders[1].reload();
await hiders[1].waitForSelector('#game:not([hidden])', { timeout: 10000 });
check(true, 'reloaded hider rejoined the running game');

await browser.close();
log(failures ? `${failures} problem(s)` : 'all good');
process.exit(failures ? 1 : 0);
