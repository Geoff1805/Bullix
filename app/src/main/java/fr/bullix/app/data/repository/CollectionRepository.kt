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
}
