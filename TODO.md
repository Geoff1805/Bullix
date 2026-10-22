# TODO & Feuilles de Route — Bullix

> **Note d'Architecture (Règle 16)** : À traiter **au fil de l'eau** lors des prochaines mises à jour fonctionnelles de l'application.

## 🛠️ Améliorations de Stack & Qualité (À intégrer à la prochaine MAJ)
- [ ] **Analyse Statique Kotlin** : Ajouter le plugin `ktlint` dans `build.gradle.kts` (`./gradlew ktlintCheck`).
- [ ] **Diagnostic Debug** : Intégrer `chucker:4.1.0` (logs HTTP Ktor) et `leakcanary:2.14` (fuites mémoire Compose) en `debugImplementation`.
- [ ] **Observabilité Production** : Intégrer Sentry SDK (`io.sentry:sentry-android`) en Free Tier.
- [ ] **Validation R8 Full Mode** : Vérifier la compilation release R8 Full Mode avec sortie normalisée brute `build-artifacts/Bullix.apk` sans ZIP.
- [ ] **Optimisation Scanner ML Kit** : Vérifier le débouncing et le fallback de résolution hors-ligne sur le scan code-barres.
- [ ] **Cible iOS** : Valider la compilation du framework KMP partagé sur le runner macOS GitHub Actions.
