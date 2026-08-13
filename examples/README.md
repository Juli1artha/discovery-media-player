# Examples

Each one is complete and copy-pasteable. Start with the one that matches where you already
deploy.

| | What it shows |
|---|---|
| [`vercel/`](vercel/) | The four files of a standalone instance on a serverless platform, including the wiring file — the only code you write. |
| [`express/`](express/) | Mounting the handler in an existing Node application, and the two host routes the player calls back into. |

Neither one is a fork of the player: they depend on it. That is the point — a fix upstream
reaches them on their next deploy.
