package fr.bullix.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Book
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import fr.bullix.app.data.repository.CollectionRepository
import fr.bullix.app.ui.screens.CollectionScreen
import fr.bullix.app.ui.screens.LocationsScreen
import fr.bullix.app.ui.screens.ScannerScreen
import fr.bullix.app.ui.screens.SeriesDetailScreen

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(repository: CollectionRepository) {
    var selectedTab by remember { mutableIntStateOf(0) }
    var selectedSeriesId by remember { mutableStateOf<String?>(null) }

    val collectionItems by repository.collectionItems.collectAsState(initial = emptyList())
    val locations by repository.locations.collectAsState(initial = emptyList())

    if (selectedSeriesId != null) {
        SeriesDetailScreen(
            seriesId = selectedSeriesId!!,
            repository = repository,
            onBack = { selectedSeriesId = null }
        )
    } else {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            text = "Bullix",
                            fontWeight = FontWeight.Bold
                        )
                    },
                    colors = TopAppBarDefaults.topAppBarColors()
                )
            },
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        icon = { Icon(Icons.Default.Book, contentDescription = "Collection") },
                        label = { Text("Collection") }
                    )
                    NavigationBarItem(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        icon = { Icon(Icons.Default.CameraAlt, contentDescription = "Scanner") },
                        label = { Text("Scanner") }
                    )
                    NavigationBarItem(
                        selected = selectedTab == 2,
                        onClick = { selectedTab = 2 },
                        icon = { Icon(Icons.Default.Place, contentDescription = "Casiers") },
                        label = { Text("Casiers") }
                    )
                }
            }
        ) { padding ->
            androidx.compose.foundation.layout.Box(modifier = Modifier.padding(padding)) {
                when (selectedTab) {
                    0 -> CollectionScreen(
                        items = collectionItems,
                        onItemClick = {},
                        onSeriesClick = { seriesId -> selectedSeriesId = seriesId }
                    )
                    1 -> ScannerScreen(
                        repository = repository,
                        onAlbumAdded = { selectedTab = 0 }
                    )
                    2 -> LocationsScreen(
                        locations = locations,
                        repository = repository
                    )
                }
            }
        }
    }
}
