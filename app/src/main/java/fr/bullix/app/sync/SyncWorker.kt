package fr.bullix.app.sync

import android.content.Context
import android.util.Log
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import fr.bullix.app.BuildConfig
import fr.bullix.app.data.BullixDatabase
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

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .build()

    private val moshi = Moshi.Builder()
        .addLast(KotlinJsonAdapterFactory())
        .build()

    override suspend fun doWork(): Result {
        return try {
            val pendingRecords = syncRecordDao.getPendingRecords()
            if (pendingRecords.isEmpty()) {
                Log.d("SyncWorker", "Aucun enregistrement local en attente de synchronisation.")
                return Result.success()
            }

            Log.i("SyncWorker", "Push de ${pendingRecords.size} enregistrements vers Cloudflare Edge...")

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
                .url("${BuildConfig.BULLIX_API_URL}/api/sync/push")
                .post(jsonBody.toRequestBody("application/json".toMediaType()))
                .build()

            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                val acknowledgedIds = pendingRecords.map { it.id }
                syncRecordDao.markAsSynced(acknowledgedIds)
                Log.i("SyncWorker", "✅ Synchronisation réussie : ${acknowledgedIds.size} enregistrements confirmés.")
                Result.success()
            } else {
                Log.w("SyncWorker", "Échec du push serveur : code ${response.code}")
                Result.retry()
            }
        } catch (e: Exception) {
            Log.e("SyncWorker", "Erreur lors de la synchronisation : ${e.message}")
            Result.retry()
        }
    }
}
