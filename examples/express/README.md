# Mounting the player in an existing Node application

Two things happen here, and they go in opposite directions:

1. **You mount the player** — it is a plain `(req, res)` handler, so `app.all()` is enough.
2. **The player calls you back** — over HTTP, with a shared secret, for the two decisions it
   cannot make: who may send a document, and what a client's brand is.

That second direction is what keeps a separate instance possible. The player runs on its own
domain, with its own database; it never imports your code and never holds your credentials.

```bash
npm install && node server.js
# → http://localhost:4000/documents/<a-file>.pdf
```

## Serving files the player cannot reach

If your documents live behind an API key (a DMS, a file server, an S3 bucket with credentials),
the player must **never** hold that key. You expose one route, you fetch the file yourself, and
the player is allowed to call only that route — `PLAYER_HOST_FETCH_BASE`.

Three requirements on that route, in order of how much they cost when missed:

1. **Never relay the upstream `Content-Length`.** `fetch()` decompresses the body for you and
   keeps the upstream headers. Relaying the announced size serves a **truncated PDF** — no error
   anywhere. Announce the length of the bytes you send. Request `Accept-Encoding: identity`, and
   refuse a compressed `206` (range bounds refer to compressed bytes).
2. **Relay `Range` requests** (`206` + `Accept-Ranges: bytes`). This is where progressive loading
   comes from. Without it a heavy document stays blank for seconds.
3. **Accept a server-to-server call.** A tracked link is opened by a prospect with no session on
   your side: the player fetches the file, not the browser. Recognise it by the shared secret in
   the `x-player-fetch-secret` header — header only, never a query string.

`server.js` implements all three.
