package fr.bullix.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import fr.bullix.app.BuildConfig
import fr.bullix.app.data.BullixDatabase
import fr.bullix.app.data.entity.LocationEntity
import fr.bullix.app.data.entity.UserCollectionEntity
import fr.bullix.app.data.repository.SeriesCacheManager
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

class SyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    private val db = BullixDatabase.getDatabase(appContext)
    private val syncRecordDao = db.syncRecordDao()
    private val userCollectionDao = db.userCollectionDao()
    private val albumDao = db.albumDao()
    private val seriesDao = db.seriesDao()
    private val locationDao = db.locationDao()
    private val seriesCacheManager = SeriesCacheManager(seriesDao, albumDao)

    private val prefs = appContext.getSharedPreferences("bullix_sync_prefs", Context.MODE_PRIVATE)

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val moshi = Moshi.Builder()
        .addLast(KotlinJsonAdapterFactory())
        .build()

    override suspend fun doWork(): Result {
        return try {
            val apiUrl = BuildConfig.BULLIX_API_URL.ifEmpty { "https://api.bullix.app" }

            // =========================================================================
            // ÉTAPE 1 : PUSH (Envoi des modifications locales vers Cloudflare D1)
            // =========================================================================
            val pendingRecords = syncRecordDao.getPendingRecords()
            if (pendingRecords.isNotEmpty()) {
                Log.i("SyncWorker", "Push de ${pendingRecords.size} enregistrements vers Cloudflare ($apiUrl)...")

                val pushPayload = mapOf(
                    "user_id" to "default_user",
                    "records" to pendingRecords.map {
                        mapOf(
                            "id" to it.id,
                            "user_id" to it.userId,
                            "entity_type" to it.entityType,
                            "payload" to it.payload,
                            "updated_at" to it.updatedAt,
                            "deleted_at" to it.deletedAt
                        )
                    }
                )

                val jsonAdapter = moshi.adapter(Map::class.java)
                val jsonBody = jsonAdapter.toJson(pushPayload)

                val request = Request.Builder()
                    .url("$apiUrl/api/sync/push")
                    .post(jsonBody.toRequestBody("application/json".toMediaType()))
                    .build()

                val response = client.newCall(request).execute()
                if (response.isSuccessful) {
                    val acknowledgedIds = pendingRecords.map { it.id }
                    syncRecordDao.markAsSynced(acknowledgedIds)
                    Log.i("SyncWorker", "✅ Push réussi : ${acknowledgedIds.size} enregistrements confirmés.")
                } else {
                    Log.w("SyncWorker", "Avertissement : Échec partiel du push (HTTP ${response.code})")
                }
            }

            // =========================================================================
            // ÉTAPE 2 : PULL (Récupération des ajouts faits depuis le web ou autre terminal)
            // =========================================================================
            val lastSyncTime = prefs.getLong("last_sync_timestamp", 0L)
            Log.i("SyncWorker", "Pull des mises à jour distantes depuis $lastSyncTime...")

            val pullRequest = Request.Builder()
                .url("$apiUrl/api/sync/pull?user_id=default_user&since=$lastSyncTime")
                .get()
                .build()

            val pullResponse = client.newCall(pullRequest).execute()
            if (pullResponse.isSuccessful) {
                val pullBody = pullResponse.body?.string()
                if (!pullBody.isNullOrEmpty()) {
                    val mapAdapter = moshi.adapter(Map::class.java)
                    val result = mapAdapter.fromJson(pullBody)

                    val records = result?.get("records") as? List<Map<String, Any?>>
                    val serverTimestamp = (result?.get("server_timestamp") as? Number)?.toLong() ?: System.currentTimeMillis()

                    if (!records.isNullOrEmpty()) {
                        Log.i("SyncWorker", "📥 Réception de ${records.size} enregistrements depuis Cloudflare...")

                        for (rec in records) {
                            val id = rec["id"] as? String ?: continue
                            val entityType = rec["entity_type"] as? String ?: continue
                            val payloadStr = rec["payload"] as? String ?: continue
                            val deletedAt = (rec["deleted_at"] as? Number)?.toLong()
                            val updatedAt = (rec["updated_at"] as? Number)?.toLong() ?: System.currentTimeMillis()

                            val payloadMap = try {
                                mapAdapter.fromJson(payloadStr) as? Map<String, Any?>
                            } catch (e: Exception) {
                                null
                            }

                            if (entityType == "user_collection") {
                                if (deletedAt != null) {
                                    userCollectionDao.deleteItem(id)
                                    Log.d("SyncWorker", "🗑 Suppression de l'album $id de la collection locale")
                                } else if (payloadMap != null) {
                                    val albumId = payloadMap["album_id"] as? String
                                    if (albumId != null) {
                                        var existingAlbum = albumDao.getAlbumById(albumId)
                                        if (existingAlbum == null) {
                                            // Rapatrier et mettre en cache la série
                                            val seriesIdParam = payloadMap["series_id"] as? String ?: albumId
                                            seriesCacheManager.cacheSeriesById(seriesIdParam)
                                            existingAlbum = albumDao.getAlbumById(albumId)
                                        }

                                        // Si toujours absent localement, création résiliente de la série et de l'album pour satisfaire la clé étrangère
                                        if (existingAlbum == null) {
                                            val seriesId = (payloadMap["series_id"] as? String)?.ifEmpty { null } ?: "ser_$albumId"
                                            val seriesTitle = (payloadMap["series_title"] as? String)?.ifEmpty { null } ?: "Série importée"
                                            val seriesType = (payloadMap["series_type"] as? String) ?: "Franco-belge"

                                            if (seriesDao.getSeriesById(seriesId) == null) {
                                                seriesDao.insertSeries(
                                                    fr.bullix.app.data.entity.SeriesEntity(
                                                        id = seriesId,
                                                        title = seriesTitle,
                                                        type = seriesType,
                                                        status = "En cours"
                                                    )
                                                )
                                            }

                                            val albumTitle = payloadMap["album_title"] as? String ?: "Album $albumId"
                                            val volNum = (payloadMap["volume_number"] as? Number)?.toDouble() ?: 1.0
                                            val albumEntity = fr.bullix.app.data.entity.AlbumEntity(
                                                id = albumId,
                                                seriesId = seriesId,
                                                volumeNumber = volNum,
                                                title = albumTitle,
                                                isbn = payloadMap["isbn"] as? String,
                                                authors = payloadMap["authors"] as? String,
                                                publisher = payloadMap["publisher"] as? String,
                                                publishedYear = (payloadMap["published_year"] as? Number)?.toInt(),
                                                coverImageUrl = payloadMap["cover_image_url"] as? String
                                            )
                                            albumDao.insertAlbum(albumEntity)
                                        }

                                        val condition = payloadMap["condition"] as? String ?: "Bon"
                                        val locationId = payloadMap["location_id"] as? String
                                        val notes = payloadMap["notes"] as? String
                                        val isFavorite = (payloadMap["is_favorite"] as? Boolean) == true

                                        userCollectionDao.insertItem(
                                            UserCollectionEntity(
                                                id = id,
                                                userId = "default_user",
                                                albumId = albumId,
                                                locationId = locationId,
                                                condition = condition,
                                                editionInfo = payloadMap["edition_info"] as? String,
                                                purchasePrice = (payloadMap["purchase_price"] as? Number)?.toDouble(),
                                                notes = notes,
                                                isFavorite = isFavorite,
                                                createdAt = updatedAt,
                                                updatedAt = updatedAt
                                            )
                                        )
                                        Log.d("SyncWorker", "📥 Synchronisé en local : album $albumId")
                                    }
                                }
                            } else if (entityType == "location" && payloadMap != null) {
                                if (deletedAt != null) {
                                    locationDao.deleteLocation(id)
                                } else {
                                    val name = payloadMap["name"] as? String ?: "Emplacement"
                                    locationDao.insertLocation(
                                        LocationEntity(
                                            id = id,
                                            userId = "default_user",
                                            name = name,
                                            qrCodeRef = payloadMap["qr_code_ref"] as? String,
                                            colorTag = payloadMap["color_tag"] as? String,
                                            updatedAt = updatedAt
                                        )
                                    )
                                }
                            }
                        }
                    }

                    prefs.edit().putLong("last_sync_timestamp", serverTimestamp).apply()
                    Log.i("SyncWorker", "✅ Synchronisation complète et bidirectionnelle achevée avec succès.")
                }
            }

            Result.success()
        } catch (e: Exception) {
            Log.e("SyncWorker", "Erreur lors de la synchronisation : ${e.message}")
            Result.retry()
        }
    }
}
