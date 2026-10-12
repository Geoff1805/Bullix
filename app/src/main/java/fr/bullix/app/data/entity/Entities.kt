package fr.bullix.app.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey

@Entity(
    tableName = "series",
    indices = [
        Index(value = ["title"]),
        Index(value = ["updated_at"])
    ]
)
data class SeriesEntity(
    @PrimaryKey
    val id: String,
    val title: String,
    val type: String = "Franco-belge", // "Franco-belge", "Manga", "Comics", "Autre"
    val status: String = "En cours",  // "En cours", "Terminée", "Abandonnée", "Inconnue"
    @ColumnInfo(name = "total_volumes")
    val totalVolumes: Int? = null,
    @ColumnInfo(name = "publisher_default")
    val publisherDefault: String? = null,
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null
)

@Entity(
    tableName = "albums",
    foreignKeys = [
        ForeignKey(
            entity = SeriesEntity::class,
            parentColumns = ["id"],
            childColumns = ["series_id"],
            onDelete = ForeignKey.CASCADE
        )
    ],
    indices = [
        Index(value = ["isbn"]),
        Index(value = ["series_id", "volume_number"]),
        Index(value = ["updated_at"])
    ]
)
data class AlbumEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "series_id")
    val seriesId: String,
    @ColumnInfo(name = "volume_number")
    val volumeNumber: Double,
    val title: String?,
    val isbn: String? = null,
    val upc: String? = null,
    val authors: String? = null,
    val publisher: String? = null,
    @ColumnInfo(name = "published_year")
    val publishedYear: Int? = null,
    @ColumnInfo(name = "cover_image_url")
    val coverImageUrl: String? = null,
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null
)

@Entity(
    tableName = "locations",
    indices = [
        Index(value = ["user_id"]),
        Index(value = ["qr_code_ref"], unique = true),
        Index(value = ["updated_at"])
    ]
)
data class LocationEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "user_id")
    val userId: String = "default_user",
    val name: String, // Ex: "Salon › Bibliothèque Est › Casier 12"
    @ColumnInfo(name = "qr_code_ref")
    val qrCodeRef: String? = null,
    @ColumnInfo(name = "color_tag")
    val colorTag: String? = null,
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null
)

@Entity(
    tableName = "user_collection",
    foreignKeys = [
        ForeignKey(
            entity = AlbumEntity::class,
            parentColumns = ["id"],
            childColumns = ["album_id"],
            onDelete = ForeignKey.RESTRICT
        ),
        ForeignKey(
            entity = LocationEntity::class,
            parentColumns = ["id"],
            childColumns = ["location_id"],
            onDelete = ForeignKey.SET_NULL
        )
    ],
    indices = [
        Index(value = ["user_id"]),
        Index(value = ["album_id"]),
        Index(value = ["location_id"]),
        Index(value = ["updated_at"])
    ]
)
data class UserCollectionEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "user_id")
    val userId: String = "default_user",
    @ColumnInfo(name = "album_id")
    val albumId: String,
    @ColumnInfo(name = "location_id")
    val locationId: String? = null,
    val condition: String = "Bon", // "Neuf", "Très bon", "Bon", "Passable", "Mauvais", "Lu"
    @ColumnInfo(name = "edition_info")
    val editionInfo: String? = null,
    @ColumnInfo(name = "purchase_price")
    val purchasePrice: Double? = null,
    @ColumnInfo(name = "purchase_date")
    val purchaseDate: String? = null,
    val notes: String? = null,
    @ColumnInfo(name = "is_favorite")
    val isFavorite: Boolean = false,
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null
)

@Entity(
    tableName = "sync_records",
    indices = [
        Index(value = ["updated_at"]),
        Index(value = ["sync_status"])
    ]
)
data class SyncRecordEntity(
    @PrimaryKey
    val id: String,
    @ColumnInfo(name = "user_id")
    val userId: String = "default_user",
    @ColumnInfo(name = "entity_type")
    val entityType: String, // "series", "album", "location", "user_collection"
    val payload: String, // JSON de l'entité
    @ColumnInfo(name = "sync_status")
    val syncStatus: String = "PENDING_INSERT", // "SYNCED", "PENDING_INSERT", "PENDING_UPDATE", "PENDING_DELETE"
    @ColumnInfo(name = "created_at")
    val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "updated_at")
    val updatedAt: Long = System.currentTimeMillis(),
    @ColumnInfo(name = "deleted_at")
    val deletedAt: Long? = null
)
