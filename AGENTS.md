# Règles d'Agent — Projet Bullix

> **Héritage global** : Ce projet applique l'ensemble des règles transversales consolidées dans [`~/.gemini/config/AGENTS.md`](file:///C:/Users/geoff/.gemini/config/AGENTS.md) (Sécurité Dependabot, Zéro warning CI, Normalisation de l'APK `Bullix.apk` sans ZIP, KMP/Compose Multiplatform, éradication de Foojay, économie de jetons).

## Spécificités d'Architecture & Livrables
1. **Signature systématique des APKs (/learn)** :
   - Tous les APKs produits (Debug et Release) doivent être systématiquement signés avec le Keystore persistant afin de garantir des mises à jour directes sans désinstallation.
2. **Numérotation et Versioning Univoques (/learn)** :
   - **Source unique de vérité** : La version de l'application est strictement définie dans `version.properties` (`versionCode` entier séquentiel, `versionName` SemVer `X.Y.Z`).
   - **Zéro valeur en dur** : Les scripts CI/CD, workflows, compilations Gradle et noms d'archives dérivent dynamiquement leur version depuis `version.properties` ou les variables d'environnement (`VERSION_NAME`, `VERSION_CODE`), sans jamais inscrire de numéro de version figé dans le code.
   - **Traçabilité stricte** : Chaque incrément de version doit être consigné dans `BACKLOG.md` (Section « Historique des Versions Livrées ») avec la liste précise des fonctionnalités/correctifs livrés, et synchronisé avec les tags/releases GitHub (`vX.Y.Z`).

## Conventions du Projet
- **Stack** : Kotlin Multiplatform (KMP) + Compose Multiplatform, SQLite/Room KMP.
- **Souveraineté & Green IT** : Fonctionnement 100 % local et offline-first sans dépendance cloud propriétaire obligatoire.
- **Langue & Liens** : Réponses concises en français avec liens cliquables `file:///` vers les fichiers et symboles modifiés.
