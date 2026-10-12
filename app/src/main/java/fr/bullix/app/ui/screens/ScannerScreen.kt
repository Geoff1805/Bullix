package fr.bullix.app.ui.screens

import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.draw.clip
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CropFree
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import coil.compose.AsyncImage
import com.google.accompanist.permissions.ExperimentalPermissionsApi
import com.google.accompanist.permissions.isGranted
import com.google.accompanist.permissions.rememberPermissionState
import fr.bullix.app.data.repository.CollectionRepository
import fr.bullix.app.domain.model.CheckAlbumPossessionResult
import fr.bullix.app.scan.BarcodeAnalyzer
import fr.bullix.app.scan.CoverOcrAnalyzer
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@OptIn(ExperimentalPermissionsApi::class)
@Composable
fun ScannerScreen(
    repository: CollectionRepository,
    onNavigateToAlbumDetail: (String) -> Unit
) {
    val cameraPermissionState = rememberPermissionState(permission = android.Manifest.permission.CAMERA)

    Box(modifier = Modifier.fillMaxSize()) {
        if (cameraPermissionState.status.isGranted) {
            CameraPreviewAndAnalyzer(
                repository = repository,
                onNavigateToAlbumDetail = onNavigateToAlbumDetail
            )
        } else {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Icon(
                    imageVector = Icons.Default.CropFree,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.primary
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Permission Caméra Requise",
                    style = MaterialTheme.typography.titleLarge
                )
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Bullix utilise la caméra pour scanner les codes-barres en brocante et reconnaître les couvertures de BD anciennes.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(24.dp))
                Button(onClick = { cameraPermissionState.launchPermissionRequest() }) {
                    Text("Autoriser l'appareil photo")
                }
            }
        }
    }
}

@Composable
fun CameraPreviewAndAnalyzer(
    repository: CollectionRepository,
    onNavigateToAlbumDetail: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val scope = rememberCoroutineScope()

    var scanMode by remember { mutableIntStateOf(0) } // 0 = Barcode, 1 = OCR Couverture
    var scanResult by remember { mutableStateOf<CheckAlbumPossessionResult?>(null) }
    var isChecking by remember { mutableStateOf(false) }
    var detectedTextDisplay by remember { mutableStateOf<String?>(null) }

    val barcodeAnalyzer = remember {
        BarcodeAnalyzer { rawBarcode ->
            scope.launch {
                isChecking = true
                val result = withContext(Dispatchers.IO) {
                    repository.checkAlbumPossessionByIsbn(rawBarcode)
                }
                scanResult = result
                isChecking = false
            }
        }
    }

    val coverOcrAnalyzer = remember {
        CoverOcrAnalyzer { candidate ->
            scope.launch {
                detectedTextDisplay = candidate.detectedTitle ?: "Tome ${candidate.detectedVolumeNumber}"
                isChecking = true
                candidate.detectedTitle?.let { title ->
                    val result = withContext(Dispatchers.IO) {
                        repository.searchAndCheckAlbumPossession(
                            query = title,
                            volumeNumber = candidate.detectedVolumeNumber
                        )
                    }
                    scanResult = result
                }
                isChecking = false
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        AndroidView(
            factory = { ctx ->
                val previewView = PreviewView(ctx).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT
                    )
                }

                val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                cameraProviderFuture.addListener({
                    val cameraProvider = cameraProviderFuture.get()
                    val preview = Preview.Builder().build().also {
                        it.setSurfaceProvider(previewView.surfaceProvider)
                    }

                    val imageAnalysis = ImageAnalysis.Builder()
                        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                        .build()

                    val analyzerToUse = if (scanMode == 0) barcodeAnalyzer else coverOcrAnalyzer
                    imageAnalysis.setAnalyzer(ContextCompat.getMainExecutor(ctx), analyzerToUse)

                    try {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            CameraSelector.DEFAULT_BACK_CAMERA,
                            preview,
                            imageAnalysis
                        )
                    } catch (exc: Exception) {
                        exc.printStackTrace()
                    }
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Sélecteur de mode en haut (Code-barres vs OCR)
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
                .align(Alignment.TopCenter)
        ) {
            TabRow(
                selectedTabIndex = scanMode,
                containerColor = Color.Black.copy(alpha = 0.6f),
                contentColor = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clip(RoundedCornerShape(24.dp))
            ) {
                Tab(
                    selected = scanMode == 0,
                    onClick = {
                        scanMode = 0
                        barcodeAnalyzer.resume()
                        scanResult = null
                    },
                    text = { Text("Code-barres (EAN)") }
                )
                Tab(
                    selected = scanMode == 1,
                    onClick = {
                        scanMode = 1
                        coverOcrAnalyzer.resume()
                        scanResult = null
                    },
                    text = { Text("OCR Couverture") }
                )
            }
        }

        // Overlay central de cadrage
        Box(
            modifier = Modifier
                .size(280.dp, if (scanMode == 0) 160.dp else 280.dp)
                .align(Alignment.Center)
                .background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(16.dp))
        )

        // Indicateur d'analyse en cours
        if (isChecking) {
            CircularProgressIndicator(
                modifier = Modifier
                    .size(48.dp)
                    .align(Alignment.Center),
                color = MaterialTheme.colorScheme.primary
            )
        }

        // Fiche de résultat Anti-Doublon instantanée (Overlay Bas)
        scanResult?.let { result ->
            AntiDoublonResultCard(
                result = result,
                onDismiss = {
                    scanResult = null
                    barcodeAnalyzer.resume()
                    coverOcrAnalyzer.resume()
                },
                onAddToCollection = {
                    scope.launch(Dispatchers.IO) {
                        result.album?.let { album ->
                            repository.addAlbumToUserCollection(
                                albumId = album.id,
                                condition = "Très bon"
                            )
                        }
                    }
                    scanResult = null
                    barcodeAnalyzer.resume()
                    coverOcrAnalyzer.resume()
                },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp)
            )
        }
    }
}

@Composable
fun AntiDoublonResultCard(
    result: CheckAlbumPossessionResult,
    onDismiss: () -> Unit,
    onAddToCollection: () -> Unit,
    modifier: Modifier = Modifier
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = if (result.isOwned) Color(0xFF2E7D32) else Color(0xFFE65100)
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        imageVector = if (result.isOwned) Icons.Default.CheckCircle else Icons.Default.Warning,
                        contentDescription = null,
                        tint = Color.White,
                        modifier = Modifier.size(28.dp)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = if (result.isOwned) "DÉJÀ DANS LA COLLECTION" else "ALBUM MANQUANT",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                }
                IconButton(onClick = onDismiss) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Fermer", tint = Color.White)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Row(modifier = Modifier.fillMaxWidth()) {
                result.album?.coverImageUrl?.let { coverUrl ->
                    AsyncImage(
                        model = coverUrl,
                        contentDescription = "Couverture",
                        modifier = Modifier
                            .size(60.dp, 80.dp)
                            .background(Color.DarkGray, RoundedCornerShape(4.dp))
                    )
                    Spacer(modifier = Modifier.width(12.dp))
                }

                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "${result.series?.title ?: "Série inconnue"} — T.${result.album?.volumeNumber ?: "?"}",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 15.sp
                    )
                    result.album?.title?.let {
                        Text(text = it, color = Color.White.copy(alpha = 0.9f), fontSize = 13.sp)
                    }

                    if (result.isOwned) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Rangement : ${result.locationName ?: "Non classé"}",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 12.sp
                        )
                    } else {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Vous possédez ${result.otherVolumesOwnedCount}/${result.totalVolumesInSeries ?: "?"} tomes de cette série",
                            color = Color.White.copy(alpha = 0.8f),
                            fontSize = 12.sp
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (!result.isOwned) {
                Button(
                    onClick = onAddToCollection,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFFE65100))
                ) {
                    Icon(imageVector = Icons.Default.Add, contentDescription = null)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text("Ajouter à ma collection", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}
