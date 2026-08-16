# Nommer son membre — spécification, avant écriture

**État : PROJET.** Rien de ceci n'est implémenté. Ce document est envoyé au second hôte pour accord
avant que le contrat ne bouge, parce que c'est lui qui en a besoin et nous qui l'écrivons.

Origine : la clé de session de notre studio était codée en dur dans ce paquet (`0.1.27`). Rendue
réglable, elle ne résout toujours rien pour un hôte dont l'instance et l'application vivent sur des
origines distinctes — et **aucune valeur de configuration ne le résoudra jamais**. Deux origines,
deux `localStorage`.

---

## Le problème, en deux chemins d'arrivée

Un membre de l'hôte peut atteindre une présentation de deux façons. Une seule est couverte.

**Depuis l'application** — le player est dans une iframe de l'hôte, qui l'ouvre lui-même. L'hôte
passe `uemail` et `it` au rendu (cf. `0.1.35`). ✅ Résolu, c'est ce qui alimente le suivi interne.

**Depuis un lien reçu** — la page s'ouvre directement sur l'instance du player, par un courriel ou
une messagerie. ⚠️ **Il n'y a aucun rendu d'hôte où injecter quoi que ce soit.** C'est le player qui
rend la page, l'hôte n'est pas dans la boucle.

C'est ce second cas qui produit le défaut, et c'est le plus fréquent : **un lien de présentation est
fait pour être envoyé.** Un collègue qui l'ouvre est compté dans la population externe — exactement
la séparation que ce produit vend.

### Ce qui ne marche pas, et pourquoi il faut l'écrire

Un `fetch` vers l'hôte avec `credentials: "include"` depuis la page du player. Le cookie de session
de l'hôte y est un **cookie tiers** : Safari le bloque déjà, Chrome le déprécie. Une solution bâtie
dessus marche en développement et s'éteint navigateur par navigateur, sans qu'aucun test ne l'annonce.

*Écarté sur la démonstration du second hôte.*

---

## Le mécanisme : un aller-retour, à l'initiative du lecteur

1. La page s'ouvre sans identité connue. Le panneau « Rejoindre » s'affiche **normalement**, avec un
   bouton supplémentaire : **« Je suis membre de *<marque>* »**.
2. Au **clic** — jamais automatiquement — la page va sur `<PLAYER_HOST_MEMBER_URL>?retour=<url>&essai=1`.
3. La route de l'hôte est **sur son origine**, donc son cookie de session lui parvient. Elle renvoie
   vers `retour` avec un jeton court signé, **dans le fragment** : `…#membre=<jeton>`.
4. Le player vérifie le jeton, le range sous sa propre clé, et nettoie le fragment de l'URL.

### ⚠️ Pourquoi au clic, et pas automatiquement

La première proposition redirigeait dès qu'aucune identité n'était connue. Trois conséquences, et
c'est le prospect qui les paie :

- **l'hôte voit passer l'adresse IP et l'agent de chaque lecteur externe** — y compris, sur une
  instance multi-marques, les prospects d'un client qui n'a rien à voir avec lui ;
- le prospect voit un autre domaine clignoter dans sa barre d'adresse, sur un document que son
  interlocuteur vient de lui envoyer. C'est une hésitation au pire moment ;
- un aller-retour complet sur le chemin critique du premier affichage, pour une fonction qui ne
  concerne qu'une minorité.

> « nous avions raisonné en membres et oublié que le chemin par défaut est celui du prospect »
> — session ADV, qui a accepté le changement

Coût du clic : une action pour le membre. Gain : rien pour le prospect, ni exposition, ni latence.
Et la boucle entre deux domaines devient presque sans objet, puisque plus rien ne part tout seul.

### ⚠️ Pourquoi le fragment, et pas la requête

`#membre=` plutôt que `?membre=`. **Un fragment n'est pas envoyé au serveur** : ni journaux d'accès,
ni journaux de proxy, ni en-tête `Referer`.

Il reste dans l'historique du navigateur — c'est ce que la durée de vie courte paie, et c'est la
seule des trois expositions qui subsiste.

---

## Ce que l'hôte implémente

Une route, sur son origine, qui lit **son** cookie de session.

```
GET <PLAYER_HOST_MEMBER_URL>?retour=<url absolue>&essai=1
```

| réponse | quand |
|---|---|
| `302` vers `<retour>#membre=<jeton>` | une session existe |
| `302` vers `<retour>` (sans fragment) | aucune session — le lecteur reste anonyme |
| `400` | `retour` ne pointe pas une origine d'instance déclarée |

### Le jeton

Même mécanique que le jeton interne de `0.1.22` — une seule forme de signature dans tout le
produit, pas deux :

```
base64url(JSON) + "." + base64url(HMAC-SHA256(base64url(JSON), secret))
```

Charge utile :

```json
{ "email": "…", "name": "…", "avatar": "…", "origin": "https://doc.exemple.fr", "exp": 1786830489 }
```

- **`exp` est obligatoire, et court.** ⚠️ Il se borne par l'**échange**, pas par la lecture : le
  jeton est consommé immédiatement au retour de la redirection, donc quelques dizaines de secondes
  suffisent. Le dimensionner sur la durée d'une lecture reviendrait à le laisser vivre des minutes
  après qu'il a servi. *(précision ADV)*
- **`origin` est l'origine de l'instance** qui a demandé. Un jeton obtenu pour une instance ne vaut
  pas pour une autre.
- ⚠️ **Pas de `slug`.** Lier au document obligerait à refaire l'aller-retour à chaque présentation
  ouverte, pour un gain nul : l'appartenance n'est pas propre à un document. La contrepartie est
  assumée et doit être dite — *un jeton retrouvé dans un historique vaut pour n'importe quelle
  présentation de cette instance, pendant sa durée de vie.* C'est ce que la durée courte paie.

### ⚠️ Un secret distinct

`PLAYER_HOST_MEMBER_SECRET`, et non celui du jeton interne ni celui du relais de fichiers. Le
contrat porte déjà ce raisonnement à propos de `PLAYER_HOST_SHARE_SECRET` :

> un secret ne suit ni un changement de destinataire, ni un changement de direction

Ici c'est **les deux à la fois**. Le jeton interne signe « cette personne est mon membre *pour ce
document* », voyage dans un corps de requête, et part du navigateur vers le player. Celui-ci signe
« cette personne est mon membre », tout court, et **traverse une barre d'adresse**.

---

## Les quatre garde-fous

*Proposés par la session ADV, retenus tels quels.*

1. **Un seul aller-retour**, marqué par `essai=1`. ⚠️ Voir la section dédiée ci-dessous : le
   marqueur voyage dans le **fragment**, comme le jeton, et sa raison d'être n'est plus celle qu'on
   croyait.
2. **Échec ouvert.** Pas de session, route injoignable, jeton illisible ou expiré → visiteur
   anonyme, présentation normale. **Une identité qu'on ne sait pas établir n'empêche jamais de lire.**
3. **`retour` borné côté hôte.** Il doit pointer une origine d'instance déclarée, sinon la route
   devient une **redirection ouverte signée du nom de l'hôte**. Même raisonnement que la garde
   rejouée à chaque saut en `0.1.18` : on ne fait pas confiance au premier maillon.
4. **Jeton court et lié.** Quelques minutes, l'origine de l'instance dans la charge. Il traverse une
   barre d'adresse : il finit dans un historique.

---

## Où vit `essai=1`, et pourquoi le fragment

⚠️ **L'objection tombe pour une raison de rôle, pas de transport.** « Le fragment n'est pas envoyé au
serveur, donc le marqueur ne peut pas y vivre seul » est vrai du transport — et **sans conséquence
ici, parce que le serveur n'a pas besoin de le lire.**

Regardez qui décide quoi :

- **L'hôte** lit son cookie et répond. Il ne décide jamais « on a déjà essayé » : il n'a aucun état à
  consulter pour ça, et il répondrait la même chose au deuxième passage qu'au premier.
- **La page du player** est la seule qui ait besoin du marqueur — pour afficher « vous ne semblez pas
  connecté » au lieu de rien, et pour ne pas reproposer un geste qui vient d'échouer. C'est un état
  **d'affichage**, et il se lit côté navigateur.

Donc l'hôte pose le marqueur, la page le lit, et **le fragment porte les deux issues** :

```
succès  →  Location: <retour>#membre=<jeton>
échec   →  Location: <retour>#essai=1
```

Les navigateurs honorent un fragment dans un `Location`. **Un seul véhicule, une seule durée de vie,
un seul nettoyage** par `history.replaceState`.

⚠️ Deux véhicules finiraient par se désynchroniser — l'un retiré de l'URL, l'autre resté. Et c'est
le **marqueur** qui survivrait au jeton : un membre légitime bloqué par la trace d'un échec passé.

### La règle de fusion

⚠️ **Si `retour` porte déjà un fragment, l'hôte le REMPLACE — il ne concatène pas.** Une URL de
retour avec `#page=3` deviendrait `#page=3#essai=1`, que personne ne lit correctement, et l'échec
serait silencieux. Comme d'habitude.

### Ce que ce marqueur protège, en réalité

Une conséquence de la décision de déclencher **au clic** : il ne protège plus d'une boucle
automatique — il protège d'une **insistance**. Sa raison d'être est devenue l'explication au membre,
pas la sûreté du mécanisme.

*C'est plus modeste que ce qu'on écrivait au début, et c'est plus vrai.* (formulation ADV)

## La résolution par marque

⚠️ **Une URL par marque, pas une par instance.** Le second hôte sert `doc.adnfamily.com` et
`doc.valoneuf.com` depuis la même instance. Un bouton unique enverrait le lecteur d'un document
VALONEUF s'authentifier chez ADN Family — ce qui est faux, et **visible**.

L'URL se résout donc comme le logo (`branding.forKey`), avec repli sur l'URL d'instance quand la
marque n'en déclare pas. Pas d'URL du tout ⇒ **le bouton n'apparaît pas** : une commande qui ne peut
pas aboutir ne doit pas être offerte.

⚠️ **Et le masquage se journalise, une fois par heure.** Sans ça, la conséquence est invisible du bon
côté : le membre voit exactement ce que voit le prospect, sans indication qu'il manque quelque chose,
et l'exploitant l'apprend par un collègue qui se plaint plutôt que par ses journaux. C'est la règle
des gardes muettes, appliquée avant d'avoir été enfreinte. *(demandé par ADV)*

---

## Ce que le player apporte

Par symétrie avec `PLAYER_HOST_MAIL_URL` / `PLAYER_HOST_MAIL_SECRET` :

| réglage | rôle |
|---|---|
| `PLAYER_HOST_MEMBER_URL` | la route de l'hôte. Absente ⇒ le bouton n'apparaît pas |
| `PLAYER_HOST_MEMBER_SECRET` | vérification du jeton. Configurée sans l'URL ⇒ **signalé** |

Plus : le bouton dans le panneau « Rejoindre », la vérification (comparaison à temps constant,
`exp` obligatoire, `origin` confrontée à la sienne), le rangement sous la clé du player, et le
nettoyage du fragment.

---

## Ce que ça ne résout pas

**Un visiteur peut toujours taper le nom qu'il veut.** C'est le mode prévu : il s'annonce sans rien
prouver, et les badges restent éteints (`0.1.34`). Ce mécanisme nomme les membres ; il ne
transforme pas un invité en identité vérifiée, et ne doit pas être présenté comme tel.

## Pourquoi les deux hôtes en veulent

Chez nous c'est « seulement plus propre » aujourd'hui — studio et player partagent une origine.
Mais **le jour où la visionneuse déménage sur un sous-domaine, nous sommes dans le cas d'ADV**, et
le réglage de `0.1.27` cessera d'opérer **sans rien dire**.

Ce mécanisme, lui, ne suppose aucune topologie : même origine, origines distinctes, sous-domaine,
domaine séparé — il marche pareil. La clé partagée ne marchait que dans un cas, et c'est ce cas-là
qui l'avait fait écrire.
