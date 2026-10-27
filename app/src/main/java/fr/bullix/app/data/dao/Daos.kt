package fr.bullix.app.data.dao

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import fr.bullix.app.data.entity.AlbumEntity
import fr.bullix.app.data.entity.LocationEntity
import fr.bullix.app.data.entity.SeriesEntity
import fr.bullix.app.data.entity.SyncRecordEntity
import fr.bullix.app.data.entity.UserCollectionEntity
import kotlinx.coroutines.flow.Flow

// Modèle de projection pour l'affichage complet de la collection
data class CollectionItemDetail(
    val collectionId: String,
    val albumId: String,
    val seriesId: String,
    val seriesTitle: String,
    val seriesType: String,
    val volumeNumber: Double,
    val albumTitle: String?,
    val isbn: String?,
    val authors: String?,
    val publisher: String?,
    val publishedYear: Int?,
    val coverImageUrl: String?,
    val locationId: String?,
    val locationName: String?,
    val condition: String,
    val editionInfo: String?,
    val isFavorite: Boolean,
    val addedAt: Long
)

@Dao
interface SeriesDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSeries(series: SeriesEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSeriesBatch(seriesList: List<SeriesEntity>)

    @Query("SELECT * FROM series WHERE id = :id AND deleted_at IS NULL LIMIT 1")
    suspend fun getSeriesById(id: String): SeriesEntity?

    @Query("SELECT * FROM series WHERE deleted_at IS NULL ORDER BY title ASC")
    fun getAllSeries(): Flow<List<SeriesEntity>>

    @Query("SELECT * FROM series WHERE title LIKE '%' || :query || '%' AND deleted_at IS NULL ORDER BY title ASC")
    fun searchSeries(query: String): Flow<List<SeriesEntity>>

    @Query("SELECT * FROM series WHERE title LIKE '%' || :query || '%' AND deleted_at IS NULL ORDER BY title ASC")
    suspend fun searchSeriesSync(query: String): List<SeriesEntity>
}

@Dao
interface AlbumDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAlbum(album: AlbumEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertAlbumBatch(albums: List<AlbumEntity>)

    @Query("SELECT * FROM albums WHERE isbn = :isbn AND deleted_at IS NULL LIMIT 1")
    suspend fun getAlbumByIsbn(isbn: String): AlbumEntity?

    @Query("SELECT * FROM albums WHERE id = :id AND deleted_at IS NULL LIMIT 1")
    suspend fun getAlbumById(id: String): AlbumEntity?

    @Query("SELECT * FROM albums WHERE series_id = :seriesId AND deleted_at IS NULL ORDER BY volume_number ASC")
    fun getAlbumsBySeries(seriesId: String): Flow<List<AlbumEntity>>

    @Query("SELECT * FROM albums WHERE series_id = :seriesId AND deleted_at IS NULL ORDER BY volume_number ASC")
    suspend fun getAlbumsBySeriesSync(seriesId: String): List<AlbumEntity>

    @Query("SELECT * FROM albums WHERE (title LIKE '%' || :query || '%' OR isbn = :query) AND deleted_at IS NULL LIMIT 20")
    fun searchAlbums(query: String): Flow<List<AlbumEntity>>
}

@Dao
interface LocationDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLocation(location: LocationEntity)

    @Query("SELECT * FROM locations WHERE deleted_at IS NULL ORDER BY name ASC")
    fun getAllLocations(): Flow<List<LocationEntity>>

    @Query("SELECT * FROM locations WHERE id = :id AND deleted_at IS NULL LIMIT 1")
    suspend fun getLocationById(id: String): LocationEntity?

    @Query("SELECT * FROM locations WHERE qr_code_ref = :qrCode AND deleted_at IS NULL LIMIT 1")
    suspend fun getLocationByQr(qrCode: String): LocationEntity?

    @Query("DELETE FROM locations WHERE id = :id")
    suspend fun deleteLocation(id: String)
}

@Dao
interface UserCollectionDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertItem(item: UserCollectionEntity)

    @Update
    suspend fun updateItem(item: UserCollectionEntity)

    @Query("SELECT * FROM user_collection WHERE album_id = :albumId AND deleted_at IS NULL LIMIT 1")
    suspend fun getItemByAlbumId(albumId: String): UserCollectionEntity?

    @Query("""
        SELECT 
            c.id AS collectionId,
            c.album_id AS albumId,
            COALESCE(s.id, a.series_id, 'ser_misc') AS seriesId,
            COALESCE(s.title, 'Sans série') AS seriesTitle,
            COALESCE(s.type, 'Franco-belge') AS seriesType,
            COALESCE(a.volume_number, 1.0) AS volumeNumber,
            COALESCE(a.title, 'Album ' || c.album_id) AS albumTitle,
            a.isbn AS isbn,
            a.authors AS authors,
            a.publisher AS publisher,
            a.published_year AS publishedYear,
            a.cover_image_url AS coverImageUrl,
            l.id AS locationId,
            l.name AS locationName,
            c.condition AS condition,
            c.edition_info AS editionInfo,
            c.is_favorite AS isFavorite,
            c.created_at AS addedAt
        FROM user_collection c
        LEFT JOIN albums a ON c.album_id = a.id
        LEFT JOIN series s ON a.series_id = s.id
        LEFT JOIN locations l ON c.location_id = l.id
        WHERE c.deleted_at IS NULL
        ORDER BY COALESCE(s.title, 'Sans série') ASC, COALESCE(a.volume_number, 1.0) ASC
    """)
    fun getAllCollectionItems(): Flow<List<CollectionItemDetail>>

    @Query("""
        SELECT 
            c.id AS collectionId,
            c.album_id AS albumId,
            COALESCE(s.id, a.series_id, 'ser_misc') AS seriesId,
            COALESCE(s.title, 'Sans série') AS seriesTitle,
            COALESCE(s.type, 'Franco-belge') AS seriesType,
            COALESCE(a.volume_number, 1.0) AS volumeNumber,
            COALESCE(a.title, 'Album ' || c.album_id) AS albumTitle,
            a.isbn AS isbn,
            a.authors AS authors,
            a.publisher AS publisher,
            a.published_year AS publishedYear,
            a.cover_image_url AS coverImageUrl,
            l.id AS locationId,
            l.name AS locationName,
            c.condition AS condition,
            c.edition_info AS editionInfo,
            c.is_favorite AS isFavorite,
            c.created_at AS addedAt
        FROM user_collection c
        LEFT JOIN albums a ON c.album_id = a.id
        LEFT JOIN series s ON a.series_id = s.id
        LEFT JOIN locations l ON c.location_id = l.id
        WHERE c.location_id = :locationId AND c.deleted_at IS NULL
        ORDER BY COALESCE(a.volume_number, 1.0) ASC
    """)
    fun getCollectionItemsByLocation(locationId: String): Flow<List<CollectionItemDetail>>

    @Query("""
        SELECT a.volume_number 
        FROM user_collection c
        INNER JOIN albums a ON c.album_id = a.id
        WHERE a.series_id = :seriesId AND c.deleted_at IS NULL
    """)
    suspend fun getOwnedVolumeNumbers(seriesId: String): List<Double>

    @Query("SELECT COUNT(*) FROM user_collection WHERE deleted_at IS NULL")
    suspend fun getCollectionCount(): Int

    @Query("DELETE FROM user_collection WHERE id = :id")
    suspend fun deleteItem(id: String)
}

@Dao
interface SyncRecordDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertRecord(record: SyncRecordEntity)

    @Query("SELECT * FROM sync_records WHERE sync_status != 'SYNCED' ORDER BY created_at ASC")
    suspend fun getPendingRecords(): List<SyncRecordEntity>

    @Query("UPDATE sync_records SET sync_status = 'SYNCED' WHERE id IN (:ids)")
    suspend fun markAsSynced(ids: List<String>)
}
