// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// « JAMAIS BLOQUANT » NE TENAIT QUE POUR UNE EXCEPTION SYNCHRONE.
//
// ⚠️ TRENTE-CINQ APPELS À `errors.capture` PORTAIENT LE COMMENTAIRE « jamais bloquant » SOUS UN
// `try/catch` — QUI N'ATTRAPE QU'UNE EXCEPTION SYNCHRONE. Le contrat autorise `capture` à rendre une
// promesse ; une promesse REJETÉE échappait au `catch`, remontait en `unhandledRejection`, et Node
// arrête le processus : reproduit par un audit externe sur le tag v0.1.166, à `init`, avec un
// `capture` qui rejette et une configuration hors plage — sortie 1 avant le premier octet servi
// (sixième passe, 14/09). Un journal qui échoue ne doit rien arrêter, ni de façon synchrone ni de
// façon asynchrone : c'est la même règle, et elle vit ici, une fois, pour tous les appelants.
//
// ⚠️ On n'ATTEND pas la promesse — on la neutralise. Attendre ferait dépendre chaque réponse de la
// latence du journal de l'hôte ; ici on veut juste qu'un rejet ne tue personne.

/**
 * Confie une erreur au journal de l'hôte sans que le journal puisse, lui, faire échouer quoi que
 * ce soit — ni par une exception, ni par une promesse rejetée. `errors` peut être absent.
 */
function capturerSansBloquer(errors, erreur, meta) {
  try {
    const r = errors && typeof errors.capture === "function" ? errors.capture(erreur, meta) : undefined;
    if (r && typeof r.then === "function") r.then(undefined, () => { /* un journal qui échoue ne doit rien arrêter */ });
  } catch { /* exception synchrone : même règle */ }
}

module.exports = { capturerSansBloquer };
