package fr.bullix.app.domain.model

data class Series(
    val id: String,
    val title: String,
    val type: String,
    val status: String,
    val totalVolumes: Int?,
    val publisherDefault: String?
)

data class Album(
    val id: String,
    val seriesId: String,
    val volumeNumber: Double,
    val title: String?,
    val isbn: String?,
    val authors: String?,
    val publisher: String?,
    val publishedYear: Int?,
    val coverImageUrl: String?
)

data class MissingVolume(
    val seriesId: String,
    val seriesTitle: String,
    val volumeNumber: Double,
    val title: String?,
    val isbn: String?,
    val coverImageUrl: String?
)

data class CheckAlbumPossessionResult(
    val isOwned: Boolean,
    val album: Album?,
    val series: Series?,
    val locationName: String?,
    val condition: String?,
    val otherVolumesOwnedCount: Int,
    val totalVolumesInSeries: Int?
)
