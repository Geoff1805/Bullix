package fr.bullix.app.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedFilterChip
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import fr.bullix.app.data.dao.CollectionItemDetail
import fr.bullix.app.domain.CollectionSearchFilter

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionScreen(
    items: List<CollectionItemDetail>,
    onItemClick: (CollectionItemDetail) -> Unit,
    onSeriesClick: (String) -> Unit,
    onSeedCollection: () -> Unit = {},
    onSyncClick: () -> Unit = {}
) {
    var searchQuery by remember { mutableStateOf("") }
    var selectedType by remember { mutableStateOf("Tous") }

    val types = listOf("Tous", "Franco-belge", "Manga", "Comics")

    val filteredItems = items.filter { item ->
        val matchesQuery = CollectionSearchFilter.matches(item, searchQuery)
        val matchesType = selectedType == "Tous" || item.seriesType.equals(selectedType, ignoreCase = true)
        matchesQuery && matchesType
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 16.dp)
    ) {
        // Barre de recherche multi-champs
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
            placeholder = { Text("Rechercher (titre, série, auteur, éditeur, casier, tome, ISBN...)") },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = "Recherche") },
            trailingIcon = {
                if (searchQuery.isNotEmpty()) {
                    IconButton(onClick = { searchQuery = "" }) {
                        Icon(Icons.Default.Close, contentDescription = "Effacer")
                    }
                }
            },
            shape = RoundedCornerShape(16.dp),
            singleLine = true
        )

        // Filtres par genre
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(bottom = 8.dp)
        ) {
            items(types) { type ->
                ElevatedFilterChip(
                    selected = selectedType == type,
                    onClick = { selectedType = type },
                    label = { Text(type) }
                )
            }
        }

        Text(
            text = "${filteredItems.size} album(s) dans la collection",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp)
        )

        if (filteredItems.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .weight(1f),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.padding(16.dp)
                ) {
                    Icon(
                        imageVector = Icons.Default.Book,
                        contentDescription = null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = if (items.isEmpty()) "Votre BDthèque est vide pour le moment" else "Aucun album ne correspond à ce filtre",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (items.isEmpty()) {
                        Spacer(modifier = Modifier.height(16.dp))
                        androidx.compose.material3.Button(onClick = onSeedCollection) {
                            Text("📚 Charger les albums de départ")
                        }
                        Spacer(modifier = Modifier.height(8.dp))
                        androidx.compose.material3.OutlinedButton(onClick = onSyncClick) {
                            Text("🔄 Synchroniser avec le Cloud D1")
                        }
                    }
                }
            }
        } else {
            LazyColumn(
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize()
            ) {
                items(filteredItems) { item ->
                    CollectionItemCard(
                        item = item,
                        onClick = { onItemClick(item) },
                        onSeriesClick = { onSeriesClick(item.seriesId) }
                    )
                }
            }
        }
    }
}

@Composable
fun CollectionItemCard(
    item: CollectionItemDetail,
    onClick: () -> Unit,
    onSeriesClick: () -> Unit
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Row(
            modifier = Modifier
                .padding(10.dp)
                .fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Jaquette de l'album
            if (!item.coverImageUrl.isNullOrBlank()) {
                AsyncImage(
                    model = item.coverImageUrl,
                    contentDescription = item.albumTitle,
                    modifier = Modifier
                        .size(width = 60.dp, height = 85.dp)
                        .clip(RoundedCornerShape(8.dp)),
                    contentScale = ContentScale.Crop
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(width = 60.dp, height = 85.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(MaterialTheme.colorScheme.primaryContainer),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        imageVector = Icons.Default.Book,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                // Série cliquable
                Text(
                    text = item.seriesTitle,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.clickable { onSeriesClick() }
                )

                // Tome et Titre
                val tomeText = if (item.volumeNumber % 1.0 == 0.0) {
                    "Tome ${item.volumeNumber.toInt()}"
                } else {
                    "Tome ${item.volumeNumber}"
                }
                Text(
                    text = "$tomeText — ${item.albumTitle ?: "Sans titre"}",
                    style = MaterialTheme.typography.bodyMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                val authorsAndPublisher = listOfNotNull(
                    item.authors?.takeIf { it.isNotBlank() },
                    listOfNotNull(
                        item.publisher?.takeIf { it.isNotBlank() },
                        item.publishedYear?.toString()
                    ).joinToString(" ").takeIf { it.isNotBlank() }
                ).joinToString(" • ")

                if (authorsAndPublisher.isNotBlank()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = authorsAndPublisher,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Emplacement & État
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(6.dp),
                        color = MaterialTheme.colorScheme.secondaryContainer
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Icon(
                                imageVector = Icons.Default.Place,
                                contentDescription = null,
                                modifier = Modifier.size(12.dp),
                                tint = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                text = item.locationName ?: "En attente de rangement",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSecondaryContainer
                            )
                        }
                    }

                    Spacer(modifier = Modifier.width(6.dp))

                    Text(
                        text = "• ${item.condition}",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            if (item.isFavorite) {
                Icon(
                    imageVector = Icons.Default.Star,
                    contentDescription = "Favori",
                    tint = Color(0xFFFFB300),
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}
