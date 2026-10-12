package fr.bullix.app.data.repository

import android.util.Log
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import fr.bullix.app.BuildConfig
import fr.bullix.app.data.dao.AlbumDao
import fr.bullix.app.data.dao.SeriesDao
import fr.bullix.app.data.entity.AlbumEntity
import fr.bullix.app.data.entity.SeriesEntity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class SeriesCacheManager(
    private val seriesDao: SeriesDao,
    private val albumDao: AlbumDao
) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    private val moshi = Moshi.Builder()
        .addLast(KotlinJsonAdapterFactory())
        .build()

    /**
     * Recherche en ligne d'un ISBN sur notre base Bullix D1.
     * Dès que l'album est trouvé, toute la série et tous ses tomes sont mis en cache localement.
     */
    suspend fun lookupAndCacheSeries(isbn: String): AlbumEntity? = withContext(Dispatchers.IO) {
        val cleanIsbn = isbn.replace("-", "").trim()
        val url = "${BuildConfig.BULLIX_API_URL}/api/lookup/isbn?isbn=$cleanIsbn"

        try {
            val request = Request.Builder().url(url).build()
            val response = client.newCall(request).execute()

            if (!response.isSuccessful) {
                Log.d("SeriesCacheManager", "Album non trouvé sur le serveur pour ISBN: $cleanIsbn")
                return@withContext null
            }

            val body = response.body?.string() ?: return@withContext null
            val jsonAdapter = moshi.adapter(LookupResponseDto::class.java)
            val lookupResult = jsonAdapter.fromJson(body) ?: return@withContext null

            // 1. Sauvegarde / mise en cache locale de la série
            lookupResult.series?.let { s ->
                val seriesEntity = SeriesEntity(
                    id = s.id,
                    title = s.title,
                    type = s.type ?: "Franco-belge",
                    status = s.status ?: "En cours",
                    totalVolumes = s.total_volumes
                )
                seriesDao.insertSeries(seriesEntity)
                Log.i("SeriesCacheManager", "🔥 Série mise en cache local : ${s.title}")
            }

            // 2. Sauvegarde / mise en cache locale de TOUS les tomes de la série
            val albumEntities = lookupResult.series_albums.map { a ->
                AlbumEntity(
                    id = a.id,
                    seriesId = a.series_id,
                    volumeNumber = a.volume_number,
                    title = a.title,
                    isbn = a.isbn,
                    authors = a.authors,
                    publisher = a.publisher,
                    publishedYear = a.published_year,
                    coverImageUrl = a.cover_image_url
                )
            }

            if (albumEntities.isNotEmpty()) {
                albumDao.insertAlbumBatch(albumEntities)
                Log.i("SeriesCacheManager", "🔥 ${albumEntities.size} tomes mis en cache locale pour la série ${lookupResult.series?.title}")
            }

            // Retourner l'album recherché
            val targetAlbum = lookupResult.album
            if (targetAlbum != null) {
                AlbumEntity(
                    id = targetAlbum.id,
                    seriesId = targetAlbum.series_id,
                    volumeNumber = targetAlbum.volume_number,
                    title = targetAlbum.title,
                    isbn = targetAlbum.isbn,
                    authors = targetAlbum.authors,
                    publisher = targetAlbum.publisher,
                    publishedYear = targetAlbum.published_year,
                    coverImageUrl = targetAlbum.cover_image_url
                )
            } else {
                albumEntities.firstOrNull { it.isbn == cleanIsbn }
            }
        } catch (e: Exception) {
            Log.e("SeriesCacheManager", "Erreur lors du lookup réseau : ${e.message}")
            null
        }
    }

    /**
     * Rapatriement forcé de toute une série par son seriesId
     */
    suspend fun cacheSeriesById(seriesId: String): Boolean = withContext(Dispatchers.IO) {
        val url = "${BuildConfig.BULLIX_API_URL}/api/series/cache?series_id=$seriesId"
        try {
            val request = Request.Builder().url(url).build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) return@withContext false

            val body = response.body?.string() ?: return@withContext false
            val jsonAdapter = moshi.adapter(SeriesCacheResponseDto::class.java)
            val result = jsonAdapter.fromJson(body) ?: return@withContext false

            result.series?.let { s ->
                seriesDao.insertSeries(
                    SeriesEntity(
                        id = s.id,
                        title = s.title,
                        type = s.type ?: "Franco-belge",
                        status = s.status ?: "En cours",
                        totalVolumes = s.total_volumes
                    )
                )
            }

            val albumEntities = result.albums.map { a ->
                AlbumEntity(
                    id = a.id,
                    seriesId = a.series_id,
                    volumeNumber = a.volume_number,
                    title = a.title,
                    isbn = a.isbn,
                    authors = a.authors,
                    publisher = a.publisher,
                    publishedYear = a.published_year,
                    coverImageUrl = a.cover_image_url
                )
            }
            albumDao.insertAlbumBatch(albumEntities)
            true
        } catch (e: Exception) {
            Log.e("SeriesCacheManager", "Erreur cacheSeriesById : ${e.message}")
            false
        }
    }
}

// DTOs de désérialisation
data class LookupResponseDto(
    val source: String?,
    val album: AlbumDto?,
    val series: SeriesDto?,
    val series_albums: List<AlbumDto> = emptyList()
)

data class SeriesCacheResponseDto(
    val series: SeriesDto?,
    val albums: List<AlbumDto> = emptyList(),
    val count: Int = 0
)

data class SeriesDto(
    val id: String,
    val title: String,
    val type: String?,
    val status: String?,
    val total_volumes: Int?
)

data class AlbumDto(
    val id: String,
    val series_id: String,
    val volume_number: Double,
    val title: String?,
    val isbn: String?,
    val authors: String?,
    val publisher: String?,
    val published_year: Int?,
    val cover_image_url: String?
)
