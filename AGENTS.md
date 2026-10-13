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
  6. **Résolution Immédiate des Alertes Dependabot (Zéro Tolérance Vulnérabilités)** : Surveiller en continu et corriger sans délai toutes les alertes de sécurité Dependabot dès détection (éradication des dépendances transitives obsolètes/superflues, élimination des plugins orphelins, et mise à jour immédiate vers les versions patchées).


## Conventions du Projet
- **Langue** : Toujours répondre en français de manière concise avec des liens cliquables `file:///` vers les fichiers et symboles modifiés.
- **Architecture** : Offline-First stricte, Optimistic UI, Kotlin Multiplatform (KMP), Cloudflare Serverless (D1, KV, R2).
- **Souveraineté & Green IT** : Maintenir l'architecture 100 % locale sans dépendance cloud propriétaire obligatoire ; fonctionnement autonome en l'absence de réseau.
- **Réutilisation de l'existant (Ne pas réinventer la roue)** : Systématiquement privilégier les bibliothèques éprouvées, composants standards et fonctionnalités natives de l'écosystème (ex: SQLite FTS5, MiniSearch/Fuse.js, standards de validation/formatage) plutôt que de réécrire des solutions maison ad-hoc ou fragiles dès lors qu'un outil standard adapté existe.

## Normalisation des Noms d'APK et Zéro ZIP Superflu pour TOUTES les Applications (/learn)
- **Règle absolue (/learn)** : Pour **TOUTES les applications existantes et TOUTES les nouvelles applications futures sans exception** (Android natif, Kotlin Multiplatform, Flutter, React Native, etc., incluant `InstallAPK`, `Bullix`, `Needix`, `AntigravityController`, etc.) :
  1. **Nommage normalisé strict `<AppName>.apk` dès la création** :
     - Dès l'initialisation, le premier commit ou la mise en place de la CI/CD de **toute nouvelle application**, l'APK produit et distribué doit porter exclusivement et obligatoirement le nom exact de l'application : **`<AppName>.apk`** (ex: `InstallAPK.apk`, `Bullix.apk`, `Needix.apk`, `AntigravityController.apk`).
     - Proscription formelle et absolue des noms par défaut des frameworks ou suffixes hétérogènes (`app-release.apk`, `app-debug.apk`, `-release-apk`, `-debug-apk`, `Needix-Debug-APK`, etc.) dans les artefacts et les releases.
  2. **Zéro ZIP superflu (Binaire APK brut directement installable)** :
     - Les APKs doivent être mis à disposition directement sous leur format `.apk` natif sans aucune compression ou encapsulation zip superflue.
     - Dans les GitHub Releases, le fichier `.apk` doit être immédiatement cliquable et téléchargeable depuis un smartphone pour une installation en un clic via `InstallAPK` ou le navigateur.
     - Dans les workflows CI/CD (`.github/workflows/*.yml`), toujours copier ou renommer l'APK compilé vers `build-artifacts/<AppName>.apk` avant les étapes d'upload d'artefact et de publication de release.
  3. **Détection automatique et intégration dans InstallAPK** :
     - Toute nouvelle application Android/mobile doit être compatible et immédiatement reconnue par `InstallAPK`.
     - `InstallAPK` trie les artefacts GitHub prioritairement par **date de création (`created_at`) décroissante** afin de toujours garantir l'installation du build le plus récent.
     - Les téléchargements depuis les dépôts privés s'effectuent via l'endpoint de l'API GitHub (`/releases/assets/{id}`) avec l'en-tête `Accept: application/octet-stream` pour éviter toute erreur 404.
