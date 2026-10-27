package fr.bullix.app.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.sqlite.db.SupportSQLiteDatabase
import fr.bullix.app.data.dao.AlbumDao
import fr.bullix.app.data.dao.LocationDao
import fr.bullix.app.data.dao.SeriesDao
import fr.bullix.app.data.dao.SyncRecordDao
import fr.bullix.app.data.dao.UserCollectionDao
import fr.bullix.app.data.entity.AlbumEntity
import fr.bullix.app.data.entity.LocationEntity
import fr.bullix.app.data.entity.SeriesEntity
import fr.bullix.app.data.entity.SyncRecordEntity
import fr.bullix.app.data.entity.UserCollectionEntity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

@Database(
    entities = [
        SeriesEntity::class,
        AlbumEntity::class,
        LocationEntity::class,
        UserCollectionEntity::class,
        SyncRecordEntity::class
    ],
    version = 1,
    exportSchema = false
)
abstract class BullixDatabase : RoomDatabase() {
    abstract fun seriesDao(): SeriesDao
    abstract fun albumDao(): AlbumDao
    abstract fun locationDao(): LocationDao
    abstract fun userCollectionDao(): UserCollectionDao
    abstract fun syncRecordDao(): SyncRecordDao

    companion object {
        @Volatile
        private var INSTANCE: BullixDatabase? = null

        fun getDatabase(context: Context): BullixDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    BullixDatabase::class.java,
                    "bullix_local.db"
                )
                    .addCallback(DatabaseCallback())
                    .fallbackToDestructiveMigration()
                    .build()
                INSTANCE = instance
                instance
            }
        }

        private class DatabaseCallback : RoomDatabase.Callback() {
            override fun onCreate(db: SupportSQLiteDatabase) {
                super.onCreate(db)
                // Amorçage initial d'emplacements types pour démarrer immédiatement
                CoroutineScope(Dispatchers.IO).launch {
                    val database = INSTANCE ?: return@launch
                    val locationDao = database.locationDao()
                    locationDao.insertLocation(
                        LocationEntity(
                            id = "loc_salon_b1_c01",
                            name = "Salon › Bibliothèque › Casier n°1",
                            qrCodeRef = "QR-SALON-B1-C01",
                            colorTag = "#4CAF50"
                        )
                    )
                    locationDao.insertLocation(
                        LocationEntity(
                            id = "loc_salon_b1_c02",
                            name = "Salon › Bibliothèque › Casier n°2",
                            qrCodeRef = "QR-SALON-B1-C02",
                            colorTag = "#2196F3"
                        )
                    )
                    locationDao.insertLocation(
                        LocationEntity(
                            id = "loc_bureau_pile_a_ranger",
                            name = "Bureau › Pile à ranger (En attente)",
                            qrCodeRef = "QR-BUREAU-ATTENTE",
                            colorTag = "#FF9800"
                        )
                    )
                }
            }
        }
    }
}
