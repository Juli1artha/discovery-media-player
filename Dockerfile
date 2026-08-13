# Image du serveur autonome. Deux étapes : on construit les artefacts navigateur, on n'embarque
# que ce qui sert à répondre.
#
# ⚠️ `server/*.generated.js` sont committés (les plateformes serverless ne construisent rien) —
# on les REconstruit ici quand même. Une image qui embarquerait un bundle plus ancien que sa
# source servirait du code périmé sans que rien ne le signale, et c'est exactement le défaut que
# la CI surveille par ailleurs.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# `dumb-init` : sans lui, le processus Node est PID 1 et n'a pas de gestionnaire de signal par
# défaut — `docker stop` attendrait dix secondes avant de tuer, à chaque déploiement.
RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
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

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "bin/serve.js"]
