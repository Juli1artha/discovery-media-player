// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// Marque affichée par le loader d'un document — celle du CLIENT dont on montre le document.
//
// ⚠️ **Résolue à l'affichage, jamais recopiée dans le lien.** Un lien tracé vit des semaines dans
// une boîte mail : un logo figé au moment de l'envoi ne suivrait pas une charte corrigée.
//
// ⚠️ Et **le player ne tient pas de registre**. Une première version en avait un — table dédiée,
// actions d'administration — jusqu'à ce qu'on constate que l'hôte a DÉJÀ cette donnée (chez le
// studio : le logo de l'espace client, sur la fiche société du CRM). Un registre en aurait été le
// miroir, donc une chose de plus à synchroniser : exactement le problème qu'on cherchait à éviter,
// un étage plus haut. Le lien porte une CLÉ, l'hôte répond.
//
// Le player ne sait pas ce qu'est un client : il ne connaît que des clés.

// ⚠️ Le contexte est REÇU, pas construit. Ce module ne doit pas savoir d'où il vient : c'est ce
// qui lui permettra de partir dans le dépôt du player sans emporter le studio avec lui.
let PLAYER = null;
function init(ctx) { PLAYER = ctx; }


/**
 * Marque à afficher pour un partage, par ordre de priorité :
 *   1. la clé du lien (`brand_key`), résolue MAINTENANT par l'hôte — donc toujours à jour ;
 *   2. le logo recopié dans le lien (`brand_logo`) — flux historiques, toujours honoré ;
 *   3. rien : le loader affiche la marque de l'instance.
 *
 * Ne lève jamais : une marque introuvable dégrade le loader, elle n'empêche pas de lire le document.
 */
async function brandForShare(share) {
  if (!share) return null;
  if (share.brand_key) {
    // Le commentaire ci-dessus dit « ne lève jamais » : on le rend vrai ici aussi, sans compter
    // sur la garde du contexte. Une marque introuvable dégrade le loader, elle ne casse rien.
    try {
      const brand = await PLAYER.branding.forKey(share.brand_key);
      if (brand) return brand;
    } catch { /* on retombe sur le logo du lien */ }
  }
  // Repli historique : un lien créé avant les clés porte son logo recopié. Pas de nom à ce
  // stade — ces liens n'en ont jamais transporté.
  if (share.brand_logo) return { logo: String(share.brand_logo), name: "", dark: !!share.brand_dark };
  return null;
}

module.exports = { init, brandForShare };
