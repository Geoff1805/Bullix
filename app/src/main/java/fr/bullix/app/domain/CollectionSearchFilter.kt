package fr.bullix.app.domain

import fr.bullix.app.data.dao.CollectionItemDetail
import java.text.Normalizer
import java.util.regex.Pattern

/**
 * Moteur de recherche et de filtrage multi-champs pour la collection Bullix.
 * Permet de rechercher sur TOUS les champs d'un album :
 * - Titre de la série
 * - Titre de l'album / tome
 * - Numéro de tome / volume
 * - Code ISBN / EAN (avec ou sans tirets)
 * - Auteurs (scénariste, dessinateur, coloriste)
 * - Éditeur
 * - Année de parution
 * - Emplacement / casier / pièce
 * - État de conservation (Neuf, Très bon, Bon, Usé, etc.)
 * - Informations d'édition (EO, intégrale, tirage de tête...)
 * - Type / Genre (Franco-belge, Manga, Comics...)
 *
 * Fonctionnalités avancées :
 * - Recherche multi-mots (tous les termes saisis doivent matcher au moins un champ)
 * - Insensibilité à la casse
 * - Insensibilité aux accents et diacritiques (recherche de "Asterix" trouve "Astérix")
 */
object CollectionSearchFilter {

    private val DIACRITICS_PATTERN = Pattern.compile("\\p{InCombiningDiacriticalMarks}+")

    /**
     * Supprime les accents et diacritiques et convertit en minuscules.
     */
    fun normalize(text: String?): String {
        if (text.isNullOrBlank()) return ""
        val decomposed = Normalizer.normalize(text, Normalizer.Form.NFD)
        return DIACRITICS_PATTERN.matcher(decomposed)
            .replaceAll("")
            .lowercase()
            .trim()
    }

    /**
     * Vérifie si un item de collection correspond à la requête de recherche sur l'ensemble de ses champs.
     */
    fun matches(item: CollectionItemDetail, query: String): Boolean {
        val trimmedQuery = query.trim()
        if (trimmedQuery.isEmpty()) return true

        val queryTokens = trimmedQuery.split(Regex("\\s+"))
            .map { normalize(it) }
            .filter { it.isNotEmpty() }

        if (queryTokens.isEmpty()) return true

        val volumeFormatted = if (item.volumeNumber % 1.0 == 0.0) {
            item.volumeNumber.toInt().toString()
        } else {
            item.volumeNumber.toString()
        }

        val searchableFields = listOfNotNull(
            item.seriesTitle,
            item.albumTitle,
            item.isbn,
            item.isbn?.replace("-", ""),
            item.authors,
            item.publisher,
            item.publishedYear?.toString(),
            volumeFormatted,
            "tome $volumeFormatted",
            "t.$volumeFormatted",
            "vol $volumeFormatted",
            item.locationName,
            item.condition,
            item.editionInfo,
            item.seriesType
        ).map { normalize(it) }

        // Chaque terme de recherche doit être contenu dans au moins l'un des champs de l'album
        return queryTokens.all { token ->
            searchableFields.any { field -> field.contains(token) }
        }
    }
}
