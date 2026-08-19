// EXTRAIT DE handler.js (refactor 19/08/2026) — texte déplacé À L'IDENTIQUE, aucun changement
// de comportement. Reste à PLAT dans server/ : plusieurs gardes de forge ciblent server/*.js,
// un sous-dossier les viderait en silence (la garde qui énumère maigrit quand on range).

// ⚠️ VERSION EXACTE, PAS `@2` (constat P2-4). L'étiquette `@2` de jsdelivr suit la dernière 2.x :
// la page servait donc, aux visiteurs, le code que Supabase avait publié le matin même — sans que
// personne n'ait rien déployé, ni relu, ni pu revenir en arrière. Le jour où elle résolvait vers
// 2.112.3, un correctif de la veille aurait changé ce qui tourne dans le navigateur d'un client
// pendant une présentation en cours. Une dépendance mouvante n'est pas une dépendance, c'est un
// abonnement à ce que décide un tiers.
const SUPAJS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.3/dist/umd/supabase.js";
const LEAFLET = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
// ⚠️ `weekly` EST UN CANAL, PAS UNE VERSION — le même défaut que l'étiquette `@2` de jsdelivr :
// le code de cartographie exécuté chez le visiteur changeait chaque semaine sans qu'aucun
// déploiement le décide. Google ne publie pas d'empreinte et son chargeur injecte d'autres
// scripts, donc l'intégrité restera hors de portée ici ; épingler la version trimestrielle rend
// au moins le changement DÉCIDÉ, et daté. À relever à chaque montée — Google retire les versions
// après environ un an.
// ⚠️ UNE VERSION INVALIDE N'EST PAS UNE ERREUR, C'EST UN CANAL PAR DÉFAUT SILENCIEUX. Google ne
// sert qu'une fenêtre glissante de versions (~4 trimestres) ; en dehors, le paramètre est IGNORÉ
// et le canal hebdomadaire se charge — l'épinglage devient une illusion sans qu'aucune erreur ne
// le dise. « 3.58 » a menti ainsi pendant des mois (cinquième audit). À vérifier à chaque
// trimestre — le commentaire d'à côté doit porter la date du dernier contrôle.
// Contrôlé le 18/08/2026 : fenêtre servie 3.62 → 3.65.
const MAPS_VERSION = "3.65";

/**
 * Empreintes des dépendances tierces (constat P2-4).
 *
 * ⚠️ CE QUI EST EN JEU : un script tiers entre dans la page avec EXACTEMENT les droits de notre
 * code — même origine, même session, même accès au document affiché. Une version épinglée dit
 * seulement quel fichier on demande ; elle ne dit rien de ce qu'on reçoit. L'empreinte, elle, fait
 * refuser le navigateur si un octet a changé, quelle que soit la raison : CDN compromis, compte de
 * publication détourné, ou intermédiaire.
 *
 * ⚠️ ET ELLE OBLIGE À ÉPINGLER. `integrity` sur une URL mouvante casserait la page à la première
 * publication du tiers : les deux vont ensemble, l'un n'a pas de sens sans l'autre.
 *
 * Relevées sur les octets réellement servis, pas recopiées d'une documentation. Pour les vérifier
 * ou les mettre à jour après une montée de version :
 *
 *   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
 *
 * Le banc navigateur les reconfronte à ce que les CDN servent — deux exemplaires d'un même fait
 * doivent être comparés par quelqu'un au moins une fois.
 */
const TIERS = {
  // ⚠️ Le worker N'A PAS DE BALISE, donc pas d'attribut `integrity` : il est chargé par pdf.js,
  // pas par le document. Mais ses octets passent déjà par notre code (ils sont récupérés en texte
  // puis transformés en blob de même origine, sans quoi le navigateur refuserait un worker
  // distant) — on les vérifie donc à la main, là où ils passent. Sans ça, l'empreinte de
  // `pdf.min.js` protégerait la petite moitié et laisserait la grande (1 Mo contre 300 ko) entrer
  // sans contrôle, alors même qu'elle voit tout le contenu du document.
  supa: { url: SUPAJS, sri: "sha384-qafw21c/iciq0VXsi9FzkfoQv5I/V0iqE4lSNcKXPnW9/UTJLnv5CcN4FHxVLnKg" },
  leaflet: { url: LEAFLET, sri: "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH" },
  // ⚠️ UNE FEUILLE DE STYLE TIERCE N'EST PAS INOFFENSIVE, et celle-ci n'était comptée nulle part.
  // Du CSS peut déplacer, agrandir et rendre transparent n'importe quel élément : un bouton qu'on
  // croit cliquer n'est pas forcément celui qu'on clique. Même origine, même empreinte, même règle.
  leafletCss: { url: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", sri: "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H" },
};

// ⚠️ `crossorigin` EST OBLIGATOIRE avec `integrity` sur une ressource d'une autre origine : sans
// lui, la réponse est opaque, le navigateur ne peut pas la lire pour la hacher, et il refuse le
// script — silencieusement du point de vue de la page. L'oublier ne dégrade pas la protection,
// ça casse la page. Les deux ne se séparent jamais : d'où cette fonction, plutôt que trois
// balises écrites à la main dont l'une finirait par en perdre un.
const balise = (nonce, tiers) =>
  `<script nonce="${nonce}" src="${tiers.url}" integrity="${tiers.sri}" crossorigin="anonymous"></script>`;

module.exports = { SUPAJS, LEAFLET, MAPS_VERSION, TIERS, balise };
