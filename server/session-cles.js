// EXTRAIT DE handler.js (refactor lot 2, 19/08/2026) — texte déplacé À L'IDENTIQUE. Reste à
// PLAT dans server/ (les gardes de forge ciblent server/*.js).

let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

// ── Clés de `localStorage`, et pourquoi ce ne sont plus des constantes ─────────────────────────
//
// ⚠️ `3dd-supabase-auth` — la clé de session du studio 3D Discovery — était écrite EN DUR à cinq
// endroits de ce paquet open source. Conséquence pour tout autre hôte : `detectMember()` et
// `accessToken()` ne trouvent jamais rien, donc AUCUN de ses membres n'est reconnu comme tel. La
// séparation des populations interne/externe, que ce produit vend, ne fonctionnait que chez nous.
//
// ⚠️ Et depuis 0.1.25 cette clé porte une propriété de sécurité : c'est par elle que l'appartenance
// se prouve. Une constante d'un hôte devenue porteuse pour tous les autres.
//
// Défaut VIDE, et c'est délibéré : sans clé déclarée, la détection est simplement inactive — aucun
// membre, donc aucune usurpation. Un défaut à `3dd-supabase-auth` aurait gardé notre instance en
// marche en laissant le défaut de conception intact, et le prochain hôte l'aurait découvert comme
// ADV : en constatant que ses statistiques ne séparent rien.
//
// ⚠️ CE N'EST QU'UNE TRANSITION. Lire le `localStorage` d'une autre application ne peut PAS marcher
// quand les origines diffèrent — l'instance ADV est sur `doc.adnfamily.com` et son application sur
// `app.adnfamily.com` : deux `localStorage`, aucune configuration n'y changera rien. Le bon
// mécanisme est que l'hôte INJECTE son membre au rendu de la page, comme il injecte déjà sa marque.
// Tracé dans docs/AUDIT-2026-08-14-SUIVI.md.
function cleSessionHote() {
  return String((PLAYER.config && PLAYER.config.hostAuthStorageKey) || "");
}
// La session du client Realtime du player, et l'identité d'un invité : à lui, sous son nom. Elles
// ne dépendent d'aucun hôte, donc elles restent des constantes — mais plus des constantes d'AUTRUI.
const CLE_SESSION_PLAYER = "dmp-live-auth";
const CLE_INVITE = "dmp-present-me";

module.exports = { init, cleSessionHote, CLE_SESSION_PLAYER, CLE_INVITE };
