package fr.bullix.app.domain

import fr.bullix.app.data.dao.CollectionItemDetail
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CollectionSearchFilterTest {

    private val sampleItem = CollectionItemDetail(
        collectionId = "col_1",
        albumId = "alb_1",
        seriesId = "ser_asterix",
        seriesTitle = "Astérix",
        seriesType = "Franco-belge",
        volumeNumber = 1.0,
        albumTitle = "Astérix le Gaulois",
        isbn = "978-2-01-210133-3",
        authors = "René Goscinny, Albert Uderzo",
        publisher = "Dargaud",
        publishedYear = 1961,
        coverImageUrl = null,
        locationId = "loc_1",
        locationName = "Salon › Bibliothèque › Casier n°1",
        condition = "Très bon",
        editionInfo = "Édition Originale",
        isFavorite = true,
        addedAt = 1600000000000L
    )

    @Test
    fun testSearchEmptyQueryReturnsTrue() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, ""))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "   "))
    }

    @Test
    fun testSearchBySeriesTitle() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Astérix"))
        // Insensible aux accents
        assertTrue(CollectionSearchFilter.matches(sampleItem, "asterix"))
    }

    @Test
    fun testSearchByAlbumTitle() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Gaulois"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "gaulois"))
    }

    @Test
    fun testSearchByVolumeNumber() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "1"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "tome 1"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "vol 1"))
    }

    @Test
    fun testSearchByIsbn() {
        // Avec tirets
        assertTrue(CollectionSearchFilter.matches(sampleItem, "978-2-01-210133-3"))
        // Sans tirets
        assertTrue(CollectionSearchFilter.matches(sampleItem, "9782012101333"))
        // Partiel
        assertTrue(CollectionSearchFilter.matches(sampleItem, "210133"))
    }

    @Test
    fun testSearchByAuthors() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Goscinny"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Uderzo"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Rene")) // accent é
    }

    @Test
    fun testSearchByPublisher() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Dargaud"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "dargaud"))
    }

    @Test
    fun testSearchByPublishedYear() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "1961"))
    }

    @Test
    fun testSearchByLocationName() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Salon"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Bibliotheque")) // sans accent
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Casier n°1"))
    }

    @Test
    fun testSearchByCondition() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Très bon"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "tres bon"))
    }

    @Test
    fun testSearchByEditionInfo() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Édition Originale"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "originale"))
    }

    @Test
    fun testSearchBySeriesType() {
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Franco-belge"))
        assertTrue(CollectionSearchFilter.matches(sampleItem, "franco"))
    }

    @Test
    fun testSearchMultiWordsCrossingFields() {
        // "Uderzo" (auteur) + "Dargaud" (éditeur)
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Uderzo Dargaud"))
        // "Astérix" (série) + "Casier" (emplacement) + "1961" (année)
        assertTrue(CollectionSearchFilter.matches(sampleItem, "Asterix Casier 1961"))
    }

    @Test
    fun testSearchNonMatchingTermReturnsFalse() {
        assertFalse(CollectionSearchFilter.matches(sampleItem, "Tintin"))
        assertFalse(CollectionSearchFilter.matches(sampleItem, "Dupuis"))
        assertFalse(CollectionSearchFilter.matches(sampleItem, "Astérix Dupuis"))
    }
}
