# Deployment

- **Code:** https://github.com/atharvajagtap112/site-visit-assistant
- **Live:** https://site-visit-assistant-tau.vercel.app/

## Demo logins

Password for all four: `demo-sitevisit-2026`

| Role | Email |
|---|---|
| Sales head | `head@companya.example` |
| Sales executive | `riya@companya.example` |
| Sales executive | `jay@companya.example` |
| Sales executive | `pooja@companya.example` |

Buyers do not log in. When a buyer gives a number, the six-digit code appears on screen, because this demo has no SMS provider. Five wrong passwords lock an account for 15 minutes, so use another login if that happens.

## Run locally

You need Node 24 (the version this was built and tested on) and Docker.

1. Start Postgres on port 5433.
   ```bash
   docker compose up -d
   ```
2. Copy the settings file and fill it in, using the table below.
   ```bash
   cp .env.example .env
   ```
3. Install, create the tables and load the demo data.
   ```bash
   npm install
   npm run db:migrate
   npm run db:seed
   ```
4. Start the app, then open http://localhost:3000.
   ```bash
   npm run dev
   ```

To run the tests, use `npm test`. They create and use a separate test database and never touch the demo data.

To run the forged-request checks, start a production build with `DEMO_SHOW_CODES=yes`, then run `npx tsx --env-file=.env scripts/forged-requests.ts`.

## Environment variables

| Name | Needed | What it is |
|---|---|---|
| `DATABASE_URL` | Yes | Postgres connection string |
| `TEST_DATABASE_URL` | For tests | Separate Postgres database for the tests |
| `GROQ_API_KEY` | For the AI | Free key from Groq. Without a working model the app still runs, and buyers get the fallback reply and booking button |
| `GEMINI_API_KEY` | Optional | Google key for the last model in the chain |
| `CHAT_MODELS` | Optional | Overrides the order of models |
| `DEMO_PASSWORD` | For seeding | Password given to all demo staff accounts |
| `DEMO_SHOW_CODES` | For the demo | `yes` shows buyer codes on screen. Anything else issues no codes, and buyers are told codes cannot be sent |
| `ALLOW_SEED_RESET` | Hosted seeding only | `yes` lets the seed wipe a database that is not local |
| `NEON_DATABASE_URL` | Optional | A place to keep the hosted address locally. The app does not read it |

## How it is deployed

| Part | Where | Notes |
|---|---|---|
| App | Vercel, free plan | Deploys when `main` is pushed. `vercel.json` runs it in Singapore (`sin1`), next to the database |
| Database | Neon, free plan | Postgres in AWS Singapore |
| AI | Groq free tier | About 8,000 tokens a minute per model, which is about 5 chat messages a minute |

### Deploy your own

1. Create a Neon project and copy its connection string.
2. Create the tables and load the demo data. Environment variables set in the shell take priority over `.env`.
   ```bash
   DATABASE_URL="<hosted address>" npx tsx --env-file=.env db/migrate.ts
   DATABASE_URL="<hosted address>" ALLOW_SEED_RESET=yes npx tsx --env-file=.env db/seed.ts
   ```
   The seed wipes every table in that database.
3. Import the repository into Vercel and set `DATABASE_URL`, `GROQ_API_KEY`, `GEMINI_API_KEY` and `DEMO_SHOW_CODES`. Set `DEMO_PASSWORD` too if you want it recorded alongside the rest; only the seed reads it.
4. Deploy. Run step 2 again after later schema changes, leaving out the seed line if you want to keep the data.

## Resetting the live demo

Bookings made during a review stay in the database. Run the seed line in step 2 to restore the demo data. Visit times are created relative to today, so reseeding also brings the dates forward.
