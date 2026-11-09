# Decisions

## Running and testing
- Tests run against a real MongoDB, not mocks or fakes. The bugs that matter in this app sit where the rules, the save-only-if-unchanged check and the database meet, and a fake can drift from how MongoDB actually behaves. Each test gets its own fresh collection, so tests don't affect each other.
- End-to-end tests run on a phone-sized screen with JavaScript turned off, except the Copy button's and the live card's, which need it. Diners use phones, and every page is plain server-rendered HTML with ordinary forms, so the journeys passing with JavaScript disabled show the app works without any client-side code: it's server-rendered, not a single-page app.
- A smoke test checks that the built Docker image starts and answers /health. Route tests call the routes in-process: they never build the image, run server.ts or connect to MongoDB over the network. Only an end-to-end run shows that `docker compose up` actually produces a working app.

## MongoDB 9.0.4
- MongoDB 8.0 can't start on Ubuntu 26.04 kernels, including GitHub's current CI runners; the fix (SERVER-131779) is only in an unreleased 8.0 patch. 9.0.4 includes it.
- Pinned exactly rather than 9.0, because patch releases have regressed on this check before (SERVER-136848), and the version tested is the version that runs.

## Docker
- Two-stage image: the first stage installs all dependencies and compiles the TypeScript, so a type error fails the build. The final image contains only the compiled JavaScript and production dependencies: no compiler, dev tools or source. It runs as the non-root `node` user, which limits what a compromised process could do.
- MongoDB is published on 127.0.0.1 only. The development database has no password, so publishing it on every network interface would let anyone on the same network connect. The app container doesn't need the published port at all; it reaches MongoDB through Compose's internal network. MONGO_PORT moves the published port if 27017 is already taken.

## Joining rules
- All field errors come back at once, one code per field: the rules decide what's wrong, the views decide the wording, and each error shows next to its field.
- Emails are trimmed and lowercased before comparing, so the same address typed differently is a duplicate. No provider-specific rules (Gmail dots, +tags): merging addresses that actually differ could turn a diner away.
- The email check is deliberately loose (x@y.z): only a sent email proves an address works, and the app sends none.
- Limits: name 50 (fits on a phone), email 254 (SMTP's maximum), party size 1–10 as digits only (`Number()` alone reads "1e1" as 10).
- Validation runs before the duplicate check, so a diner fixes the form first.
- The rules are pure functions with the time and token passed in, returning a new waitlist rather than changing the one they're given.

## Saving joins safely
- Optimistic concurrency on one versioned document: a save lands only if the version hasn't changed since the load. MongoDB writes one document atomically, so two saves from the same load become one save and one conflict, never a lost update.
- On a conflict: read the waitlist again, rerun the rules, try again; up to 10 tries with a random 0–25 ms pause so collided requests don't retry in lockstep; then "busy", the honest answer when it runs out.
- Only conflicts are retried, never exceptions: a database error isn't "someone saved first".
- Each retry reruns the rules on fresh data, which keeps the duplicate check correct under concurrency.
- What's atomic, and what the version adds: every write is a read-modify-write (load the waitlist, apply a rule, write it back), and the danger is the gap between the read and the write, when another diner can save. MongoDB makes each single-document write atomic, but that only covers the write itself. The version covers the gap: `replaceOne({ _id: "main", version }, …)` replaces only if the version is still the one I read, and sets it to version + 1, in one atomic step. Two saves at the same moment become one that wins and one that fails; the request that lost reads the waitlist again, reruns the rule on the fresh queue and saves too, so both land. The diner never sees it.
- Why a version number and not a timestamp: a counter changes on every save by construction. A timestamp can repeat (two saves in the same millisecond, or a clock correction), and a repeat is exactly a lost update. It wouldn't save any work either: it's the same field, the same filter and the same two calls (one read, one conditional write). A timestamp could be stored alongside to show when the waitlist last changed: the counter decides, the timestamp informs.
- In Postgres the same pattern is `UPDATE … WHERE id = 'main' AND version = $n`, checking that one row changed (Rails's `lock_version`). The pessimistic alternative is locking the restaurant's row with `SELECT … FOR UPDATE` in a transaction, like a mutex: others wait instead of retrying. Under heavy contention a lock that queues writers does better than retries; for a restaurant's few writes a minute, optimistic is simpler and never blocks.
- The waitlist is created at startup with `$setOnInsert`, so a restart never resets it. No upsert on the save: it would turn a stale save into inserting a second waitlist.
- Tests use a real MongoDB in their own database, one randomly named collection per test, so they can't touch real data. Cost: Docker is needed to run them.
- Evidence: 20 simultaneous joins all saved; two simultaneous joins with the same email produce one party; each guarantee fails visibly when its line is broken.

## One versioned document

### The decision
- The whole waitlist is one MongoDB document, `{ _id: "main", version, parties }`, with the queue in array order. Every write loads it, runs a pure rule, and saves with `replaceOne({ _id: "main", version }, …)`: if someone else saved first, nothing is written, and the rule runs again on the fresh queue.
- Why: every rule that matters depends on the whole queue at once. No duplicate emails among active parties, no overbooking, strict order, and "only a ready party can check in" are all facts about the queue as a whole, not about one party. MongoDB writes one document atomically, so one version check enforces all of them, with no transactions, no extra indexes and no replica set.
- Tested: 20 simultaneous joins all saved, none lost; two joins with the same email let exactly one in; a check-in racing a leave ends in one consistent state.

### The trade-offs
- **Size.** MongoDB caps a document at 16 MB. A party is about 190 bytes as stored (measured), at most about 475 bytes (a 50-character name, a 254-character email, every timestamp). So one document holds about 88,000 typical parties, or 35,000 worst-case ones. A document that kept every party would hit the limit within months (about 290 days at 300 parties a day, 115 in the worst case), so finished parties are forgotten after a day (see "Forgetting finished parties" below). The document then holds at most a day of parties: tens of KB, far from the limit.
- **Read size, which matters first.** Every request reads the whole document, and the live card asks for it every 2 seconds per open phone. One evening is about 60 KB, which is fine; a few months of history would be megabytes per poll (about 40 MB/s out of MongoDB with 50 phones open after a month), long before the 16 MB limit. This is what made pruning necessary rather than optional: it breaks in weeks of real use, though a fresh demo database never shows it.
- **Write contention.** Every write competes for the one document. A restaurant sees a few joins and check-ins a minute, and the retry loop absorbs bursts (up to 10 attempts, then "busy"). That's comfortable for one restaurant, but it's not a design for thousands of writes a second on one queue.
- **Many restaurants** don't contend with each other: one document per restaurant, sharded by restaurant.

### Forgetting finished parties
- Every save goes through one function in the service that drops parties whose service ended, or that left, at least 24 hours ago (`pruneFinished`, a pure rule in the domain), inside the same versioned write. There's no background job: only writes add parties, so pruning on writes is enough to keep the document the size of one day.
- Such a party is outside every rule: it isn't in the queue, holds no seats and blocks no email or join key. So forgetting it changes nobody's place or state (a unit test checks this), and the version check and the other rules didn't change.
- A day, not a few minutes: tonight's party links and "Join the waitlist again" keep working. After that, an old link goes to the home page (the join form, or the browser's current party), a card left open stops updating, and "Join the waitlist again" opens an empty form.
- Deleted, not moved to a history collection: nothing in the app reads history, and keeping it would mean two writes per prune and a crash case to handle. If the restaurant wants reporting, that's when to add a `parties_history` collection (insert the copy first, then remove it through the version check, so a crash leaves at worst a duplicate history record, never a lost party).

### What I'd do in production
With pruning, the document stays the size of one day, so the remaining limits are write contention and features that need parties as separate records. Two larger options:

1. **One document per entry, plus a small versioned queue document.** Each party's details (name, email, timestamps) live in their own document in a `parties` collection, which keeps history queryable and lets staff features add fields without growing the queue. A small per-restaurant queue document holds only what the rules need (token, size, order, checked-in time, active emails or their hashes) and keeps the version check, so it stays the single place where capacity, order and duplicates are decided. The price is two writes per change without a transaction: the queue document is the source of truth, and an entry document is written first, so a failure leaves an orphan entry that no queue points to, rather than a queue pointing to nothing. I'd choose this when entries need to be read or updated on their own (notifications, staff notes, reporting).
2. **One document per entry, with multi-document transactions.** Each party is a document; a transaction reads the restaurant's active entries, runs the rule, writes the entry and bumps a per-restaurant counter document so concurrent transactions conflict and retry. Duplicates also need a partial unique index on email over active parties, which means storing an `active` flag that is really a cache of time-derived state (a party's meal ends, and it's done, with no write at all), refreshed on every write. Order needs a sequence counter. Transactions need a replica set. This is the most flexible, but the safety of every rule then depends on every write path using the transaction correctly, and the time-derived state no longer comes for free. I'd only choose it if the restaurant's write rate or the model's complexity outgrew the first option.

The domain rules are pure functions of (queue, now), so any of these is a change to the store and the service, not to the rules or their tests.

The next step for read cost, before either of these: cache the waitlist in memory. The app runs as one server and is the only writer, so it can keep the last loaded document and replace it after every successful save; polls and page loads then read memory instead of MongoDB. The card is still worked out from (document, now) on every request, because time changes it with no write (a meal ends and frees seats), so a rendered card can't be cached by version. Writes still load from MongoDB and save with the version check, so safety never depends on the cache. With more than one server, each would miss the others' saves: the cache would then need a short time-to-live, or invalidation through change streams (which need a replica set).

### Why not shortcuts
- `$push` with a `{ "parties.email": { $ne: email } }` filter stops a duplicate email, but not overbooking or out-of-order seating, and each new rule would need its own filter.
- A unique index on `parties.email` doesn't help: MongoDB's unique indexes apply across documents, not within one document's array.

## Join page
- Each party has its own page, `/party/<token>`, so the address bar is the link to share; `/` is the join form, or sends a browser with a party to its page. The cookie only remembers which party this browser joined as. Earlier, every state lived at `/` behind the cookie: the address bar shared nothing, and it felt like an SPA.
- The cookie is HttpOnly (page scripts can't read it), SameSite=Lax (other sites can't post with it), Secure over HTTPS, and lasts 6 hours, longer than any wait.
- Post/Redirect/Get: a successful join answers 303 to the party's page, so a reload or the back button never submits the form twice.
- The form is plain HTML that works without JavaScript. `noValidate` on the form, so every error comes from the server, worded the same in every browser; `required` stays on the fields so screen readers announce them. Party size starts on a disabled "Choose…", so skipping it gives an error instead of joining as 1.
- One notice box at the top (`role="alert"`), field errors next to their fields with `aria-invalid` and `aria-describedby`.
- The waiting count above the form is a count only, never names: who else is waiting is nobody's business.

## When something goes wrong
- Any error a route throws ends on one friendly page ("Something went wrong", "Try again"); the details go to the server log, never to the diner.
- "Try again" goes back to where the diner was. A page loads again, so a friend who opened a party's link gets the party back instead of the join form. Check in or Leave goes to that party's page, which shows whether it went through, rather than acting twice. A failed join goes to the empty form: keeping what was typed would mean a special case for a rare outage, and "busy", the failure seen under load, already keeps it.
- An HTTP error that already carries the right answer (the 10 KB body limit's 413) passes through unchanged.
- Every POST is limited to 10 KB. The largest valid join form is about 700 bytes.
- "Busy" (the retries ran out) keeps what the diner typed and asks them to tap Join again.
- MongoDB server selection times out after 5 seconds instead of 30, so a database outage shows the error page quickly.

## TableKit
- TableCheck's own classless stylesheet (4.3.1, pinned), no React components and no web fonts, so no JavaScript reaches the browser for styling.
- Inlined into every page instead of linked. On DevTools' Slow 4G with the cache off, first paint was 685 ms without TableKit, 1,340 ms linked (a second request the browser waits for) and about 730 ms inlined. Diners open the page from a QR code, usually for the first time, so a cached stylesheet rarely helps.
- Every response is gzipped (a page is 122–132 KB, 18–21 KB gzipped, with the card page's island scripts); that's what makes inlining cheap.
- "Views only render" still holds: the stylesheet is read once at startup, so to the page it's a constant.
- Our own CSS is a handful of layout rules on TableKit's tokens, so dark mode follows the phone.

## Islands
- Two islands, `<live-card src="…">` and `<copy-link>`, each a custom element with one dependency-free script in `browser/`. It's the same shape as Astro's `<astro-island>`: a wrapper around its part of the page, settings as attributes, and its own setup and cleanup (`connectedCallback` and `disconnectedCallback`, like a React effect and its cleanup).
- Self-contained: each finds everything it uses inside itself and reads its settings from its own element. The live card fetches the URL in its `src` and swaps only the card inside it; the Copy button finds its field, button and status inside `<copy-link>`, with no ids. The browser sets up every island as it's added to the page, so a card the live update swaps in brings a working Copy button with it (an e2e test checks this).
- First built as two page-level scripts: they found their elements by global ids, the live card worked its URL out from the page's address, and Copy put one click listener on the whole document and a `js` class on `<html>` for the stylesheet. That worked for one card per page, but each script depended on the page around it.
- Defined in the `<head>`, so each island is set up as the browser reaches it and nothing on screen shifts. The stylesheet shows the Copy button only under `copy-link:defined`, so without JavaScript there's no icon and no empty gap.
- An island brings its own script: rendering its element is all it takes. `toHtml` looks for each island's tag in the rendered body and puts that island's script in the `<head>`, so no page lists the scripts it needs and none can forget one. Only the body is looked at, since the inlined stylesheet mentions the islands in its comments; a diner's text can't pass for an element because React escapes its `<`. Together the scripts are 8.1 KB (3 KB gzipped), most of it comments; a finished party's page has no link to copy and gets only the live card's.
- A card the live update swaps in never needs an island its page didn't load: cards only lose the Copy link as a visit ends (done, left), and the live card stops once it reaches those.
- The live card compares each card it fetches with the last card the server sent, not with the card in the page. The page changes without the party changing: the diner opens Leave (its `<details>` gets `open`), Copy marks its island, a browser extension marks the link's field. Compared with the page, those cards never matched, so the card was swapped every 2 seconds, and a ready card rang the bell each time.
- No React in the browser: hydrating React islands would need React in the page, a bundler, and a second renderer for the card. The live card swaps in HTML the server rendered, so there's one renderer.

## The card's heading
- In TableKit's h2 size (24px) with the h1's weight, not the page title's 36px. At 36px some states' headings wrapped onto two lines and others didn't, depending on the phone, so when the live update swapped a waiting card for a ready one the panel jumped 48px on most phones and not at all on others. At 24px the headings the live update swaps in place (waiting, ready, checked in, meal over) fit one line on a 360px phone, and the panel stays put; an e2e test checks each one. "You've left the waitlist" isn't checked: the diner reaches it by tapping Leave, on a new page, so a wrap moves nothing (only a friend leaving from another phone swaps it in live, once the visit is over). TableKit loads no font file, so each device uses the first of its fonts it has and a heading's width varies by machine: "Thanks for dining with us" was shortened to "Thanks for dining" after it wrapped in CI's Linux font. It also matches the intent that where you stand comes first: at 36px the heading outshouted the panel. Still an `<h1>` for screen readers and the page outline; "Join the waitlist", a page title, keeps the h1 size.
- No full stops in headings, which are also the tab titles: "You're checked in", not "You're checked in.". The one exclamation mark, "Your table is ready!", is the news. Sentences in the panel ("See your host.") keep theirs.

## The card's words
- The panel line under the heading says what to do or expect next, and it's read at a glance, so it's short: one line on most phones.
- A ready party is told "See your host.", with the Check-in button right below. Checking in starts the table's clock (the party's seats are counted from the tap and freed when the service time runs out), so a diner who tapped from the car park would free the table while still walking in. Sending them to the host stand first also puts the party's name and size, under the line, in front of the host who confirms them.
- Checked in: "Enjoy your meal." By then they're with the host and being seated.
- At the front of the line: "You're next. Stay close." The join page already says to keep the page open, and the card refreshes as soon as the phone is unlocked.

## Icons
- Carbon (IBM, Apache-2.0), the set TableKit's React components use, so the icons match the stylesheet. TableCheck's own `tablecheck-icons` was last released in 2021 and is a Font Awesome 5-style icon font, so it wasn't considered.
- The SVG paths are copied into `src/views/icons.tsx` with the licence notice, not installed: the icons are rendered on the server either way, so the package would add a dependency and no saving. Same bytes, no extra request, no script.
- Always beside words that say the same thing, never instead of them, and hidden from screen readers (`aria-hidden`), so headings, labels and the tab title read exactly as before.
- An icon only while something is happening: waiting (hourglass), ready (bell) and checked in (knife and fork). Those are the states a diner glances at again and again, and the icon says where they stand before they read. It sits at the right edge of the panel that says where the party stands, beside the words it repeats. First tried beside the heading: it squeezed every heading onto two lines on a phone and sat apart from those words.
- No icon once the visit is over (done, left): the heading is read once, and an icon adds nothing. The first try used Carbon's sign-out icon for "left", and at the right edge of a panel its arrow looked like something to tap; a check mark there can look like a ticked option.
- No icons on the join form. The form already works without reading English: the phone fills in the name and email, the email field brings up a keyboard with @, and the party size is a list of numbers. Icons on all three labels were tried and mostly repeated that; and a person icon on Name means "number of adults" on TableCheck's own booking form, which puts icons on its booking choices (date, time, guests) and none on contact details. An icon on Party size alone would make one of three labels look out of place.
- Not on buttons: the Check-in button is the page's one filled element and needs nothing next to it.
- Sized in CSS in `em`, relative to the text beside them, with `width` and `height` on the SVG only as a fallback if the stylesheet doesn't load: the state icon is 2.5em (40px beside 16px text, an even 1.25 times Carbon's 32px grid, so it stays crisp). TableKit sets its text in `px`, so for now the icons don't scale with the browser's font setting any more than the text does; in `em` they keep their proportion if TableKit's sizes ever change. Overriding TableKit's text sizes with `rem` was considered and left alone: TableKit also sizes fields, padding and line heights in `px`, so text alone would outgrow its controls. That belongs upstream, all at once.
- `fill="currentColor"`, so they follow light and dark mode. The Copy button's icons moved to Carbon too, so the page has one icon style.
- One animation: the bell rings once (1 s) when the ready card appears, on load or when the live update swaps it in, the same moment the phone vibrates and the tab title changes. The hourglass stays still: minutes of motion would read as "loading" and pull the eye for nothing. Nothing moves for a phone set to reduce motion.

## Finding your party again
- The party's link (`/party/<token>`, 128 random bits) is the key to the party. Opening it in another browser shows the party there, and nothing more: only joining makes a party a browser's own, the one `/` leads to. Sharing it shares control: anyone with it can check in or leave for the party, and the card's hint under the link says so. There's no read-only link, because the server can't tell the diner's other phone from a friend's.
- A friend's link shows the friend's card, and its buttons act on that party: actions use the party in the URL, not the cookie, so nobody can act on the wrong party. The token in the address bar is the trade-off (history, screenshots); in production I'd email the link.
- One active party per browser: a stale join form (back button, old tab) goes back to the party's page instead of changing details or adding a second place. Another group joins from another phone.
- Opening a link used to make the party the browser's own when it had none, so the diner's other phone found it again at `/`. But then a friend's phone that opened the link before joining was sent back to the friend's card by every way to the join form, and couldn't join for its own group. Fixing that while keeping the adoption took a second cookie (how the browser got the party), a way out ("Not with this party? Join on your own") and a rule for the rejoin form that knew both. Not adopting at all needs none of that: the other phone keeps the link (open tab, history, bookmark), which is how a link works anyway.
- Pages are sent `Cache-Control: no-store`, so the back button asks the server for the current state. POST answers (a refused join) stay cacheable, so going back doesn't trigger "Confirm Form Resubmission".
- The card shows the full link ready to copy. The Copy button (the `<copy-link>` island) is hidden without JavaScript, and it falls back to the older copy method on a phone reaching the app over plain HTTP. The phone's Share sheet needs HTTPS, so it's future work.
- `/party/<token>` is singular because it reads as "this party" in a shared message.
- A party's size can't be changed after joining. The seat count trusts the size given at joining; a group that grows should tell the host. Letting a party shrink in the app is safe future work; letting it grow needs the host.

## Who is ready
- Facts are stored (`joinedAt`, `checkedInAt`); everything else is worked out from them and the current time. Nothing stores a status, and no timer ends a service: time alone frees seats.
- The ready rule: walk the queue in order. Every party at the front that fits in the free seats is ready and holds its seats, so it can always check in. At the first party that doesn't fit, everyone behind it waits, even a smaller party that would fit: first come, first served. The price is idle seats behind a large party, which is what the spec asks for.
- A snapshot read a moment ago can't overbook: without writes, time only frees seats, so it can only under-count them. Every write goes through the version check.
- Evidence (break-it checks): loosening the fits check, or letting a party behind one that doesn't fit become ready, each make a named test fail.

## Checking in
- Check-in re-checks "ready right now?" inside the versioned write, so a check-in decided on an old page is checked against the latest waitlist. Two phones tapping Check in at once check the party in once.
- `POST /party/<token>/check-in` always redirects to that party's page, whether it worked or not ("already checked in" from the party's other phone, or an unknown party): the card shows the real state in plain words, so no separate error notice.
- A finished party no longer holds its email, its browser or a place, so the same diner can come back.
- No countdown while seated: a diner doesn't need one, and "service time" is the restaurant's estimate, not a timer for the guest.
- End-to-end runs use an empty database of their own, because ready parties hold their seats and leftovers from earlier runs changed who was ready.

## Joining again
- The finished card has a quiet text link, not a button, so nobody rejoins the same evening by accident.
- `/?rejoin=<token>`: the home page's join form, filled in with the party's name and email (size asked again), only for the browser that joined as the party (its cookie names it). Any other browser with the link gets the form empty: a friend's phone would otherwise join as the friend, a friend with a party of their own would see a form that only sends them back to it, and a private window would show the party's email to anyone holding the link. The price: a diner whose browser lost the cookie (another browser, or after its 6 hours) types their name and email again. It's a query option on `/`, not a page of its own, so one handler renders the join form; it changes nothing until the diner joins, so a reload or a link preview is harmless.

## Double taps
- The join form carries a hidden key, new for each fresh form and kept when the form comes back with errors. A submission whose key matches an active party returns that party (same cookie, same card) instead of the duplicate-email notice.
- Why it matters: a double tap's second submission leaves before the first answer sets the cookie, and the browser usually abandons the first page. Without the key, the diner could end up with a party they can't reach and an email they can't rejoin with.
- Checked before validation (the same submission already succeeded), only against active parties (an old form can't bring back a finished party), and a repeat saves nothing.
- Why not match on name, email and size instead: anyone who knew them could take over the party. The key is an unguessable token only that form has.
- No end-to-end test: with JavaScript off, a real double tap is timing-dependent in the browser; the route and service tests send the two submissions exactly.
- Future polish: a small script that disables Join after the first tap, so the second tap visibly does nothing. HTML and CSS can't do it without JavaScript, and the key is still needed for no-JavaScript, retries and resent forms, so it's only a nicety.

## No-shows
- A ready party keeps its table until it checks in or leaves. The spec doesn't ask for a time limit, and I first built one: a minute to check in, with "ready since" worked out by replaying the stored facts, since nothing runs at the moment a table frees up. It was the most intricate code in the app and hid a bug that only real history exposed (a later check-in brought expired parties back), so I removed it.
- The cost: a diner who walks off holds the line until they tap Leave.
- Next: a host view to clear no-shows, or storing "ready since" when a request first sees the party ready, which keeps a time limit without any replay.

## Known limits
- A locked phone or a backgrounded browser stops the page's scripts, so a diner isn't alerted when their table is ready; they see it the moment they look again (the card refreshes as soon as the page is visible). Email or Web Push would fix that; Web Push needs HTTPS, and on iPhone only works for apps added to the home screen.
