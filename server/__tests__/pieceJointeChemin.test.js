// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE PIÈCE JOINTE NE DÉSIGNE QUE SON PROPRE DOSSIER — À L'ÉCRITURE ET À LA SUPPRESSION.
//
// ⚠️ P1 DU HUITIÈME AUDIT, ET C'ÉTAIT MON DÉFAUT. `addMessage` n'acceptait l'URL de pièce jointe
// du client que sur un `startsWith("…/present-attachments/")` : un `../autre-bucket/secret.pdf`
// passait. La chaîne dormait, inerte, tant que cette URL n'était que LUE. La rétention lui a
// donné des dents : `storage.remove` la concaténait, `fetch` normalisait le `..` HORS du bucket.
// Un puits (la suppression) a réveillé un défaut d'entrée resté longtemps sans conséquence.
//
// La barrière est double, par principe : le chemin est validé À L'ÉCRITURE (il doit commencer par
// `${slug}/`, sans traversée ni forme encodée) ET REVALIDÉ à la suppression — une validation
// d'écriture n'est jamais la seule barrière d'un delete.

const presentations = require("../presentations.js");
const retention = require("../retention.js");

const BASE = "https://x.supabase.co";
const PREFIXE = `${BASE}/storage/v1/object/public/present-attachments/`;

function harnais() {
  const ecrits = [];
  const supprimes = [];
  const ctx = {
    db: {
      async request(chemin, o = {}) {
        if (chemin.includes("select=client_key&limit=0")) return [];
        if (chemin.startsWith("doc_presentations?active=eq.false")) return [{ slug: "s-a" }];
        if (chemin.startsWith("doc_presentations?")) return [{ slug: "s-a", active: true, control_hash: "h" }];
        // Le moteur lit id+attachment ENSEMBLE, paginé par curseur (id.asc). Une pièce jointe
        // LÉGITIME du slug, plus deux PIÉGÉES stockées par un attaquant. Après la 1re page, le
        // curseur `id=gt.m3` ne rend plus rien.
        if (o.method !== "POST" && o.method !== "DELETE" && chemin.startsWith("doc_presentation_messages?slug=eq.s-a") && chemin.includes("select=id,attachment")) {
          if (/id=gt\./.test(chemin)) return [];
          return [
            { id: "m1", attachment: `${PREFIXE}s-a/1-photo.png` },
            { id: "m2", attachment: `${PREFIXE}../autre-bucket/secret.pdf` },
            { id: "m3", attachment: `${PREFIXE}s-b/vol.png` },
          ];
        }
        if (o && o.method === "DELETE" && chemin.startsWith("doc_presentation_messages")) {
          return chemin.includes("select=") ? [{ id: "m1" }, { id: "m2" }, { id: "m3" }] : [];
        }
        if (o && o.method === "POST" && chemin.startsWith("doc_presentation_messages")) {
          ecrits.push(o.body[0]); return [{ id: ecrits.length, author_hash: "x", attachment: o.body[0].attachment }];
        }
        return [];
      },
    },
    storage: { async remove(bucket, ch) { supprimes.push({ bucket, ch }); return true; } },
    limits: { async allow() { return true; } },
    errors: { capture() {} },
    config: { supabaseUrl: BASE, retention: {} },
  };
  presentations.init(ctx);
  retention.init(ctx);
  require("../schema.js").init(ctx);
  return { ecrits, supprimes };
}

describe("le chemin d'une pièce jointe reste dans le dossier du slug", () => {
  const envoyer = (slug, url) => presentations.addMessage(slug, { body: "", authorToken: "t", attachment: { url, name: "f.png", type: "image/png", kind: "image" } });

  it("écriture : une URL de traversée `..` est refusée (pas stockée comme pièce jointe)", async () => {
    const { ecrits } = harnais();
    await envoyer("s-a", `${PREFIXE}../autre-bucket/secret.pdf`);
    expect(ecrits.length === 0 || ecrits[0].attachment === null, "un `..` ne doit jamais devenir une pièce jointe").toBe(true);
  });

  it("écriture : une URL désignant le dossier d'un AUTRE slug est refusée", async () => {
    const { ecrits } = harnais();
    await envoyer("s-a", `${PREFIXE}s-b/vol.png`);
    expect(ecrits.length === 0 || ecrits[0].attachment === null, "s-a ne peut pas référencer le fichier de s-b").toBe(true);
  });

  it("écriture : les formes ENCODÉES de la traversée sont refusées", async () => {
    const { ecrits } = harnais();
    for (const p of ["%2e%2e/x.png", "s-a%2f..%2fx.png", "s-a/..%5cx.png", "s-a/\0x.png"]) {
      ecrits.length = 0;
      await envoyer("s-a", PREFIXE + p);
      expect(ecrits.length === 0 || ecrits[0].attachment === null, `refus de ${p}`).toBe(true);
    }
  });

  it("écriture : un chemin LÉGITIME du slug courant est accepté", async () => {
    const { ecrits } = harnais();
    await envoyer("s-a", `${PREFIXE}s-a/1-photo.png`);
    expect(ecrits.length).toBe(1);
    expect(ecrits[0].attachment).not.toBeNull();
  });

  it("suppression : la purge n'efface QUE la pièce jointe légitime du slug, jamais la piégée", async () => {
    const { supprimes } = harnais();
    await retention.purgerRetention(Date.now());
    expect(supprimes.some((s) => s.ch.includes("..") || s.ch.includes("autre-bucket") || s.ch.startsWith("s-b/")), "aucune suppression hors du dossier du slug").toBe(false);
    for (const s of supprimes) expect(s.bucket).toBe("present-attachments");
    // ⚠️ Et EXACTEMENT la légitime (neuvième audit) : « aucune suppression du tout » passerait
    // aussi le test ci-dessus, ce qui masquerait une purge de fichiers cassée.
    expect(supprimes, "la pièce légitime du slug DOIT être supprimée, une seule").toEqual([{ bucket: "present-attachments", ch: "s-a/1-photo.png" }]);
  });
});
