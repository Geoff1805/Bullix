# Règles d'Agent — Projet Bullix

## Publication automatique sur GitHub
- **Publication systématique** : Toutes les modifications de code autorisées dans le projet Bullix (`Geoff1805/Bullix`, branche `main`) doivent être automatiquement publiées (commit & push) sur GitHub dès qu'elles sont appliquées localement.
- **Méthode de publication** : En l'absence du binaire `git` local, utiliser directement le serveur MCP GitHub (`github-mcp-server` via l'outil `push_files` ou `create_or_update_file`) vers `owner: "Geoff1805"`, `repo: "Bullix"`, `branch: "main"`, avec un message de commit clair au format Conventional Commits (`feat:`, `fix:`, `ci:`, `chore:`, `docs:`).

## Délégation Maximale vers GitHub Actions (CI/CD First)
- **Décharge locale et décharge de l'environnement Antigravity** : L'environnement local Windows (notamment limité par Java 8) ainsi que l'environnement Antigravity ne doivent pas être encombrés par des compilations lourdes, des téléchargements d'outillages massifs ou des exécutions consommatrices de ressources.
- **Règle absolue : Ce qui peut être fait par GitHub doit être fait sur GitHub.**
- **Rôle de l'Agent** : Se concentrer exclusivement sur ce que GitHub ne sait pas faire (conception architecturale, écriture de code métier propre, tests unitaires, algorithmes, diagnostics, configuration des workflows et documentation claire).
- **Standards obligatoires pour chaque projet / feature** :
  1. **Tests automatiques** : Toujours concevoir des tests unitaires et d'intégration et les brancher dans les workflows CI.
  2. **Génération d'APK** : Workflow automatique (`assembleDebug` / `assembleRelease`) avec publication d'artefacts téléchargeables.
  3. **Déploiement Site Web** : Workflow automatique de build et déploiement du frontend (ex: Cloudflare Pages).
  4. **Sécurité & Dépendances** : Toujours maintenir la configuration Dependabot (`.github/dependabot.yml`) et les actions de Dependency Scanning / Review pour bloquer les vulnérabilités.

## Conventions du Projet
- **Langue** : Toujours répondre en français de manière concise avec des liens cliquables `file:///` vers les fichiers et symboles modifiés.
- **Architecture** : Offline-First stricte, Optimistic UI, Kotlin Multiplatform (KMP), Cloudflare Serverless (D1, KV, R2).
- **Souveraineté & Green IT** : Maintenir l'architecture 100 % locale sans dépendance cloud propriétaire obligatoire ; fonctionnement autonome en l'absence de réseau.
