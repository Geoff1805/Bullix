package fr.bullix.app

import android.app.Application
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import fr.bullix.app.data.BullixDatabase
import fr.bullix.app.data.repository.CollectionRepository
import fr.bullix.app.data.repository.SeriesCacheManager
import fr.bullix.app.sync.SyncWorker
import java.util.concurrent.TimeUnit

class BullixApp : Application() {

    lateinit var database: BullixDatabase
        private set

    lateinit var repository: CollectionRepository
        private set

    lateinit var seriesCacheManager: SeriesCacheManager
        private set

    override fun onCreate() {
        super.onCreate()

        database = BullixDatabase.getDatabase(this)
        seriesCacheManager = SeriesCacheManager(
            seriesDao = database.seriesDao(),
            albumDao = database.albumDao()
        )
        repository = CollectionRepository(
            seriesDao = database.seriesDao(),
            albumDao = database.albumDao(),
            locationDao = database.locationDao(),
            userCollectionDao = database.userCollectionDao(),
            syncRecordDao = database.syncRecordDao(),
            seriesCacheManager = seriesCacheManager
        )

        setupPeriodicSync()
        triggerImmediateSync()
    }

    fun triggerImmediateSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = androidx.work.OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(this).enqueueUniqueWork(
            "bullix_immediate_sync",
            androidx.work.ExistingWorkPolicy.REPLACE,
            syncRequest
        )
    }

    private fun setupPeriodicSync() {
        val constraints = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

        val syncRequest = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(constraints)
            .build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "bullix_offline_sync",
            ExistingPeriodicWorkPolicy.KEEP,
            syncRequest
        )
    }
}
