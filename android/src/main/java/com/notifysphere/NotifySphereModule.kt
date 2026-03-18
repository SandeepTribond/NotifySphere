package com.notifysphere

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = NotifySphereModule.NAME)
class NotifySphereModule(reactContext: ReactApplicationContext) :
  NativeNotifySphereSpec(reactContext) {

  override fun getName(): String {
    return NAME
  }

  companion object {
    const val NAME = "NotifySphere"
  }
}
