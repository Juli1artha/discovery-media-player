// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PIED LÉGAL SE REPLIE EN PASTILLE — et ne perd rien en se repliant.
//
// Demandé par un hôte le 06/10/2026 en regardant un document ouvert par son client : la barre
// noire sur toute la largeur, en bas de chaque page, recouvrait le document pour dire trois
// choses que le lecteur n'a besoin de lire qu'une fois. Elle devient une pastille dans un coin,
// « Lecture mesurée », qui se déplie au clic sur la phrase complète et les liens.
//
// ⚠️ DEUX CHOSES NE PEUVENT PAS PARTIR AVEC LA BARRE, et c'est ce que ce banc garde :
//   · la mention de mesure — une information due au lecteur au moment où l'on mesure (RGPD) :
//     son résumé reste VISIBLE replié, la phrase exacte est dans la page, à un geste ;
//   · le lien vers le code source — l'AGPL le doit à qui UTILISE le logiciel par le réseau.
// Le repli change la PRÉSENTATION, jamais le contenu : tout ce que la barre disait est encore
// dans le HTML servi.
//
// ⚠️ ET LE REPLI NE DEMANDE AUCUN SCRIPT : `<details>`/`<summary>`. La page tourne sous une CSP à
// nonce ; un pied qui aurait besoin de JavaScript pour s'ouvrir se fermerait pour de bon le jour
// où son script ne passerait pas — et la mention avec lui.

const { init, legalFooter, LEGAL_CSS } = require("../gabarit-legal.js");

const NOTICE = "La consultation de ce document est mesurée (pages vues, temps de lecture) et transmise à son expéditeur.";
const NOTICE_ANON = "La consultation de ce document est mesurée (pages vues, temps de lecture).";

function avec(legal) {
  init({ legal: { sourceUrl: "https://github.com/x/player", legalUrl: "", privacyUrl: "https://exemple.fr/confidentialite",
    trackingNotice: NOTICE, trackingNoticeAnonymous: NOTICE_ANON, ...legal } });
}

describe("le pied légal se replie en pastille", () => {
  it("replié par défaut : un <details> SANS `open`, dont le résumé dit « Lecture mesurée »", () => {
    avec({});
    const html = legalFooter({ tracked: true, sansExpediteur: true });
    expect(html).toMatch(/^<details class=lgl>/);
    expect(html, "ouvert, il recouvrirait encore le document").not.toMatch(/<details[^>]*\bopen\b/);
    const resume = (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "";
    expect(resume.replace(/<[^>]+>/g, "").trim()).toBe("Lecture mesurée");
  });

  it("⚠️ rien ne se perd : la phrase exacte et les trois liens sont dans la page, sous la pastille", () => {
    avec({ legalUrl: "https://exemple.fr/mentions" });
    const html = legalFooter({ tracked: true, sansExpediteur: true });
    expect(html).toContain(NOTICE_ANON);
    expect(html).toContain(`href="https://github.com/x/player"`);       // AGPL
    expect(html).toContain(`href="https://exemple.fr/confidentialite"`);
    expect(html).toContain(`href="https://exemple.fr/mentions"`);
    expect(html, "un lien sans expéditeur n'en invente toujours pas").not.toContain("transmise à son expéditeur");
  });

  it("un lien nominatif garde sa phrase complète, dépliée sous la même pastille", () => {
    avec({});
    expect(legalFooter({ tracked: true, sansExpediteur: false })).toContain(NOTICE);
  });

  it("sans mesure (aperçu interne), la pastille ne prétend pas mesurer : elle dit « Informations »", () => {
    avec({});
    const html = legalFooter({ tracked: false });
    const resume = (html.match(/<summary[^>]*>([\s\S]*?)<\/summary>/) || [])[1] || "";
    expect(resume.replace(/<[^>]+>/g, "").trim()).toBe("Informations");
    expect(html).not.toContain("est mesurée");
    expect(html).toContain("Code source");
  });

  it("sans mesure ni lien, toujours rien du tout — une pastille vide serait un bouton qui n'ouvre rien", () => {
    avec({ sourceUrl: "", privacyUrl: "" });
    expect(legalFooter({ tracked: false })).toBe("");
  });

  it("⚠️ la barre pleine largeur a disparu de la feuille : plus de `left:0;right:0` sur le pied", () => {
    // La forme que l'hôte a demandé de retirer, nommée pour qu'elle ne revienne pas par un
    // copier-coller de l'ancienne règle : un pied ancré aux DEUX bords est une barre.
    const regle = (LEGAL_CSS.match(/\.lgl\{[^}]*\}/) || [])[0] || "";
    expect(regle, "la règle .lgl doit exister").not.toBe("");
    expect(/left:0/.test(regle) && /right:0/.test(regle)).toBe(false);
  });
});
