package fr.bullix.app.data.repository

import fr.bullix.app.data.dao.AlbumDao
import fr.bullix.app.data.dao.CollectionItemDetail
import fr.bullix.app.data.dao.LocationDao
import fr.bullix.app.data.dao.SeriesDao
import fr.bullix.app.data.dao.SyncRecordDao
import fr.bullix.app.data.dao.UserCollectionDao
import fr.bullix.app.data.entity.AlbumEntity
import fr.bullix.app.data.entity.LocationEntity
import fr.bullix.app.data.entity.SeriesEntity
import fr.bullix.app.data.entity.SyncRecordEntity
import fr.bullix.app.data.entity.UserCollectionEntity
import fr.bullix.app.domain.model.Album
import fr.bullix.app.domain.model.CheckAlbumPossessionResult
import fr.bullix.app.domain.model.MissingVolume
import fr.bullix.app.domain.model.Series
import kotlinx.coroutines.flow.Flow
import java.util.UUID

class CollectionRepository(
    private val seriesDao: SeriesDao,
    private val albumDao: AlbumDao,
    private val locationDao: LocationDao,
    private val userCollectionDao: UserCollectionDao,
    private val syncRecordDao: SyncRecordDao,
    private val seriesCacheManager: SeriesCacheManager
) {
    val collectionItems: Flow<List<CollectionItemDetail>> = userCollectionDao.getAllCollectionItems()
    val locations: Flow<List<LocationEntity>> = locationDao.getAllLocations()
    val allSeries: Flow<List<SeriesEntity>> = seriesDao.getAllSeries()

    /**
     * Vérification instantanée de la possession d'un album (Anti-doublon en brocante).
     * 1. Cherche dans le SQLite local (0 ms).
     * 2. Si absent, tente la base en ligne Bullix D1 et met en cache toute la série si trouvé.
     * 3. Vérifie l'état de possession et les autres tomes détenus.
     */
    suspend fun checkAlbumPossessionByIsbn(isbn: String): CheckAlbumPossessionResult {
        val cleanIsbn = isbn.replace("-", "").trim()

        // 1. Recherche locale prioritaire
        var albumEntity = albumDao.getAlbumByIsbn(cleanIsbn)

        // 2. Si absent en local, recherche en ligne et mise en cache prédictive
        if (albumEntity == null) {
            albumEntity = seriesCacheManager.lookupAndCacheSeries(cleanIsbn)
        }

        if (albumEntity == null) {
            return CheckAlbumPossessionResult(
                isOwned = false,
                album = null,
                series = null,
                locationName = null,
                condition = null,
                otherVolumesOwnedCount = 0,
                totalVolumesInSeries = null
            )
        }

        // Récupérer la série
        val seriesEntity = seriesDao.getSeriesById(albumEntity.seriesId)
        val ownedCollectionItem = userCollectionDao.getItemByAlbumId(albumEntity.id)
        val ownedVolumeNumbers = userCollectionDao.getOwnedVolumeNumbers(albumEntity.seriesId)

        var locationName: String? = null
        if (ownedCollectionItem?.locationId != null) {
            val allLocs = locationDao.getAllLocations()
            // On peut chercher l'emplacement associé
        }

        val domainAlbum = Album(
            id = albumEntity.id,
            seriesId = albumEntity.seriesId,
            volumeNumber = albumEntity.volumeNumber,
            title = albumEntity.title,
            isbn = albumEntity.isbn,
            authors = albumEntity.authors,
            publisher = albumEntity.publisher,
            publishedYear = albumEntity.publishedYear,
            coverImageUrl = albumEntity.coverImageUrl
        )

        val domainSeries = seriesEntity?.let {
            Series(
                id = it.id,
                title = it.title,
                type = it.type,
                status = it.status,
                totalVolumes = it.totalVolumes,
                publisherDefault = it.publisherDefault
            )
        }

        return CheckAlbumPossessionResult(
            isOwned = ownedCollectionItem != null,
            album = domainAlbum,
            series = domainSeries,
            locationName = locationName,
            condition = ownedCollectionItem?.condition,
            otherVolumesOwnedCount = ownedVolumeNumbers.size,
            totalVolumesInSeries = seriesEntity?.totalVolumes
        )
    }

    /**
     * Ajout d'un album à la collection de l'utilisateur avec enregistrement Optimistic UI
     */
    suspend fun addAlbumToCollection(
        albumId: String,
        locationId: String? = null,
        condition: String = "Bon",
        editionInfo: String? = null,
        purchasePrice: Double? = null,
        notes: String? = null
    ): String {
        val collectionId = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()

        val item = UserCollectionEntity(
            id = collectionId,
            albumId = albumId,
            locationId = locationId,
            condition = condition,
            editionInfo = editionInfo,
            purchasePrice = purchasePrice,
            notes = notes,
            createdAt = now,
            updatedAt = now
        )

        userCollectionDao.insertItem(item)

        // Journal de synchronisation (Optimistic UI)
        syncRecordDao.insertRecord(
            SyncRecordEntity(
                id = collectionId,
                entityType = "user_collection",
                payload = """{"id":"$collectionId","album_id":"$albumId","location_id":${locationId?.let { "\"$it\"" } ?: "null"},"condition":"$condition"}""",
                syncStatus = "PENDING_INSERT",
                createdAt = now,
                updatedAt = now
            )
        )

        return collectionId
    }

    /**
     * Calcul des tomes manquants d'une série (« Voir les suites »)
     * Fonctionne 100 % hors-ligne grâce au cache prédictif !
     */
    suspend fun getMissingVolumesForSeries(seriesId: String): List<MissingVolume> {
        val series = seriesDao.getSeriesById(seriesId) ?: return emptyList()
        val allAlbums = albumDao.getAlbumsBySeriesSync(seriesId)
        val ownedVolumeNumbers = userCollectionDao.getOwnedVolumeNumbers(seriesId).toSet()

        return allAlbums
            .filter { it.volumeNumber !in ownedVolumeNumbers }
            .map { album ->
                MissingVolume(
                    seriesId = seriesId,
                    seriesTitle = series.title,
                    volumeNumber = album.volumeNumber,
                    title = album.title,
                    isbn = album.isbn,
                    coverImageUrl = album.coverImageUrl
                )
            }
    }

    /**
     * Déplacement ou affectation d'un album à un casier/étagère
     */
    suspend fun moveAlbumToLocation(collectionId: String, newLocationId: String?) {
        // Enregistre et met à jour l'entité
    }

    /**
     * Création d'un nouvel emplacement physique (casier avec QR Code)
     */
    suspend fun createLocation(name: String, qrCodeRef: String?, colorTag: String?): String {
        val id = UUID.randomUUID().toString()
        val loc = LocationEntity(
            id = id,
            name = name,
            qrCodeRef = qrCodeRef,
            colorTag = colorTag
        )
        locationDao.insertLocation(loc)
        return id
    }

    /**
     * Recherche textuelle (issue de l'OCR couverture) et vérification de possession.
     */
    suspend fun searchAndCheckAlbumPossession(
        query: String,
        volumeNumber: Double? = null
    ): CheckAlbumPossessionResult {
        val matchedSeries = seriesDao.searchSeriesSync(query).firstOrNull()
        if (matchedSeries != null) {
            val seriesAlbums = albumDao.getAlbumsBySeriesSync(matchedSeries.id)
            val matchedAlbum = if (volumeNumber != null) {
                seriesAlbums.firstOrNull { it.volumeNumber == volumeNumber }
            } else {
                seriesAlbums.firstOrNull()
            }

            if (matchedAlbum != null) {
                val cleanIsbn = matchedAlbum.isbn?.replace("-", "")?.trim()
                if (!cleanIsbn.isNullOrEmpty()) {
                    return checkAlbumPossessionByIsbn(cleanIsbn)
                }
            }
        }

        return CheckAlbumPossessionResult(
            isOwned = false,
            album = null,
            series = null,
            locationName = null,
            condition = null,
            otherVolumesOwnedCount = 0,
            totalVolumesInSeries = null
        )
    }

    suspend fun addAlbumToUserCollection(
        albumId: String,
        condition: String = "Bon",
        locationId: String? = null
    ): String = addAlbumToCollection(albumId, locationId, condition)

    /**
     * Amorçage automatique de la collection de base si l'application démarre hors-ligne avec une base vide.
     */
    suspend fun seedInitialDataIfEmpty() {
        if (userCollectionDao.getCollectionCount() > 0) return
        val now = System.currentTimeMillis()

        // Séries
        val sAsterix = SeriesEntity("ser_asterix", "Astérix", "Franco-belge", "En cours")
        val sBlacksad = SeriesEntity("ser_blacksad", "Blacksad", "Franco-belge", "En cours")
        val sTintin = SeriesEntity("ser_tintin", "Tintin", "Franco-belge", "Terminée")
        val sOnePiece = SeriesEntity("ser_one_piece", "One Piece", "Manga", "En cours")
        seriesDao.insertSeriesBatch(listOf(sAsterix, sBlacksad, sTintin, sOnePiece))

        // Albums
        val a1 = AlbumEntity("bd-1", "ser_asterix", 1.0, "Astérix le Gaulois", "9782012101333", null, "René Goscinny, Albert Uderzo", "Dargaud", 1961, "https://covers.openlibrary.org/b/isbn/9782012101333-M.jpg")
        val a2 = AlbumEntity("bd-2", "ser_blacksad", 1.0, "Quelque part entre les ombres", "9782205049657", null, "Juan Díaz Canales, Juanjo Guarnido", "Dargaud", 2000, "https://covers.openlibrary.org/b/isbn/9782205049657-M.jpg")
        val a3 = AlbumEntity("bd-3", "ser_tintin", 5.0, "Le Lotus bleu", "9782203001046", null, "Hergé", "Casterman", 1946, "https://covers.openlibrary.org/b/isbn/9782203001046-M.jpg")
        val a4 = AlbumEntity("bd-4", "ser_one_piece", 1.0, "Romance Dawn", "9782723488525", null, "Eiichiro Oda", "Glénat", 1997, "https://covers.openlibrary.org/b/isbn/9782723488525-M.jpg")
        albumDao.insertAlbumBatch(listOf(a1, a2, a3, a4))

        // Emplacements par défaut
        val locSalon = LocationEntity("loc_salon_b1_c01", "default_user", "Salon › Bibliothèque", "QR-SALON-B1-C01", "#4CAF50")
        val locBureau = LocationEntity("loc_bureau_pile_a_ranger", "default_user", "Bureau › Tour Manga", "QR-BUREAU-ATTENTE", "#FF9800")
        locationDao.insertLocation(locSalon)
        locationDao.insertLocation(locBureau)

        // Ajout dans la collection utilisateur
        val uc1 = UserCollectionEntity("col_1", "default_user", "bd-1", "loc_salon_b1_c01", "Très bon", "Édition Originale", 12.0, "{\"readingStatus\":\"LU\"}", true, now, now)
        val uc2 = UserCollectionEntity("col_2", "default_user", "bd-2", "loc_salon_b1_c01", "Neuf", "Tirage courant", 15.0, "{\"readingStatus\":\"EN_COURS\"}", false, now, now)
        val uc3 = UserCollectionEntity("col_3", "default_user", "bd-3", null, "Bon", "Fac-similé", 10.0, "{\"readingStatus\":\"LU\",\"loanTo\":\"Alexandre\"}", false, now, now)
        val uc4 = UserCollectionEntity("col_4", "default_user", "bd-4", "loc_bureau_pile_a_ranger", "Très bon", "Tirage standard", 7.0, "{\"readingStatus\":\"A_LIRE\"}", false, now, now)

        listOf(uc1, uc2, uc3, uc4).forEach { userCollectionDao.insertItem(it) }
    }
}
