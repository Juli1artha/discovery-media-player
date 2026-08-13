# A standalone instance on Vercel

Four files. Only one of them contains decisions, and they are all yours.

```
package.json      depends on the player
api/doc.js        one line
player-context.js the wiring — your storage, your rules, your brand
vercel.json       the two URLs that must never change
```

## Deploy

```bash
npm install
npx vercel --prod
```

Environment variables to set (Vercel dashboard, or `vercel env add`):

| Variable | |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | database + storage |
| `PLAYER_BRAND_NAME`, `PLAYER_LOADER_NAME` | what a reader sees |
| `PLAYER_SOURCE_URL` | AGPL: where readers obtain the source |
| `PLAYER_HOST_AUTHZ_URL` + `PLAYER_HOST_FETCH_SECRET` | who may send documents (see the wiring) |

Then run `supabase/init.sql` on a fresh database.

## The URLs

`/doc/:slug` and `/present/:slug` live in emails sent to other people. Once an instance is in
use they never change — a broken tracked link is a commercial relationship landing on an error
page. `vercel.json` is the only place they are declared.
