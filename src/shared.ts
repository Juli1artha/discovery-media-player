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
