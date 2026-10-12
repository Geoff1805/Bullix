package fr.bullix.app.scan

object CoverOcrParser {

    /**
     * Algorithme local de nettoyage et de détection de tome / titre de BD
     */
    fun cleanAndParseCoverText(raw: String): OcrResultCandidate {
        val lines = raw.lines()
            .map { it.trim() }
            .filter { line ->
                // Exclusion du bruit : prix, dates, mentions légales, mentions éditeurs isolées
                !line.matches(Regex(".*(\\d+([.,]\\d+)?\\s*(€|F|francs|EUR)).*", RegexOption.IGNORE_CASE)) &&
                !line.contains("dépôt légal", ignoreCase = true) &&
                !line.contains("imprimé en", ignoreCase = true) &&
                !line.contains("isbn", ignoreCase = true) &&
                line.length > 2
            }

        var detectedVolume: Double? = null

        // 1. Détection du numéro de tome (arabe ou romain)
        val volumeRegex = Regex("""(?:tome|vol(?:ume)?|n°|#|\bt\.)\s*([0-9]+(?:\.[0-9]+)?|[ivxlcdm]+)""", RegexOption.IGNORE_CASE)
        for (line in lines) {
            val match = volumeRegex.find(line)
            if (match != null) {
                val valueStr = match.groupValues[1]
                detectedVolume = parseVolumeNumber(valueStr)
                break
            }
        }

        // 2. Détection du titre le plus proéminent (souvent la ligne la plus longue ou au début)
        val candidateTitle = lines.firstOrNull { line ->
            !line.matches(Regex("""^(tome|vol|editions|dargaud|dupuis|casterman|glenat).*""", RegexOption.IGNORE_CASE))
        }

        return OcrResultCandidate(
            rawText = raw,
            detectedTitle = candidateTitle,
            detectedVolumeNumber = detectedVolume
        )
    }

    fun parseVolumeNumber(raw: String): Double? {
        // Tente en nombre arabe d'abord
        val directNumber = raw.toDoubleOrNull()
        if (directNumber != null) return directNumber

        // Conversion chiffres romains
        return romanToDecimal(raw.uppercase())
    }

    fun romanToDecimal(roman: String): Double? {
        val romanMap = mapOf('I' to 1, 'V' to 5, 'X' to 10, 'L' to 50, 'C' to 100, 'D' to 500, 'M' to 1000)
        var total = 0
        var prevValue = 0

        for (char in roman.reversed()) {
            val value = romanMap[char] ?: return null
            if (value < prevValue) {
                total -= value
            } else {
                total += value
            }
            prevValue = value
        }
        return if (total > 0) total.toDouble() else null
    }
}
