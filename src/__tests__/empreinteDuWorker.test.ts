// LE SEUL SCRIPT TIERS QU'UN ATTRIBUT `integrity` NE PEUT PAS COUVRIR.
//
// Le worker de pdf.js n'entre pas par une balise : c'est la bibliothèque qui le charge. Il pèse
// pourtant trois fois le script principal (1 Mo contre 300 ko) et voit tout le contenu du document.
// Poser une empreinte sur la balise et laisser passer le worker, ce serait verrouiller la porte en
// laissant la fenêtre.
//
// Ce qui rend le contrôle possible : ses octets passaient DÉJÀ par notre code — un worker d'une
// autre origine étant refusé par le navigateur, on le récupère en texte pour en faire un blob de
// même origine. Ce détour existait pour contourner une règle ; il sert maintenant à en appliquer une.
//
// ⚠️ CE QUI EST VÉRIFIÉ ICI EST SURTOUT LE REFUS. Une fonction qui accepte les bons octets et ne
// dit jamais non ne protège de rien — et « ne dit jamais non » est exactement ce qu'on obtient en
// écrivant la comparaison à l'envers, ou en rattrapant une exception un cran trop large.

import { describe, it, expect } from "vitest";
import { workerBlobUrl } from "../viewer";

const CORPS = "self.onmessage=function(){};";

function reponse(corps: string, ok = true) {
  return {
    ok,
    arrayBuffer: async () => {
      const octets = new TextEncoder().encode(corps);
      return octets.buffer.slice(octets.byteOffset, octets.byteOffset + octets.byteLength) as ArrayBuffer;
    },
  };
}

// ⚠️ Les API WEB, pas celles de Node : ce dossier est compilé pour le navigateur, et un
// `node:crypto` ici ne passerait pas la vérification de types — la même contrainte que le code
// qu'il éprouve, ce qui est exactement ce qu'on veut d'un banc.
async function empreinteDe(corps: string): Promise<string> {
  const condense = await crypto.subtle.digest("SHA-384", new TextEncoder().encode(corps));
  let binaire = "";
  for (const octet of new Uint8Array(condense)) binaire += String.fromCharCode(octet);
  return "sha384-" + btoa(binaire);
}

// Les dépendances injectées : le vrai calcul d'empreinte du moteur, une récupération
// contrôlée, et une fabrique d'URL qui note ce qu'on lui a donné.
function deps(corps: string, ok = true) {
  const vues: Blob[] = [];
  return {
    vues,
    options: {
      fetch: async () => reponse(corps, ok),
      subtle: crypto.subtle as unknown as { digest(a: string, d: ArrayBuffer): Promise<ArrayBuffer> },
      creerUrl: (blob: Blob) => { vues.push(blob); return "blob:essai"; },
    },
  };
}

describe("le worker n'est adopté que si ses octets sont ceux qu'on attend", () => {
  it("des octets conformes donnent une URL de blob", async () => {
    const d = deps(CORPS);
    expect(await workerBlobUrl("https://cdn/worker.js", await empreinteDe(CORPS), d.options)).toBe("blob:essai");
    expect(d.vues).toHaveLength(1);
  });

  // ⚠️ UN SEUL OCTET. C'est tout ce qui sépare la bibliothèque légitime d'une version qui lit le
  // document au passage — et c'est exactement ce qu'une version épinglée ne dit pas : elle nomme
  // le fichier demandé, jamais celui qu'on reçoit.
  it("un seul octet changé fait refuser", async () => {
    const d = deps(CORPS + " ");
    expect(await workerBlobUrl("https://cdn/worker.js", await empreinteDe(CORPS), d.options)).toBeNull();
    expect(d.vues).toHaveLength(0);
  });

  it("refuse aussi ce qu'on ne peut pas vérifier", async () => {
    const attendue = await empreinteDe(CORPS);
    // Contexte non sécurisé : `crypto.subtle` n'existe pas. On refuse — non par sévérité, mais
    // parce qu'une page servie en clair est modifiable en entier avant d'arriver, empreinte
    // comprise : il n'y aurait rien à protéger.
    expect(await workerBlobUrl("https://cdn/worker.js", attendue, { ...deps(CORPS).options, subtle: null })).toBeNull();
    // Pas d'empreinte attendue : on ne compare rien, donc on n'adopte rien.
    expect(await workerBlobUrl("https://cdn/worker.js", "", deps(CORPS).options)).toBeNull();
    // Le CDN répond une erreur.
    expect(await workerBlobUrl("https://cdn/worker.js", attendue, deps(CORPS, false).options)).toBeNull();
    // Le réseau lève.
    expect(await workerBlobUrl("https://cdn/worker.js", attendue, {
      ...deps(CORPS).options,
      fetch: async () => { throw new Error("réseau"); },
    })).toBeNull();
  });

  // Le refus ne casse rien : l'appelant retombe sur l'URL distante, que le navigateur bloque à son
  // tour, et pdf.js finit par son worker de secours sur le fil principal. Plus lent, jamais
  // muet-mais-faux — et c'est déjà le chemin qu'empruntait un réseau en panne, donc un mode de
  // défaillance déjà éprouvé plutôt qu'un nouveau.
  it("le refus est une valeur, pas une exception", async () => {
    await expect(workerBlobUrl("https://cdn/worker.js", "sha384-faux", deps(CORPS).options)).resolves.toBeNull();
  });
});
