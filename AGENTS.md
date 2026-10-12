# Règles d'Agent — Projet Bullix

## Publication automatique sur GitHub & Surveillance Active
- **Publication systématique** : Toutes les modifications de code autorisées dans le projet Bullix (`Geoff1805/Bullix`, branche `main`) doivent être automatiquement publiées (commit & push) sur GitHub dès qu'elles sont appliquées localement.
- **Méthode de publication** : En l'absence du binaire `git` local, utiliser directement le serveur MCP GitHub (`github-mcp-server` via l'outil `push_files` ou `create_or_update_file`) vers `owner: "Geoff1805"`, `repo: "Bullix"`, `branch: "main"`, avec un message de commit clair au format Conventional Commits (`feat:`, `fix:`, `ci:`, `chore:`, `docs:`).
- **Suivi automatique systématique de tous les GitHub Actions** : Dès qu'un push est effectué, l'Agent doit **systématiquement** surveiller l'état d'exécution des workflows GitHub Actions déclenchés (via le script dédié `scripts/ci/check-ci.ps1 -Watch` ou l'API GitHub). L'Agent ne doit jamais considérer sa tâche comme terminée tant que les workflows du commit ne sont pas complétés.
- **Boucle d'autocorrection automatique (Self-Healing CI)** : En cas d'échec d'un workflow GitHub Actions (`failure`), l'Agent doit obligatoirement :
  1. Inspecter immédiatement le job et l'étape en échec ainsi que les logs d'erreurs détaillés.
  2. Diagnostiquer la cause racine (erreur de compilation, test unitaire en échec, problème de dépendance, lint, etc.).
  3. Appliquer le correctif approprié localement.
  4. Publier immédiatement le commit de correction sur GitHub.
  5. Réitérer la surveillance jusqu'à ce que tous les workflows soient au vert.

## Délégation Maximale vers GitHub Actions (CI/CD First)
- **Décharge locale et décharge de l'environnement Antigravity** : L'environnement local Windows (notamment limité par Java 8) ainsi que l'environnement Antigravity ne doivent pas être encombrés par des compilations lourdes, des téléchargements d'outillages massifs ou des exécutions consommatrices de ressources.
- **Règle absolue : Ce qui peut être fait par GitHub doit être fait sur GitHub.**
- **Rôle de l'Agent** : Se concentrer exclusivement sur ce que GitHub ne sait pas faire (conception architecturale, écriture de code métier propre, tests unitaires, algorithmes, diagnostics, configuration des workflows et documentation claire).
- **Standards obligatoires pour chaque projet / feature** :
  1. **Tests automatiques systématiques** : Tout développement métier, algorithme, modèle ou fonctionnalité doit obligatoirement inclure des tests unitaires et/ou d'intégration automatisés (Kotlin / JUnit, TypeScript). Ces tests sont exécutés dans les workflows CI (`./gradlew test --continue`, `npm test` / `npm run typecheck`) et doivent passer sans régression.
  2. **Génération d'APK** : Workflow automatique (`assembleDebug` / `assembleRelease`) avec publication d'artefacts téléchargeables.
  3. **Déploiement Site Web** : Workflow automatique de build et déploiement du frontend (ex: Cloudflare Pages).
  4. **Sécurité & Dépendances** : Toujours maintenir la configuration Dependabot (`.github/dependabot.yml`) et les actions de Dependency Scanning / Review pour bloquer les vulnérabilités.
  5. **Mise à jour automatique Gradle (GA stable)** : Toujours intégrer le workflow de mise à jour automatique du Gradle Wrapper (`.github/workflows/update-gradle-wrapper.yml`) ciblant strictement le canal `stable` (GA uniquement, exclusion des Nightly builds et Release Candidates), avec validation d'intégrité SHA-256 et alignement dynamique de la CI (`./gradlew` sans version Gradle codée en dur).

## Conventions du Projet
- **Langue** : Toujours répondre en français de manière concise avec des liens cliquables `file:///` vers les fichiers et symboles modifiés.
- **Architecture** : Offline-First stricte, Optimistic UI, Kotlin Multiplatform (KMP), Cloudflare Serverless (D1, KV, R2).
- **Souveraineté & Green IT** : Maintenir l'architecture 100 % locale sans dépendance cloud propriétaire obligatoire ; fonctionnement autonome en l'absence de réseau.
- **Réutilisation de l'existant (Ne pas réinventer la roue)** : Systématiquement privilégier les bibliothèques éprouvées, composants standards et fonctionnalités natives de l'écosystème (ex: SQLite FTS5, MiniSearch/Fuse.js, standards de validation/formatage) plutôt que de réécrire des solutions maison ad-hoc ou fragiles dès lors qu'un outil standard adapté existe.
