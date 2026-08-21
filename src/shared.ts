// CE QUE LE NAVIGATEUR ET LE SERVEUR PARTAGENT, EN UN SEUL EXEMPLAIRE.
//
// Point d'entrée du module `server/shared.generated.js`. Son en-tête généré dit pourquoi il existe :
// « deux implémentations d'un même contrat finissent toujours par diverger en silence ».
//
// ⚠️ Ce n'est pas une théorie. La cadence d'écriture du suivi (navigateur) et le quota qui doit la
// supporter (serveur) étaient deux nombres écrits séparément — et le second est passé sous le
// premier sans que rien ne le signale : la limite ne tenait pas un seul lecteur. Ce qui appartient
// à un même contrat s'écrit ici, et se DÉDUIT plutôt que se recopie.

export * from "./presentation-content";
export * from "./cadence";

/**
 * ⚠️ LE CONTRAT DU SLUG, EN UN SEUL EXEMPLAIRE. `randomBytes(9).toString("base64url")` → 12
 * caractères ; la borne à 64 laisse la place aux slugs lisibles sans ouvrir la porte à une clé de
 * cache arbitrairement longue.
 *
 * Le SERVEUR ne validait rien du tout : le slug partait tel quel dans une clé de cache et dans une
 * requête base. Un lecteur pouvait donc faire varier une clé à volonté — exactement le levier qui
 * rendait l'admission du cache exploitable de l'extérieur. Un contrat que seul le navigateur
 * applique n'est pas un contrat. (Audit externe.)
 *
 * ⚠️ ET IL EN EXISTE UNE SECONDE COPIE, DÉLIBÉRÉMENT — dans `bridge.ts`, qui est le SEUL fichier
 * MIT d'un paquet AGPL, pour qu'un hôte puisse importer le contrat d'iframe sans ouvrir son propre
 * code. L'y faire importer ce module dissoudrait cette frontière en silence. Ici on ne PEUT donc
 * pas dériver : la cohérence est tenue par une garde (`contratDuSlug.test.js`) qui compare les deux
 * motifs. Une duplication qu'on ne peut pas retirer se SURVEILLE — elle ne se tolère pas.
 */
export const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Vrai si `v` respecte le contrat de slug. Le test, pas le motif : on ne recopie pas une regex. */
export function estSlug(v: unknown): boolean {
  return typeof v === "string" && SLUG_RE.test(v);
}
