# 🚀 Guide de Déploiement Cloudflare & Procédure Windows — Bullix

Ce guide détaille pas à pas la configuration, le déploiement sur **Cloudflare Pages**, l'initialisation de la base **Cloudflare D1** et la configuration CI/CD pour un environnement **Windows**.

---

## 📌 1. Contexte Windows et Java 8 (v503)

### Pourquoi Java 8 ne peut pas exécuter Gradle ou Cloudflare localement ?
- **Compilation Android** : Le projet Bullix utilise **Android Gradle Plugin 9.x** et **Gradle 9.3.1**, qui exigent **Java 17 minimum**. Java 8 (`1.8.0_503`) provoquera une erreur d'incompatibilité de bytecode (`Unsupported class file major version`).
- **Cloudflare (Pages / D1 / Workers)** : Les outils Cloudflare reposent sur **Node.js** (JavaScript/TypeScript), et non sur Java.

### La solution : Zéro contrainte grâce à GitHub Actions
Vous n'avez **rien besoin d'installer de lourd sur votre PC Windows** (ni Android Studio, ni SDK Android, ni Java 17) :
1. Chaque push sur GitHub déclenche le workflow `.github/workflows/android.yml`.
2. Les serveurs GitHub (équipés de Java 17 et Gradle 9) exécutent les tests unitaires et compilent l'application.
3. L'APK Android (`bullix-debug-apk`) est **généré automatiquement** et téléchargeable en 1 clic dans l'onglet **Actions** de votre dépôt GitHub.

---

## ☁️ 2. Déploiement sur Cloudflare Pages

Vous avez le choix entre **deux approches** : l'interface web Cloudflare (100 % sans installer d'outils) ou les commandes en terminal.

### Méthode A — 100 % Interface Web Cloudflare (Recommandée sous Windows)

#### Étape 1 : Créer la base de données D1 (Juridiction EU)
1. Rendez-vous sur le [Tableau de bord Cloudflare](https://dash.cloudflare.com/).
2. Dans le menu de gauche, allez dans **Stockage et bases de données** > **D1 SQL Database**.
3. Cliquez sur **Créer une base de données**, nommez-la `bullix-db` :
   - **Emplacement géographique (Location hint)** : Choisissez **Europe de l'Ouest (Western Europe — `weur`)** pour garantir la souveraineté des données et la conformité RGPD.
   - Validez la création.
4. Notez l'**ID de la base de données** généré (ex: `xxxx-xxxx-xxxx`).
5. Cliquez sur l'onglet **Console** de votre base `bullix-db`, collez le contenu du fichier [`schema.sql`](file:///g:/Mon%20Drive/05_Dev/Bullix/schema.sql) et cliquez sur **Exécuter** pour initialiser les tables (`series`, `albums`, `user_collections`, `locations`, `sync_records`).

#### Étape 2 : Créer le KV (Cache) et le bucket R2 (Images) en Juridiction EU
1. Dans le menu **Stockage et bases de données** :
   - Allez dans **KV** > **Créer un espace de noms** > Nom : `CACHE_KV`.
   - Allez dans **R2** > **Créer un bucket** > Nom : `bullix-images` :
     - **Juridiction (Jurisdiction)** : Sélectionnez **Union européenne (EU)**. Cloudflare garantit alors le stockage et le traitement physique de tous les scans et visuels sur le sol de l'UE.

#### Étape 3 : Créer et lier le projet Cloudflare Pages
1. Allez dans **Workers et Pages** > **Créer une application** > onglet **Pages** > **Se connecter à Git**.
2. Sélectionnez votre dépôt GitHub `Geoff1805/Bullix` et la branche `main`.
3. Paramètres de configuration du build :
   - **Préréglage de configuration (Build preset)** : `None`
   - **Commande de génération (Build command)** : **LAISSER VIDE** (ne rien écrire, ou `npm run build` ; **attention : ne pas écrire `web` ici !**)
   - **Répertoire de sortie de génération (Build output directory)** : `web`
   - **Répertoire racine (Root directory)** : `/`
4. Cliquez sur **Enregistrer et déployer**. Cloudflare Pages déploie immédiatement le site statique et connecte automatiquement le dossier `functions/` comme API Edge.

> ⚠️ **Erreur fréquente `/bin/sh: 1: web: not found` (Code 127)** :
> Si vous avez saisi `web` dans le champ **Commande de génération (Build command)**, Cloudflare tente d'exécuter `web` comme une commande Linux.
> **Correction** : Allez dans le projet Pages > **Paramètres** > **Générations et déploiements** > **Modifier la configuration** > vider le champ **Commande de génération** (le laisser complètement vide) > **Enregistrer** > relancer le déploiement.

> ⚠️ **Erreur `8000022: Invalid KV namespace ID` ou `Invalid D1 database ID`** :
> Si `wrangler.toml` contient des identifiants temporaires non renseignés (*placeholders*), Cloudflare Pages bloque la publication des Functions.
> Les liaisons D1, KV et R2 doivent être configurées via l'interface web (Étape 4 ci-dessous) ou avec de véritables identifiants dans `wrangler.toml`.

#### Étape 4 : Lier les ressources (Bindings D1, KV, R2)
1. Dans votre projet Pages, allez dans l'onglet **Paramètres** > **Fonctions**.
2. Descendez jusqu'à **Liaisons de base de données D1** (D1 database bindings) :
   - Nom de variable : `DB`
   - Base D1 : Sélectionnez `bullix-db`
3. Descendez à **Liaisons d'espace de noms KV** :
   - Nom de variable : `CACHE_KV`
   - Espace de noms : Sélectionnez `CACHE_KV`
4. Descendez à **Liaisons de bucket R2** :
   - Nom de variable : `IMAGES_BUCKET`
   - Bucket : Sélectionnez `bullix-images`
5. Cliquez sur **Enregistrer**. Vos Cloudflare Pages Functions sont désormais opérationnelles et reliées à votre base de données !

---

### Méthode B — En ligne de commande sous Windows (Wrangler)

Si vous souhaitez exécuter les déploiements et commandes en terminal depuis PowerShell :

1. **Installer Node.js LTS sous Windows** (dans un PowerShell administrateur) :
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
   *Fermez et rouvrez votre terminal après l'installation.*

2. **Se connecter à Cloudflare** :
   ```powershell
   npx wrangler login
   ```

3. **Créer la base D1 et le stockage R2 en Juridiction EU** :
   ```powershell
   # Base D1 hébergée en Europe de l'Ouest
   npx wrangler d1 create bullix-db --location=weur
   # Appliquer le schéma de données
   npx wrangler d1 execute bullix-db --file=./schema.sql

   # Namespace KV pour le cache
   npx wrangler kv:namespace create CACHE_KV

   # Bucket R2 restreint à la juridiction Union Européenne
   npx wrangler r2 bucket create bullix-images --jurisdiction eu
   ```

4. **Déployer le site et les fonctions** :
   ```powershell
   npx wrangler pages deploy web --project-name=bullix
   ```

---

## 🛡️ 3. Automatisation CI/CD, Dependabot & Sécurité

### Téléchargement de l'APK généré automatiquement
1. Rendez-vous sur votre dépôt : `https://github.com/Geoff1805/Bullix/actions`.
2. Cliquez sur le dernier workflow réussi intitulé **Android CI & Build APK**.
3. Dans la section **Artifacts** en bas de page, cliquez sur **`bullix-debug-apk`** pour télécharger votre application Android prête à installer.

### Dependabot & Dependency Scanning
- **Dependabot** : Configuré dans [`.github/dependabot.yml`](file:///g:/Mon%20Drive/05_Dev/Bullix/.github/dependabot.yml), il surveille chaque semaine les mises à jour des dépendances Android/Gradle (`gradle/libs.versions.toml`), des paquets npm (`package.json`) et des actions GitHub.
- **Dependency Review** : Le workflow [`.github/workflows/dependency-scanning.yml`](file:///g:/Mon%20Drive/05_Dev/Bullix/.github/workflows/dependency-scanning.yml) analyse automatiquement toute Pull Request et bloque les dépendances vulnérables ou de sévérité élevée.
