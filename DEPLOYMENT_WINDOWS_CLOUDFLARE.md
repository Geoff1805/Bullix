# 🚀 Guide de Déploiement Cloudflare & Procédure Windows — Bullix

Ce guide détaille pas à pas la configuration, le déploiement sur **Cloudflare Pages**, l'initialisation de la base **Cloudflare D1** et l'import des données de scraping pour un environnement **Windows**.

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

#### Étape 1 : Créer la base de données D1
1. Rendez-vous sur le [Tableau de bord Cloudflare](https://dash.cloudflare.com/).
2. Dans le menu de gauche, allez dans **Stockage et bases de données** > **D1 SQL Database**.
3. Cliquez sur **Créer une base de données**, nommez-la `bullix-db` et validez.
4. Notez l'**ID de la base de données** généré (ex: `xxxx-xxxx-xxxx`).
5. Cliquez sur l'onglet **Console** de votre base `bullix-db`, collez le contenu du fichier [`schema.sql`](file:///g:/Mon%20Drive/05_Dev/Bullix/schema.sql) et cliquez sur **Exécuter** pour initialiser les tables (`series`, `albums`, `user_collections`, `locations`, `sync_records`).

#### Étape 2 : Créer le KV (Cache) et le bucket R2 (Images)
1. Dans le menu **Stockage et bases de données** :
   - Allez dans **KV** > **Créer un espace de noms** > Nom : `CACHE_KV`.
   - Allez dans **R2** > **Créer un bucket** > Nom : `bullix-images`.

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

3. **Créer la base D1 et appliquer le schéma** :
   ```powershell
   npx wrangler d1 create bullix-db
   # Copiez l'identifiant 'database_id' obtenu dans wrangler.toml
   npx wrangler d1 execute bullix-db --file=./schema.sql
   ```

4. **Déployer le site et les fonctions** :
   ```powershell
   npx wrangler pages deploy web --project-name=bullix
   ```

---

## 📦 3. Import des Données de Scraping (BDthèque & BDvore)

Le script [`scripts/seeding/import_seed.ts`](file:///g:/Mon%20Drive/05_Dev/Bullix/scripts/seeding/import_seed.ts) convertit automatiquement les catalogues de BD au format JSON en requêtes SQL compatibles Cloudflare D1.

### Format JSON attendu pour le scraping
Un exemple type est disponible dans [`scripts/seeding/sample_scraped_data.json`](file:///g:/Mon%20Drive/05_Dev/Bullix/scripts/seeding/sample_scraped_data.json) :
```json
[
  {
    "id": "series_tintin",
    "title": "Les Aventures de Tintin",
    "type": "Franco-belge",
    "status": "Terminée",
    "total_volumes": 24,
    "publisher_default": "Casterman",
    "albums": [
      {
        "id": "alb_tin_01",
        "volume_number": 1,
        "title": "Tintin au pays des Soviets",
        "isbn": "9782203001007",
        "upc": null,
        "authors": "Hergé",
        "publisher": "Casterman",
        "published_year": 1930,
        "cover_image_url": "https://covers.openlibrary.org/b/isbn/9782203001007-L.jpg"
      }
    ]
  }
]
```

### Génération du fichier SQL Batch & Injection D1
1. **Générer le script SQL à partir de votre export JSON** :
   ```powershell
   npx tsx scripts/seeding/import_seed.ts scripts/seeding/sample_scraped_data.json scripts/seeding/generated_seed.sql
   ```
2. **Injecter dans Cloudflare D1** :
   - **En ligne de commande** :
     ```powershell
     npx wrangler d1 execute bullix-db --file=./scripts/seeding/generated_seed.sql
     ```
   - **Ou via l'interface web Cloudflare** :
     Ouvrez le fichier `generated_seed.sql`, copiez son texte, collez-le dans la console SQL de votre base `bullix-db` sur le tableau de bord Cloudflare et cliquez sur **Exécuter**.

---

## 🛡️ 4. Automatisation CI/CD, Dependabot & Sécurité

### Téléchargement de l'APK généré automatiquement
1. Rendez-vous sur votre dépôt : `https://github.com/Geoff1805/Bullix/actions`.
2. Cliquez sur le dernier workflow réussi intitulé **Android CI & Build APK**.
3. Dans la section **Artifacts** en bas de page, cliquez sur **`bullix-debug-apk`** pour télécharger votre application Android prête à installer.

### Dependabot & Dependency Scanning
- **Dependabot** : Configuré dans [`.github/dependabot.yml`](file:///g:/Mon%20Drive/05_Dev/Bullix/.github/dependabot.yml), il surveille chaque semaine les mises à jour des dépendances Android/Gradle (`gradle/libs.versions.toml`), des paquets npm (`package.json`) et des actions GitHub.
- **Dependency Review** : Le workflow [`.github/workflows/dependency-scanning.yml`](file:///g:/Mon%20Drive/05_Dev/Bullix/.github/workflows/dependency-scanning.yml) analyse automatiquement toute Pull Request et bloque les dépendances vulnérables ou de sévérité élevée.
