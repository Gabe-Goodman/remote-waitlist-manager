# Remote Waitlist Manager

Diners at a fully booked restaurant join a virtual waitlist from their phone, see their place in the queue, and check in when their table is ready. The assignment is at the bottom of this file.

> Work in progress: the app is being built one pull request at a time. So far a diner can join the waitlist and see their place in the queue.

## Architecture

```
src/
├── domain/
│   └── waitlist.ts          rules only (pure functions): validating the join form, joining, no duplicate emails, parties ahead, service time, who is ready (strict order, seats held), seats available, where each party stands
├── services/
│   └── waitlistService.ts   use cases: load, apply a rule, save only if nobody saved in between, retry on conflict
├── storage/
│   ├── waitlistStore.ts     MongoDB only: the whole waitlist in one versioned document
│   └── testDb.ts            test helper: a fresh collection per test in its own database
├── routes/
│   └── waitlistRoutes.tsx   HTTP only: every URL (/, /card, POST /parties, /party/:token, /join-again, POST /check-in, POST /leave, /health), the party cookie, compression
├── views/
│   ├── waitlistPage.tsx     the one / page: the join form, or the party's card
│   ├── partyCard.tsx        the party's current state: name, size, parties ahead, its link to copy
│   ├── copyScript.ts        the card page's script for the Copy button
│   ├── updateScript.ts      the card page's live update: fetches /card every 2 s and swaps the card when it changes
│   ├── errorPage.tsx        the friendly page when something goes wrong
│   ├── layout.tsx           the HTML shell every page shares; carries TableKit's classless stylesheet inline
│   ├── pageStyles.ts        the page's own CSS: layout rules on top of TableKit
│   ├── messages.ts          every word a diner reads
│   └── html.ts              toHtml: a page as an HTML document
└── server.ts                wiring: settings, MongoDB connection, creating the waitlist, routes, graceful shutdown
e2e/
├── health.spec.ts           smoke test: the built app starts and serves /health
├── waitlist.spec.ts         diner journeys, JavaScript off
├── checkIn.spec.ts          JavaScript off: check in, the next party's turn after a service, joining again
├── copyLink.spec.ts         JavaScript on: the Copy button copies the party's link
└── liveCard.spec.ts         JavaScript on: a waiting party's card turns ready without a reload
```

## Run it

You need Docker.

```sh
docker compose up --build
```

Then open http://localhost:3000 to join the waitlist. From a phone on the same Wi-Fi, use your computer's IP address instead of `localhost`.

If port 27017 is already in use, run `MONGO_PORT=27018 docker compose up`.

## Develop

You need Node 22 (`nvm use` reads `.nvmrc`) and Docker.

```sh
npm install
npm run dev    # starts MongoDB in Docker, then the app on port 3000, reloading on changes
```

If you moved MongoDB with `MONGO_PORT`, point the app and the tests at that port too: `MONGO_URL=mongodb://127.0.0.1:27018/waitlist npm run dev` and `MONGO_TEST_URL=mongodb://127.0.0.1:27018/waitlist_test npm test`.

## Test

```sh
npm run typecheck
npm run lint
npm test                            # starts MongoDB in Docker, then runs Vitest
npx playwright install chromium     # once
npm run test:e2e                    # builds and starts the app in Docker, then runs Playwright
```

The e2e tests start their own copy of the app and stop if something already uses port 3000, so stop `npm run dev` or `docker compose` first. They run in a phone-sized browser with JavaScript turned off, except `copyLink.spec.ts` and `liveCard.spec.ts`, which need it for the Copy button and the live card.

---

The assignment this project was built for:

# Remote Waitlist Manager

Remote Waitlist Manager is a full-stack application designed to handle the waitlist of your restaurant. It manages seating, queueing, and notifications for your diners. **Multiple parties** should be able to join your restaurant's waitlist **concurrently**. Instead of waiting in line to write your name on a piece of paper, you can now join the waitlist virtually and get notified when your table is ready. This will increase your restaurant's efficiency and provide a better experience for your customers.

The user flow is as follows:

- A party of diners go to their favorite restaurant. It's fully booked, but the restaurant gives the option to join a virtual waitlist accessible via browser.
- When the diner opens the app they're asked to input their name and party size.
- After joining the waitlist, they can check the app to verify if it's their turn.
- When the table is ready for them, they check-in via the app and get seated.

## Technical Requirements

Whatever stack you choose, your entire app should be runnable via `docker compose up` locally.

### Frontend

You must use one of these patterns:

1. Isomorphic SSR
2. Pure SSR/no interactivity
3. Islands

SPAs are not allowed.

You must use one of these frameworks/libs/implementations:

- Pure vanilla js with _no_ dependencies.
- React v18+

### Backend

You must use one of:

1. Ruby on Rails
2. nodejs (any framework besides next/nest)
3. golang (any framework)

### Testing

End-to-end tests must be written with Playwright.

### Database

You must use mongo db.

## Business Requirements

**Restaurant Capacity**

Hardcoded to 10 seats.

**Service Time Calculation**

Hardcoded to 3 seconds per person. Example: A party of 4 takes 12 seconds to complete the service.

**Joining the waitlist**

The diner opens the app that shows a single form with these fields:

- Name
- Email
- Party size

Submitting the form should send the api request to join the waitlist.

**Checking in and starting the service**

When the queued party is ready to begin service, the app should display a "check in" button. When clicked:

- The party is removed from the waitlist queue.
- The number of seats available should be decreased by the party size.
- The service countdown starts for that party.

Importantly, the user _must_ be able to view the state of their queued party across multiple browser sessions.

**Queue management**

When a party completes service:

- The system checks the queue for the next party.
- If the seats available are enough for the next party size, the next party’s app shows a new “Check-in” button.
- If not, wait until enough seats are available.

**Duplicate joins**

A party must never appear on the waitlist twice.

**Concurrency**

If two parties try to join the waitlist at the same time the venue must not become overbooked, provide each party with the best possible experience.

## Clarification

No further questions will be answered about the spec or takehome. Use your best engineerig skills, judgement, business acumen and product skills to craft the best user experience possible.

## Submission Guidelines

1. Create a public GitHub repository for your project.
2. Include this README in your repository, with clear instructions for setting up and running the project locally.
3. Include a brief explanation of your architecture decisions in the README or a separate document.

## Evaluation Criteria

Your submission will be evaluated based these criteria in order of importance:

1. Customer Focus: Is the user experience intuitive? Would _you_ use this application if you were a diner? _Please_ play around with your app as if you were a customer prior to submission.
2. Functionality: Does the application work as specified?
3. Code Quality: Is the code well-structured, readable, and maintainable? Add sufficient comments in places where you think it would help other contributors to onboard more quickly to understand your code.
4. Architecture: Are there clear separations of concerns and good design patterns used?
5. QA: Are you confident in the quality of your product? If you had to refactor or add new features, would you be able to do so without breaking the existing functionality? There is no guideline on how many tests you should write, what type of tests you should write, what level of coverage you need to achieve, etc. We leave it to you to decide how to ensure a level of quality that results in your customers trusting your product.

### Good luck!
