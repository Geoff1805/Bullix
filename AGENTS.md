# Bullix — Règles Projet
> Hérite de `~/.gemini/config/AGENTS.md` et `PROJECTS_CACHE.md`.
- **Signature APK** : Debug & Release signés via Keystore persistant (màj in-place).
- **Versioning SSoT (`version.properties`)** : `versionCode` séquentiel et `versionName` SemVer lus dynamiquement (`VERSION_NAME`, `VERSION_CODE`), 0 version en dur.
- **Traçabilité** : Incréments consignés dans `BACKLOG.md` + tag/release GitHub `vX.Y.Z` (`Bullix-v<versionName>.apk`).
- **Stack** : KMP + Compose M3, Room KMP SQLite, 100% local offline-first + sync Cloudflare Pages/D1.
