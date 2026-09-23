// Playlists, driven in real Chromium against the site on a real Postgres
// engine — see ../README.md, "How it was verified". Needs db/port/lib/local-pg.mjs
// listening and `next dev` on DATA_BACKEND=postgres pointed at it. Destructive
// to the LOCAL engine only (it clears hov.playlist before it starts).
//
//   node db/port/playlists/browser/drive.mjs
// Every playlist flow, in real Chromium, against the real site on a real
// Postgres engine. Asserts what the producer would see AND what the database
// holds afterwards.
const { chromium } = await import(new URL("../../../../platform/node_modules/playwright-core/index.mjs", import.meta.url).href);
import { execFileSync } from "node:child_process";

const BASE = process.env.BASE || "http://127.0.0.1:3211";
const SHOTS = process.env.SHOTS || "/tmp/playlist-shots";
const results = [];
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  results.push(ok);
  console.log(`${ok ? "OK  " : "FAIL"} ${name} -> ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const sql = (q) =>
  execFileSync("psql", ["-h", "127.0.0.1", "-p", process.env.LOCAL_PG_PORT || "55432", "-U", "postgres", "-d", "postgres", "-X", "-q", "-t", "-A", "-c", q], {
    env: { ...process.env, PGPASSWORD: "postgres" },
  })
    .toString()
    .trim();

execFileSync("mkdir", ["-p", SHOTS]);
sql("delete from hov.playlist");

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });

const bar = page.locator('[role="group"][aria-label="Playlists"]');
const chips = async () =>
  bar.locator("button[aria-pressed]").evaluateAll((els) =>
    els.map((b) => ({
      name: b.querySelector("span")?.textContent ?? "",
      n: b.querySelectorAll("span")[1]?.textContent ?? "",
      on: b.getAttribute("aria-pressed") === "true",
    })),
  );
const msg = () => page.locator(".ptools .formmsg").textContent().catch(() => null);
const cardTitles = () => page.locator("a.proj h3").evaluateAll((els) => els.map((e) => e.textContent.trim()));
// Like a producer: if the film is not on this page, page through until it is.
// The selection is held by id, so it has to survive the paging.
const tick = async (title) => {
  const card = page.locator("a.proj", { has: page.locator("h3", { hasText: title }) }).first();
  for (let tries = 0; tries < 6 && (await card.count()) === 0; tries++) {
    const pages = await page.locator(".pgnum").count();
    if (pages === 0) break;
    const cur = Number(await page.locator(".pgnum.on").textContent());
    const next = cur < pages ? cur + 1 : 1;
    await page.locator(".pgnum", { hasText: String(next) }).first().click();
    await page.waitForTimeout(250);
  }
  await card.click();
};
const settle = () => page.waitForTimeout(700);
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png` });

// 1 — nothing yet
check("the bar is there", await bar.count(), 1);
check("with no playlists there is no All-films chip", (await chips()).length, 0);
check("it offers + New playlist", await bar.getByRole("button", { name: "＋ New playlist" }).count(), 1);
await shot("01-empty");

// 2 — create one by name
await bar.getByRole("button", { name: "＋ New playlist" }).click();
const nameInput = bar.locator('input[aria-label="Name the playlist"]');
check("the name field opens focused", await nameInput.evaluate((el) => el === document.activeElement), true);
await nameInput.fill("  Google   Maps  ");
await shot("02-naming");
await nameInput.press("Enter");
await page.locator(".ptools button.abtn.ok").waitFor();
let c = await chips();
check("the new playlist is a chip, whitespace cleaned, empty", c.map((x) => [x.name, x.n]), [["All films", "22"], ["Google Maps", "0"]]);
check("and the library is in select mode to fill it", await page.locator(".ptools").getByText("0 selected").count(), 1);
check("the one action offered is Add to it (disabled until something is ticked)", await page.locator(".ptools button.abtn.ok").isDisabled(), true);
check("no Delete competes with it", await page.locator(".ptools").getByText("Delete").count(), 0);
check("the message says what to do next, briefly", await msg(), "Created “Google Maps” — now tick the films to put in it.");
await shot("03-fill-mode");

// 3 — tick three and add
for (const t of ["How Google Maps was built", "The ZipDash deal nobody remembers", "Street View's first car"]) await tick(t);
check("the button counts the ticks", (await page.locator(".ptools button.abtn.ok").textContent()).trim(), "＋ Add 3 to “Google Maps”");
await shot("04-ticked");
await page.locator(".ptools button.abtn.ok").click();
const seen = [];
for (let t = 0; t < 60; t++) {
  seen.push((await chips()).find((x) => x.name === "Google Maps")?.n ?? "?");
  await page.waitForTimeout(50);
}
const firstThree = seen.indexOf("3");
check("the count reaches 3", firstThree >= 0, true);
check("…and never falls back once it has (sampled every 50 ms for 3 s)", seen.slice(firstThree).filter((n) => n !== "3"), []);
console.log("     samples:", [...new Set(seen)].join(" → "), `(first 3 at sample ${firstThree})`);
check("the view moves to the playlist", (await chips()).find((x) => x.on)?.name, "Google Maps");
check("…and shows exactly those three", (await cardTitles()).sort(), ["How Google Maps was built", "Street View's first car", "The ZipDash deal nobody remembers"]);
check("the chip counts them", (await chips()).find((x) => x.name === "Google Maps")?.n, "3");
check("the address names it", new URL(page.url()).searchParams.get("playlist")?.startsWith("rec"), true);
check("the database holds three memberships", sql("select count(*) from hov.playlist_project"), "3");
check("the status tab counts answer inside the playlist", await page.locator(".ftab.on .c").textContent(), "3");
check("the Showing line says where", (await page.locator(".pshowing span").first().textContent()).includes("in “Google Maps”"), true);
await shot("05-in-playlist");

// 4 — the link survives a reload (server state, not local)
const link = page.url();
await page.goto(link, { waitUntil: "networkidle" });
check("a reload lands on the same playlist", (await chips()).find((x) => x.on)?.name, "Google Maps");
check("…with the same three films", (await cardTitles()).length, 3);

// 5 — Select → Add to playlist → create a new one from the menu, from All films
await bar.getByRole("button", { name: /All films/ }).click();
await settle();
check("All films brings the library back", (await cardTitles()).length, 15);
check("…and takes ?playlist= out of the address", new URL(page.url()).searchParams.get("playlist"), null);
await page.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
for (const t of ["Pip the Fox and the lost acorn", "Pip the Fox learns to swim", "How Google Maps was built"]) await tick(t);
await page.locator(".ptools").getByRole("button", { name: "＋ Add to playlist" }).click();
const pop = page.locator('[role="dialog"][aria-label="Add to a playlist"]');
check("the menu opens", await pop.count(), 1);
{
  const box = await pop.boundingBox();
  check("the menu is entirely on screen (16px margins)", [Math.round(box.x) >= 16, Math.round(box.x + box.width) <= 1280 - 16], [true, true]);
}
check("it names how many films", (await pop.locator("div").first().textContent()).trim(), "Add 3 films to…");
check("the existing playlist says how much of the selection it holds", (await pop.locator("li").first().textContent()).trim(), "Google Mapshas 1 of 3");
await shot("06-menu");
await pop.locator('input[aria-label="New playlist name"]').fill("Pip the Fox");
await pop.getByRole("button", { name: "Create" }).click();
await settle();
check("the menu closes", await pop.count(), 0);
check("the message counts what went in", (await msg())?.startsWith("Created “Pip the Fox” with 3 films in it."), true);
check("and offers to open it", await page.locator(".ptools .formmsg button").textContent(), "Open “Pip the Fox”");
check("chips are in name order with counts", (await chips()).map((x) => [x.name, x.n]), [["All films", "22"], ["Google Maps", "3"], ["Pip the Fox", "3"]]);
check("a film can be in two playlists", sql("select count(*) from hov.playlist_project pp join hov.project p on p.id = pp.project_id where p.name = 'How Google Maps was built'"), "2");
await page.locator(".ptools .formmsg button").click();
await settle();
check("Open goes there", (await chips()).find((x) => x.on)?.name, "Pip the Fox");
await shot("07-second-playlist");

// 6 — a selection that overlaps: "N added, M already there"
await bar.getByRole("button", { name: /All films/ }).click();
await settle();
await page.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
for (const t of ["How Google Maps was built", "Keyhole and the CIA's money"]) await tick(t);
await page.locator(".ptools").getByRole("button", { name: "＋ Add to playlist" }).click();
await pop.locator("li", { hasText: "Google Maps" }).locator("button").click();
await settle();
check("overlap is reported honestly", await msg(), "Added 1 film to “Google Maps” — 1 was already there.Open “Google Maps”");
await page.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
await tick("How Google Maps was built");
await page.locator(".ptools").getByRole("button", { name: "＋ Add to playlist" }).click();
check("a playlist that already has the whole selection is disabled", await pop.locator("li", { hasText: "Google Maps" }).locator("button").isDisabled(), true);
check("…and says why", (await pop.locator("li", { hasText: "Google Maps" }).textContent()).trim(), "Google Mapsalready in it");
await page.keyboard.press("Escape");
check("Escape closes the menu", await pop.count(), 0);
await page.locator(".ptools").getByRole("button", { name: "Cancel" }).click();

// 7 — duplicate names: caught on the page, and caught by the database
await bar.getByRole("button", { name: "＋ New playlist" }).click();
await bar.locator('input[aria-label="Name the playlist"]').fill("google maps");
await bar.locator('input[aria-label="Name the playlist"]').press("Enter");
await settle();
check("a case-only duplicate is refused on the page", (await bar.locator('[role="alert"]').textContent()).trim(), "There is already a playlist called “Google Maps” — pick it above.");
sql("insert into hov.playlist (name) values ('Race cars')"); // made elsewhere; this page has not seen it
await bar.locator('input[aria-label="Name the playlist"]').fill("RACE CARS");
await bar.locator('input[aria-label="Name the playlist"]').press("Enter");
await settle();
check("…and one the page could not know about is refused by the database", (await bar.locator('[role="alert"]').textContent()).trim(), "There is already a playlist called “RACE CARS”. Pick it from the list, or give this one another name.");
await bar.getByRole("button", { name: "Cancel" }).click();
sql("delete from hov.playlist where name = 'Race cars'");

// 8 — rename
await bar.getByRole("button", { name: /^Google Maps/ }).click();
await settle();
await bar.getByRole("button", { name: "Rename" }).click();
const renameInput = bar.locator('input[aria-label="Playlist name"]');
check("rename opens with the old name selected", await renameInput.evaluate((el) => [el.value, el.selectionStart, el.selectionEnd]), ["Google Maps", 0, 11]);
await renameInput.fill("Google Maps — the documentaries");
await renameInput.press("Enter");
await settle();
check("the chip carries the new name", (await chips()).find((x) => x.on)?.name, "Google Maps — the documentaries");
check("the message says both names", await msg(), "Renamed “Google Maps” to “Google Maps — the documentaries”.");
check("the database agrees", sql("select name from hov.playlist order by name limit 1"), "Google Maps — the documentaries");

// 9 — remove from the playlist, then Undo
await page.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
check("inside a playlist, Delete says it deletes FILMS", await page.locator(".ptools").getByRole("button", { name: "🗑 Delete films" }).count(), 1);
await tick("Keyhole and the CIA's money");
await shot("08-remove-offered");
await page.locator(".ptools").getByRole("button", { name: /Remove from/ }).click();
await settle();
check("the film leaves the playlist view", (await cardTitles()).includes("Keyhole and the CIA's money"), false);
check("…but not the library", sql("select count(*) from hov.project where name = 'Keyhole and the CIA''s money'"), "1");
check("the message says the films are untouched, and offers Undo", await msg(), "Took 1 film out of “Google Maps — the documentaries”. The films themselves are untouched.Undo");
await page.locator(".ptools .formmsg button", { hasText: "Undo" }).click();
await settle();
check("Undo puts it back", (await cardTitles()).includes("Keyhole and the CIA's money"), true);
check("…and says so", await msg(), "Put 1 film back in “Google Maps — the documentaries”.");
check("the toolbar itself IS in capitals (what the message must opt out of)", await page.locator(".ptools").evaluate((el) => getComputedStyle(el).textTransform), "uppercase");
check("…and the result line, which names the playlist, opts out", await page.locator(".ptools .formmsg").evaluate((el) => [getComputedStyle(el).textTransform, getComputedStyle(el).letterSpacing]), ["none", "normal"]);

// 10 — the toolbar's capitals do not reach a name
await page.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
await tick("Street View's first car");
const tt = await page.locator(".ptools button", { hasText: "Remove from" }).evaluate((b) => getComputedStyle(b).textTransform);
check("a button naming the playlist keeps its case (buttons reset it)", tt, "none");
await page.locator(".ptools").getByRole("button", { name: "Cancel" }).click();
await page.locator(".ptools").getByRole("button", { name: "☑ Select" }).click();
await tick("Street View's first car");
await page.locator(".ptools").getByRole("button", { name: "＋ Add to playlist" }).click();
check("the menu inside the capitalised toolbar shows names as typed", await pop.evaluate((el) => [getComputedStyle(el).textTransform, getComputedStyle(el).letterSpacing]), ["none", "normal"]);
await page.keyboard.press("Escape");

await page.locator(".ptools").getByRole("button", { name: "Cancel" }).click();

// 11 — delete the playlist: armed, then gone, films stay
const filmsBefore = sql("select count(*) from hov.project");
await bar.getByRole("button", { name: "Delete playlist" }).click();
check("the first click only arms, and says the films stay", (await bar.locator("button", { hasText: "Click again" }).textContent()).trim(), "Click again — delete the playlist (its 4 films stay)");
await shot("09-delete-armed");
await bar.locator("button", { hasText: "Click again" }).click();
await settle();
check("the playlist is gone", (await chips()).map((x) => x.name), ["All films", "Pip the Fox"]);
check("the message counts the films that stay", await msg(), "Deleted the playlist “Google Maps — the documentaries”. Its 4 films are still in the library.");
check("the view is the whole library again", new URL(page.url()).searchParams.get("playlist"), null);
check("no film was deleted", sql("select count(*) from hov.project"), filmsBefore);

// 12 — a link to a playlist that no longer exists
await page.goto(`${BASE}/projects?playlist=recAAAAAAAAAAAAAA`, { waitUntil: "networkidle" });
check("a dead link says so", (await bar.locator("span", { hasText: "no longer exists" }).textContent()).trim(), "That playlist no longer exists — showing all films.");
check("…and shows the whole library, not an empty page", (await cardTitles()).length, 15);

// 13 — an empty playlist offers to be filled
await bar.getByRole("button", { name: "＋ New playlist" }).click();
await bar.locator('input[aria-label="Name the playlist"]').fill("Next week");
await bar.locator('input[aria-label="Name the playlist"]').press("Enter");
await settle();
await page.locator(".ptools").getByRole("button", { name: "Cancel" }).click();
check("cancelling says where the empty playlist is", (await msg())?.startsWith("“Next week” is empty for now"), true);
await bar.getByRole("button", { name: /^Next week/ }).click();
await settle();
check("an empty playlist says it is empty", (await page.locator(".empty p").textContent()).trim(), "“Next week” has no films yet.");
await shot("10-empty-playlist");
await page.getByRole("button", { name: "＋ Add films to it" }).click();
await settle();
check("…and its button opens the library to fill it", [(await cardTitles()).length, (await page.locator(".ptools button.abtn.ok").textContent()).trim()], [15, "＋ Add to “Next week”"]);
await page.locator(".ptools").getByRole("button", { name: "Cancel" }).click();

await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
