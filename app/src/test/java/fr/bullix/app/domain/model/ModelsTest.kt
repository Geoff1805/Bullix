package fr.bullix.app.domain.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ModelsTest {

    @Test
    fun testSeriesModel() {
        val series = Series(
            id = "series_asterix",
            title = "Astérix",
            type = "Franco-belge",
            status = "En cours",
            totalVolumes = 40,
            publisherDefault = "Albert René"
        )

        assertEquals("series_asterix", series.id)
        assertEquals("Astérix", series.title)
        assertEquals(40, series.totalVolumes)
    }

    @Test
    fun testAlbumModel() {
        val album = Album(
            id = "alb_01",
            seriesId = "series_asterix",
            volumeNumber = 1.0,
            title = "Astérix le Gaulois",
            isbn = "9782012101333",
            authors = "Goscinny, Uderzo",
            publisher = "Dargaud",
            publishedYear = 1961,
            coverImageUrl = "https://example.com/cover.jpg"
        )

        assertEquals("alb_01", album.id)
        assertEquals(1.0, album.volumeNumber, 0.001)
        assertEquals("9782012101333", album.isbn)
    }

    @Test
    fun testCheckAlbumPossessionResult() {
        val result = CheckAlbumPossessionResult(
            isOwned = true,
            album = null,
            series = null,
            locationName = "Étagère BD - Casier 4",
            condition = "Très bon",
            otherVolumesOwnedCount = 5,
            totalVolumesInSeries = 40
        )

        assertTrue(result.isOwned)
        assertEquals("Étagère BD - Casier 4", result.locationName)
        assertEquals("Très bon", result.condition)
        assertEquals(5, result.otherVolumesOwnedCount)
    }

    @Test
    fun testMissingVolumeModel() {
        val missing = MissingVolume(
            seriesId = "series_blacksad",
            seriesTitle = "Blacksad",
            volumeNumber = 2.0,
            title = "Arctic-Nation",
            isbn = "9782205053470",
            coverImageUrl = null
        )

        assertEquals("Blacksad", missing.seriesTitle)
        assertEquals(2.0, missing.volumeNumber, 0.001)
    }
}
