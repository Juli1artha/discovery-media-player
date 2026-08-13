# The live demo

The smallest possible host: **one function, one dependency, no decisions.**

```
package.json     depends on the player
vercel.json      two rewrites, and the line that ships the folder with the function
api/doc.js       ~20 lines — sets the document folder, initialises, delegates
documents/       one sample PDF
```

No database, no secret, no wiring file. Everything that needs a decision — who may send a
document, what a client's brand is — belongs to tracked links, and there are none here.

## Deploying your own

Import this repository into Vercel with **Root Directory** set to `examples/demo`. Nothing else:
no environment variable is required.

⚠️ **`includeFiles` is not optional.** Serverless platforms ship the code, not the folder. Without
that line the PDF simply does not exist at runtime, and the page says there is nothing to display —
which is true, and unhelpful.

⚠️ **`PLAYER_LOCAL_ROOT` is computed in the code**, not set as an environment variable. The
platform decides where it runs the function; an absolute path written by hand is correct on one
platform and wrong on the next.
