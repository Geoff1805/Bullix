package fr.bullix.app.data

import fr.bullix.app.domain.model.Album
import fr.bullix.app.domain.model.CheckAlbumPossessionResult
import fr.bullix.app.domain.model.Series
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AntiDoublonLogicTest {

    private fun normalizeIsbn(raw: String): String {
        return raw.replace("-", "").replace(" ", "").trim()
    }

    @Test
    fun testIsbnNormalization() {
        assertEquals("9782012101333", normalizeIsbn("978-2-01-210133-3"))
        assertEquals("9782205053470", normalizeIsbn(" 978 - 2205053470 "))
        assertEquals("2012101333", normalizeIsbn("2-01-210133-3"))
    }

    @Test
    fun testPossessionEvaluationWhenOwned() {
        val series = Series("s1", "Astérix", "Franco-belge", "En cours", 40, "Dargaud")
        val album = Album("a1", "s1", 1.0, "Astérix le Gaulois", "9782012101333", "Goscinny, Uderzo", "Dargaud", 1961, null)
        
        val result = CheckAlbumPossessionResult(
            isOwned = true,
            album = album,
            series = series,
            locationName = "Salon - Casier A",
            condition = "Très bon",
            otherVolumesOwnedCount = 12,
            totalVolumesInSeries = series.totalVolumes
        )

        assertTrue(result.isOwned)
        assertEquals("Salon - Casier A", result.locationName)
        assertEquals(12, result.otherVolumesOwnedCount)
        assertEquals(40, result.totalVolumesInSeries)
    }

    @Test
    fun testPossessionEvaluationWhenMissing() {
        val series = Series("s1", "Astérix", "Franco-belge", "En cours", 40, "Dargaud")
        val album = Album("a2", "s1", 2.0, "La Serpe d'or", "9782012101340", "Goscinny, Uderzo", "Dargaud", 1962, null)

        val result = CheckAlbumPossessionResult(
            isOwned = false,
            album = album,
            series = series,
            locationName = null,
            condition = null,
            otherVolumesOwnedCount = 1,
            totalVolumesInSeries = series.totalVolumes
        )

        assertFalse(result.isOwned)
        assertEquals(1, result.otherVolumesOwnedCount)
    }
}
