# ProGuard / R8 rules for Bullix

# Keep Room SQLite schemas and entities
-keep class androidx.room.** { *; }
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.paging.**

# Keep Moshi models
-keepclassmembers class * {
    @com.squareup.moshi.Json <fields>;
}
-keep class com.squareup.moshi.** { *; }
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod

# Keep Bullix domain & entity models
-keep class fr.bullix.app.domain.model.** { *; }
-keep class fr.bullix.app.data.entity.** { *; }
-keep class fr.bullix.app.data.dao.** { *; }

# ProGuard / R8 Optimization Rules
-keepattributes *Annotation*,Signature,InnerClasses,EnclosingMethod
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn io.ktor.**
-dontwarn kotlinx.coroutines.**
-dontwarn com.google.android.gms.**
-keep class com.google.android.gms.home.** { *; }
-keep class com.google.android.gms.common.** { *; }
