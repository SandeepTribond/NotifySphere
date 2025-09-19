package com.billu.care

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentResolver
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages.apply {
              // Packages that cannot be autolinked yet can be added manually here
            }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean = BuildConfig.DEBUG

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    createNotificationChannel()
    loadReactNative(this)
  }

private fun createNotificationChannels() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val sounds = listOf("buscuit", "alert", "ringtone") // add all sounds you need
        val manager = getSystemService(NotificationManager::class.java)

        for (sound in sounds) {
            val channelId = "channel_$sound"
            val channelName = "Channel $sound"
            val importance = NotificationManager.IMPORTANCE_HIGH
            val channel = NotificationChannel(channelId, channelName, importance)

            val soundUri = Uri.parse(
                "${ContentResolver.SCHEME_ANDROID_RESOURCE}://$packageName/raw/$sound"
            )
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()
            channel.setSound(soundUri, audioAttributes)

            manager?.createNotificationChannel(channel)
        }
    }
}


}
