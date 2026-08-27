# Image du serveur autonome. Deux étapes : on construit les artefacts navigateur, on n'embarque
# que ce qui sert à répondre.
#
# ⚠️ LA VERSION DE NODE DE CETTE IMAGE EST UNE DÉCISION, PAS UNE MISE À JOUR.
# On suit la LTS ACTIVE (24, « Krypton »), jamais la Current : la Current sort toutes les six
# semaines et reçoit les ruptures. Node 26 existe depuis août 2026 mais ne devient LTS qu'en
# octobre — la proposer ici ferait tourner la prod d'auto-hébergeurs sur une base que rien ne
# soutient dans la durée. `engines` reste `>=22` : ce que le PAQUET accepte et ce que l'IMAGE
# embarque sont deux questions différentes, et 22 est encore maintenue jusqu'en avril 2027.
#
# ⚠️ ET ELLE EST ÉPINGLÉE PAR CONDENSAT, pas par étiquette. `node:24-alpine` désigne une image
# différente chaque semaine : deux constructions du MÊME commit produisaient deux images — celle
# qu'on a éprouvée en CI, et celle qu'un auto-hébergeur obtient en reconstruisant trois semaines
# plus tard. Aucune n'est fausse, et c'est le problème : rien ne disait laquelle tourne. Ce dépôt
# exigeait déjà cette règle pour les actions (`uses: …@<sha>`) ; elle vaut mot pour mot ici, et
# rien ne la vérifiait (P1, audit externe, 21/08). `tools/images-epinglees.mjs` la tient
# maintenant, et Dependabot monte le condensat comme il monte une dépendance.
#
# ⚠️ L'ÉTIQUETTE RESTE À CÔTÉ DU CONDENSAT, ET C'EST UN SECOND EXEMPLAIRE D'UN FAIT.
# Un condensat nu est illisible — personne ne relit une PR qui remplace soixante-quatre caractères
# par soixante-quatre autres. Mais « 24-alpine » et le condensat peuvent alors cesser de désigner
# la même chose, sans que rien ne se casse : l'image se construirait, les tests passeraient, et
# le fichier raconterait faux. Ils sont donc CONFRONTÉS : le job `docker` de la CI construit
# l'image, lui demande sa version de Node, et la compare à la majeure écrite sur cette ligne.
#
# ⚠️ UNE ÉTAPE QUI DÉPEND DE L'ARCHITECTURE S'ÉCRIT SUR `uname -m`, PAS SUR `ARG TARGETARCH` —
# et la raison n'est pas un goût, c'est que les deux workflows ne construisent PAS pareil.
# `image.yml` passe par buildx et déclare ses cibles (`platforms: linux/amd64,linux/arm64`) ;
# `ci.yml` fait un `docker build` nu — ni `setup-buildx-action`, ni `DOCKER_BUILDKIT`. Or
# `TARGETARCH` n'est renseigné QUE par BuildKit : sous le constructeur historique il est vide.
# Lequel des deux le runner choisit par défaut n'est écrit NULLE PART DANS CE DÉPÔT, ne se
# mesure pas d'ici, et peut changer avec l'image de runner sans que rien chez nous ne bouge —
# et c'est exactement l'objection. Une étape branchée sur `TARGETARCH` tirerait donc sa valeur
# d'un constructeur qu'on ne choisit pas, dans le workflow qui GARDE les fusions, pendant que
# celui qui PUBLIE la choisit explicitement : verte ici, fausse là, sans un rouge pour le dire.
# `uname -m` répond la même chose sous les deux. (Écrit le 27/08 en démontant la branche
# `claude/dumb-init-epingle`, où ce choix avait été fait pour la bonne raison ; le reste de ce
# travail est mort avec le retrait de `dumb-init`, ce fait-là ne l'est pas.)
#
# ⚠️ `server/*.generated.js` sont committés (les plateformes serverless ne construisent rien) —
# on les REconstruit ici quand même. Une image qui embarquerait un bundle plus ancien que sa
# source servirait du code périmé sans que rien ne le signale, et c'est exactement le défaut que
# la CI surveille par ailleurs.

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43 AS build
WORKDIR /app
COPY package*.json ./
# ⚠️ `--ignore-scripts` : le `prepare` de ce paquet installe le hook git, et il n'a rien à faire
# ici — une image n'a ni dépôt ni poussée. Sans ce drapeau, `npm ci` échoue, parce que les
# dépendances s'installent AVANT que les sources soient copiées : le script n'existe pas encore.
# Sans effet par ailleurs — la seule dépendance de production, pdfjs-dist, ne déclare aucun
# script d'installation (vérifié sur son manifeste ; ce commentaire disait « aucune dépendance
# de production », ce qui a cessé d'être vrai sans que rien ne le confronte).
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:24-alpine@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43
WORKDIR /app
ENV NODE_ENV=production
# ⚠️ PAS D'INIT DANS CETTE IMAGE, ET C'EST UN CHOIX MESURÉ — PAS UN OUBLI. `dumb-init` a vécu ici,
# pour une raison qui était juste et qui est morte : « Node est PID 1 et n'a pas de gestionnaire de
# signal par défaut, donc `docker stop` attendrait dix secondes avant de tuer ». `bin/serve.js` en
# installe un désormais, et le noyau ne discarde un signal sur PID 1 QUE s'il n'y en a aucun. Node
# reçoit donc `SIGTERM`, draine ce qui est en vol, et sort — sans intermédiaire.
#
# ⚠️ IL LUI RESTAIT LE MOISSONNAGE DES ZOMBIES, ET CE TRAVAIL EST VIDE ICI. Ce runtime ne lance
# AUCUN sous-processus — vérifié, et tenu par un banc (`bin/__tests__/sansSousProcessus.test.js`)
# qui refusera le premier `child_process` ajouté à `server/`, `bin/` ou `context/`. La décision se
# reposera donc au moment exact où elle redeviendra vraie, au lieu de dormir dans ce commentaire.
# (`docker exec` ne crée pas d'enfants de PID 1 : ce chemin-là n'a jamais rien à moissonner.)
#
# ⚠️ CE QUE SON RETRAIT ACHÈTE. Il était le SEUL intrant non épinglé de cette image : `apk add`
# allait chercher le paquet sur le réseau, sans version — même Dockerfile, même digest de base, deux
# `dumb-init` différents à trois mois d'écart. L'épinglage par condensat a été écrit, puis écarté :
# quatre pièces mobiles (dépendance réseau au build, deux condensats à maintenir, un embranchement
# d'architecture, un téléchargeur ad hoc faute de certificats dans l'image) pour un composant dont
# le travail est vide. Le retirer supprime le problème au lieu de le vérifier, et rend la
# construction reproductible SANS CONDITION — plus rien à aller chercher.
#
# ⚠️ SI VOUS EN AVIEZ BESOIN, VOUS N'ÊTES PAS COINCÉ : `docker run --init` injecte un init sans
# toucher à cette image, et c'est le bon geste le jour où vous lancez un sous-processus dedans.

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/bin ./bin
COPY --from=build /app/server ./server
COPY --from=build /app/context ./context
COPY --from=build /app/supabase ./supabase
COPY --from=build /app/LICENSE /app/LICENSE-MIT /app/README.md ./

# Les documents se montent ici. Le dossier existe pour que l'image réponde même sans volume :
# elle affiche alors une page « aucun document », pas une erreur de démarrage.
RUN mkdir -p /data && chown node:node /data
ENV PLAYER_LOCAL_ROOT=/data PORT=3000 HOST=0.0.0.0
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# ⚠️ FORME EXEC, PAS FORME SHELL — et ce n'est pas cosmétique maintenant qu'il n'y a plus d'init.
# `CMD node bin/serve.js` lancerait un `/bin/sh` comme PID 1, qui NE RELAIE PAS les signaux à son
# enfant : le gestionnaire de `SIGTERM` ne serait jamais appelé et l'arrêt gracieux ne servirait à
# rien. Sous cette forme, Node EST PID 1 et reçoit le signal lui-même.
CMD ["node", "bin/serve.js"]
