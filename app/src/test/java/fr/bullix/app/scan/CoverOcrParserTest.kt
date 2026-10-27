package fr.bullix.app.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class CoverOcrParserTest {

    @Test
    fun testRomanToDecimal() {
        assertEquals(1.0, CoverOcrParser.romanToDecimal("I")!!, 0.001)
        assertEquals(2.0, CoverOcrParser.romanToDecimal("II")!!, 0.001)
        assertEquals(4.0, CoverOcrParser.romanToDecimal("IV")!!, 0.001)
        assertEquals(5.0, CoverOcrParser.romanToDecimal("V")!!, 0.001)
        assertEquals(9.0, CoverOcrParser.romanToDecimal("IX")!!, 0.001)
        assertEquals(10.0, CoverOcrParser.romanToDecimal("X")!!, 0.001)
        assertEquals(12.0, CoverOcrParser.romanToDecimal("XII")!!, 0.001)
        assertEquals(14.0, CoverOcrParser.romanToDecimal("XIV")!!, 0.001)
        assertEquals(40.0, CoverOcrParser.romanToDecimal("XL")!!, 0.001)
        assertNull(CoverOcrParser.romanToDecimal("INVALID"))
    }

    @Test
    fun testParseVolumeNumber() {
        assertEquals(3.0, CoverOcrParser.parseVolumeNumber("3")!!, 0.001)
        assertEquals(12.5, CoverOcrParser.parseVolumeNumber("12.5")!!, 0.001)
        assertEquals(8.0, CoverOcrParser.parseVolumeNumber("VIII")!!, 0.001)
    }

    @Test
    fun testCleanAndParseCoverText_VolumeArabic() {
        val sampleCoverText = """
            DARGAUD
            BLACKSAD
            Tome 3
            Âme Rouge
            12.50 €
            Dépôt légal 2005
        """.trimIndent()

        val candidate = CoverOcrParser.cleanAndParseCoverText(sampleCoverText)

        assertEquals("BLACKSAD", candidate.detectedTitle)
        assertNotNull(candidate.detectedVolumeNumber)
        assertEquals(3.0, candidate.detectedVolumeNumber!!, 0.001)
    }

    @Test
    fun testCleanAndParseCoverText_VolumeRoman() {
        val sampleCoverText = """
            THORGAL
            Tome XIV
            AARICIA
            Éditions Le Lombard
        """.trimIndent()

        val candidate = CoverOcrParser.cleanAndParseCoverText(sampleCoverText)

        assertEquals("THORGAL", candidate.detectedTitle)
        assertNotNull(candidate.detectedVolumeNumber)
        assertEquals(14.0, candidate.detectedVolumeNumber!!, 0.001)
    }

    @Test
    fun testNoiseFiltering() {
        val sampleWithNoiseOnly = """
            15,90 EUR
            ISBN 978-2-01-210133-3
            Imprimé en France
            Dépôt légal novembre 2023
        """.trimIndent()

        val candidate = CoverOcrParser.cleanAndParseCoverText(sampleWithNoiseOnly)
        assertNull(candidate.detectedTitle)
        assertNull(candidate.detectedVolumeNumber)
    }
}
