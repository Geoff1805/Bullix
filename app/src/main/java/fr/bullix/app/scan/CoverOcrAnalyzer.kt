package fr.bullix.app.scan

import android.annotation.SuppressLint
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions

data class OcrResultCandidate(
    val rawText: String,
    val detectedTitle: String?,
    val detectedVolumeNumber: Double?
)

class CoverOcrAnalyzer(
    private val onTextExtracted: (OcrResultCandidate) -> Unit
) : ImageAnalysis.Analyzer {

    private val recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    private var isScanning = true

    fun resume() {
        isScanning = true
    }

    fun pause() {
        isScanning = false
    }

    @SuppressLint("UnsafeOptInUsageError")
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage = imageProxy.image
        if (mediaImage != null && isScanning) {
            val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
            recognizer.process(image)
                .addOnSuccessListener { visionText ->
                    val fullText = visionText.text
                    if (fullText.isNotBlank()) {
                        val candidate = CoverOcrParser.cleanAndParseCoverText(fullText)
                        if (candidate.detectedTitle != null || candidate.detectedVolumeNumber != null) {
                            if (isScanning) {
                                isScanning = false
                                onTextExtracted(candidate)
                            }
                        }
                    }
                }
                .addOnCompleteListener {
                    imageProxy.close()
                }
        } else {
            imageProxy.close()
        }
    }
}
