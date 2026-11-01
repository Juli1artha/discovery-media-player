# L'IMAGE DU SCANNER EST UNE DÉPENDANCE — ET LES DÉPENDANCES S'ÉPINGLENT.
#
# La règle du Dockerfile racine, mot pour mot. `zaproxy:stable` désigne une image différente à
# chaque publication de ZAP : les règles du scan changeraient alors sans qu'aucun commit ne bouge —
# un jour vert, un jour rouge, pour une raison invisible dans le diff. C'est exactement le défaut
# que ce dépôt refuse partout (actions, image Node, scripts tiers), et un GARDE mouvant est pire
# qu'une dépendance mouvante : c'est le juge qui change d'avis sans qu'on l'ait nommé.
#
# ⚠️ CE FICHIER N'EXISTE QUE POUR PORTER CET ÉPINGLAGE. Une référence dans une ligne `docker run`
# d'un workflow n'est lue par personne : Dependabot ne monte que ce qui vit dans un Dockerfile
# (entrée `/.zap` de .github/dependabot.yml), et la garde `tools/images-epinglees.mjs` ne lit
# qu'un Dockerfile aussi — la CI le lui passe à côté du Dockerfile racine.
#
# ⚠️ L'ÉTIQUETTE RESTE À CÔTÉ DU CONDENSAT, ET ELLE EST CONFRONTÉE : le workflow zap.yml demande
# sa version à l'image même (`zap.sh -cmd -version`) et la compare à la version écrite ici —
# la confrontation étiquette↔condensat du Dockerfile racine, appliquée au scanner.
FROM ghcr.io/zaproxy/zaproxy:2.17.0@sha256:030d3df57735dacbb83464854758e674dd9ad01d79d12a129a8e58b1fd384238
