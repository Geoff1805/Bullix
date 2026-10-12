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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import fr.bullix.app.data.repository.CollectionRepository
import fr.bullix.app.domain.model.CheckAlbumPossessionResult
import fr.bullix.app.scan.BarcodeAnalyzer
import fr.bullix.app.scan.CoverOcrAnalyzer
import kotlinx.coroutines.launch
import java.util.concurrent.Executors

@Composable
fun ScannerScreen(
    repository: CollectionRepository,
    onAlbumAdded: () -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val coroutineScope = rememberCoroutineScope()

    var scanMode by remember { mutableIntStateOf(0) } // 0: Code-barres, 1: OCR Couverture
    var isChecking by remember { mutableStateOf(false) }
    var scanResult by remember { mutableStateOf<CheckAlbumPossessionResult?>(null) }
    var lastScannedCode by remember { mutableStateOf<String?>(null) }

    val cameraExecutor = remember { Executors.newSingleThreadExecutor() }

    val barcodeAnalyzer = remember {
        BarcodeAnalyzer { barcode ->
            if (!isChecking && barcode != lastScannedCode) {
                lastScannedCode = barcode
                isChecking = true
                coroutineScope.launch {
                    val result = repository.checkAlbumPossessionByIsbn(barcode)
                    scanResult = result
                    isChecking = false
                }
            }
        }
    }

    val ocrAnalyzer = remember {
        CoverOcrAnalyzer { candidate ->
            if (!isChecking) {
                // Traitement de l'OCR
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // Prévisualisation CameraX
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

                    val currentAnalyzer = if (scanMode == 0) barcodeAnalyzer else ocrAnalyzer
                    imageAnalysis.setAnalyzer(cameraExecutor, currentAnalyzer)

                    val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA

                    try {
                        cameraProvider.unbindAll()
                        cameraProvider.bindToLifecycle(
                            lifecycleOwner,
                            cameraSelector,
                            preview,
                            imageAnalysis
                        )
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }, ContextCompat.getMainExecutor(ctx))

                previewView
            },
            modifier = Modifier.fillMaxSize()
        )

        // Viseur central
        Box(
            modifier = Modifier
                .size(280.dp, if (scanMode == 0) 160.dp else 260.dp)
                .align(Alignment.Center)
                .background(Color.White.copy(alpha = 0.15f), RoundedCornerShape(16.dp)),
            contentAlignment = Alignment.Center
        ) {
            Icon(
                imageVector = Icons.Default.CropFree,
                contentDescription = null,
                modifier = Modifier.size(64.dp),
                tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
            )
        }

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
                        ocrAnalyzer.resume()
                        scanResult = null
                    },
                    text = { Text("OCR Couverture") }
                )
            }
        }

        // Bandeau de résultat anti-doublon en bas
        if (isChecking) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .align(Alignment.BottomCenter),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(containerColor = Color.Black.copy(alpha = 0.85f))
            ) {
                Row(
                    modifier = Modifier.padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                    Spacer(modifier = Modifier.width(12.dp))
                    Text(
                        text = "Vérification anti-doublon en cours...",
                        color = Color.White
                    )
                }
            }
        } else if (scanResult != null) {
            val res = scanResult!!
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp)
                    .align(Alignment.BottomCenter),
                shape = RoundedCornerShape(16.dp),
                colors = CardDefaults.cardColors(
                    containerColor = if (res.isOwned) Color(0xFFD32F2F) else Color(0xFF2E7D32)
                )
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = if (res.isOwned) Icons.Default.Warning else Icons.Default.CheckCircle,
                                contentDescription = null,
                                tint = Color.White,
                                modifier = Modifier.size(28.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (res.isOwned) "DÉJÀ POSSÉDÉ !" else "NON POSSÉDÉ (MANQUANT)",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold,
                                color = Color.White
                            )
                        }

                        IconButton(onClick = {
                            scanResult = null
                            barcodeAnalyzer.resume()
                            ocrAnalyzer.resume()
                        }) {
                            Icon(Icons.Default.Close, contentDescription = "Fermer", tint = Color.White)
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    if (res.album != null) {
                        Text(
                            text = "${res.series?.title ?: "Série"} — Tome ${res.album.volumeNumber.toInt()} : ${res.album.title ?: ""}",
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = FontWeight.SemiBold,
                            color = Color.White
                        )
                    }

                    if (res.isOwned) {
                        Text(
                            text = "Emplacement actuel : ${res.locationName ?: "Non rangé"}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = Color.White.copy(alpha = 0.9f)
                        )
                        Text(
                            text = "État possédé : ${res.condition ?: "Bon"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.8f)
                        )
                    } else {
                        Text(
                            text = "Vous possédez déjà ${res.otherVolumesOwnedCount} tome(s) de cette série.",
                            style = MaterialTheme.typography.bodySmall,
                            color = Color.White.copy(alpha = 0.9f)
                        )

                        Spacer(modifier = Modifier.height(10.dp))

                        Button(
                            onClick = {
                                coroutineScope.launch {
                                    res.album?.let { album ->
                                        repository.addAlbumToCollection(album.id)
                                        scanResult = null
                                        barcodeAnalyzer.resume()
                                        onAlbumAdded()
                                    }
                                }
                            },
                            colors = ButtonDefaults.buttonColors(containerColor = Color.White),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Icon(Icons.Default.Add, contentDescription = null, tint = Color.Black)
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Ajouter à ma collection", color = Color.Black, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }
    }
}
