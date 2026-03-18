# react-native-notify-sphere

A React Native push notification SDK built on top of Firebase Cloud Messaging (FCM) and Notifee. Drop-in replacement for OneSignal with full delivery tracking, press tracking, user segmentation via tags, and rich notification support.

---

## Table of Contents

1. [Features](#features)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Android Setup](#android-setup)
5. [iOS Setup](#ios-setup)
6. [Usage](#usage)
7. [API Reference](#api-reference)
8. [FCM Payload Format](#fcm-payload-format)
9. [Troubleshooting](#troubleshooting)
10. [Version History](#version-history)

---

## Features

- ✅ Foreground, background, and terminated-state notification handling
- ✅ Delivery confirmation API — fires in all three app states
- ✅ Press/click tracking API
- ✅ Smart re-registration — only calls the API when FCM token or user details change
- ✅ Automatic FCM token refresh handling
- ✅ User segmentation via custom tags
- ✅ Rich notifications — images, custom sounds, action buttons
- ✅ Full TypeScript support
- ✅ Android & iOS

---

## Prerequisites

- React Native `0.70+`
- A Firebase project with Cloud Messaging enabled
- A NotifySphere account and App ID

---

## Installation

### Step 1: Install the package and peer dependencies

```bash
npm install react-native-notify-sphere

# Peer dependencies (native — must be installed in your app)
npm install @react-native-firebase/app
npm install @react-native-firebase/messaging
npm install @notifee/react-native
npm install @react-native-async-storage/async-storage
```

### Step 2: iOS — install pods

```bash
cd ios && pod install && cd ..
```

---

## Android Setup

### 1. Add `google-services.json`

Download from Firebase Console and place at `android/app/google-services.json`.

### 2. Configure `android/build.gradle`

```gradle
buildscript {
    dependencies {
        classpath 'com.google.gms:google-services:4.4.0'
    }
}
```

### 3. Configure `android/app/build.gradle`

```gradle
apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

android {
    packagingOptions {
        pickFirst 'lib/x86/libc++_shared.so'
        pickFirst 'lib/x86_64/libc++_shared.so'
        pickFirst 'lib/armeabi-v7a/libc++_shared.so'
        pickFirst 'lib/arm64-v8a/libc++_shared.so'
    }
}

// Must be the last line
apply plugin: 'com.google.gms.google-services'
```

### 4. Update `AndroidManifest.xml`

```xml
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.VIBRATE" />

<application ...>
    <!-- Default notification icon -->
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_icon"
        android:resource="@drawable/ic_stat_onesignal_default"
        tools:replace="android:resource" />

    <!-- Default notification channel -->
    <meta-data
        android:name="com.google.firebase.messaging.default_notification_channel_id"
        android:value="channel_default"
        tools:replace="android:value" />
</application>
```

### 5. Add notification icon

Place your notification icon at:
```
android/app/src/main/res/drawable/ic_stat_onesignal_default.png
```

---

## iOS Setup

### 1. Add `GoogleService-Info.plist`

Download from Firebase Console, open Xcode, drag into project root. Ensure "Copy items if needed" is checked and it's added to all targets.

### 2. Enable capabilities in Xcode

**Target → Signing & Capabilities → + Capability:**
- `Push Notifications`
- `Background Modes` → check **Remote notifications**

### 3. Update `AppDelegate.mm`

```objc
#import <Firebase.h>
#import <UserNotifications/UserNotifications.h>

- (BOOL)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  center.delegate = self;
  return YES;
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler
{
  completionHandler(UNNotificationPresentationOptionSound |
                   UNNotificationPresentationOptionAlert |
                   UNNotificationPresentationOptionBadge);
}
```

---

## Usage

### `index.js` — register background handler before AppRegistry

```js
import { AppRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from './src/App';
import { name as appName } from './app.json';
import NotifySphere from 'react-native-notify-sphere';

// Must be called before AppRegistry so the handler is available when the
// app is woken from a terminated state to process a background notification.
AsyncStorage.getItem('@notifysphere_subscription_id').then((subscriptionId) => {
  NotifySphere.setBackgroundHandler({
    subscriptionId: subscriptionId ?? undefined,
    // deliveryUrl: 'https://your-server.com/delivery/confirm', // optional
    // apiKey: 'your-api-key',                                  // optional
  });
});

AppRegistry.registerComponent(appName, () => App);
```

### `App.tsx` — initialize and listen

```tsx
import { useEffect } from 'react';
import { Platform } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';

const APP_ID = 'your-notifysphere-app-id';
const PUSH_TYPE = Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush';

export default function App() {
  useEffect(() => {
    const init = async () => {
      // Safe to call on every app open — only hits the registration API
      // when the FCM token or user details have changed.
      const subscriptionId = await NotifySphere.initialize({
        applicationUserId: 123,
        type: PUSH_TYPE,
        appId: APP_ID,
        name: 'John Doe',
        email: 'john@example.com',
        phone: '9876543210',   // string — preserves leading zeros
        lat: '26.9124',
        long: '75.7873',
        city: 'Jaipur',
        state: 'Rajasthan',
        tags: {
          userType: 'customer',
          premium: 'true',
        },
        debug: __DEV__,        // enable logs in development
      });

      console.log('subscriptionId:', subscriptionId);

      // Update tags independently (no need to pass appId again)
      await NotifySphere.updateTags({
        applicationUserId: 123,
        type: PUSH_TYPE,
        tags: { lastLogin: new Date().toISOString() },
      });
    };

    init();

    // Listen for notification events
    NotifySphere.onNotification((notification, type) => {
      console.log('Notification event:', type, notification);

      if (type === 'press' || type === 'opened' || type === 'initial') {
        // User tapped the notification — navigate, show modal, etc.
      }

      if (type === 'received') {
        // Notification arrived while app was in the foreground
      }
    });

    // Clean up listeners on unmount / logout
    return () => NotifySphere.destroy();
  }, []);
}
```

---

## API Reference

### `NotifySphere.initialize(config)`

Initialises the SDK, registers the device, and sets up listeners. Safe to call on every app open — the registration API is only called when the FCM token or user details have changed.

| Field | Type | Required | Description |
|---|---|---|---|
| `applicationUserId` | `number` | ✅ | Your internal user ID |
| `type` | `string` | ✅ | `'AndroidPush'` or `'IOSPush'` |
| `appId` | `string` | ✅ | NotifySphere App ID |
| `name` | `string` | | User display name |
| `email` | `string` | | User email |
| `phone` | `string` | | User phone (string to preserve leading zeros) |
| `lat` | `string` | | User latitude |
| `long` | `string` | | User longitude |
| `city` | `string` | | User city |
| `state` | `string` | | User state |
| `tags` | `Record<string, string>` | | Custom segmentation tags |
| `baseUrl` | `string` | | Override the API base URL |
| `trackingUrl` | `string` | | Override the press-tracking endpoint |
| `deliveryUrl` | `string` | | Override the delivery-confirmation endpoint |
| `apiKey` | `string` | | Bearer token for tracking endpoints |
| `debug` | `boolean` | | Enable verbose logging (default: `false`) |

**Returns:** `Promise<string | undefined>` — the `subscription_id` from the server.

---

### `NotifySphere.setBackgroundHandler(config?)`

Registers Firebase and Notifee background handlers. **Must be called in `index.js`** before `AppRegistry.registerComponent()`.

When the app is **terminated**, `initialize()` never runs. Pass `subscriptionId` (persisted from the last `initialize()` call) here so delivery receipts include it.

| Field | Type | Description |
|---|---|---|
| `subscriptionId` | `string` | Persisted subscription ID for terminated-state delivery receipts |
| `deliveryUrl` | `string` | Override delivery URL for terminated state |
| `apiKey` | `string` | Override API key for terminated state |

---

### `NotifySphere.onNotification(callback)`

Register a callback for all notification events.

```ts
NotifySphere.onNotification((notification, type) => {
  // type: 'received' | 'press' | 'opened' | 'initial'
  // notification: { title, body, data, image, sound }
});
```

| Event type | When it fires |
|---|---|
| `received` | Notification arrived in the foreground |
| `press` | Notifee background notification was tapped |
| `opened` | App brought from background via notification tap |
| `initial` | App launched from quit state via notification tap |

---

### `NotifySphere.updateTags(params)`

Updates user tags without re-registering the device. `appId` is optional — falls back to the value passed in `initialize()`.

```ts
await NotifySphere.updateTags({
  applicationUserId: 123,
  type: 'AndroidPush',
  tags: { premium: 'true', age: '33' },
});
```

---

### `NotifySphere.destroy()`

Unsubscribes all active listeners and resets internal state. Call this on logout or when you no longer need notifications.

```ts
NotifySphere.destroy();
```

---

### `NotifySphere.checkApplicationPermission()`

Requests notification permission and returns `true` if granted. Called automatically by `initialize()`.

---

## FCM Payload Format

NotifySphere expects **data-only** FCM messages (no `notification` field). This is required for delivery confirmation to work in the terminated state.

```json
{
  "to": "<device-fcm-token>",
  "data": {
    "title": "Hello!",
    "body": "You have a new message.",
    "notification_id": "uuid-here",
    "sound": "default",
    "imageUrl": "https://example.com/image.jpg",
    "smallIcon": "ic_stat_onesignal_default",
    "redirect_action": "home"
  }
}
```

> **Why data-only?** If a `notification` field is present, the OS handles display silently — your JS code never runs and delivery receipts cannot fire.

### Supported data fields

| Field | Description |
|---|---|
| `title` | Notification title |
| `body` | Notification body |
| `notification_id` | Used for delivery and press tracking |
| `sound` | Sound name (without extension) or `'default'` |
| `imageUrl` | URL for big-picture style notification |
| `smallIcon` | Android small icon resource name (falls back to `ic_stat_onesignal_default`) |
| `actionButtons` | JSON string of Notifee action buttons |

---

## Troubleshooting

### Notifications not displaying on Android

Check that `ic_stat_onesignal_default` exists at `android/app/src/main/res/drawable/`. Without a valid small icon, Android silently drops the notification.

### Delivery receipt not firing in terminated state

Ensure you are sending a **data-only** FCM message (no `notification` field in the payload). Also verify `setBackgroundHandler()` is called in `index.js` before `AppRegistry`.

### `async-storage` v2/v3 build error

Use `@react-native-async-storage/async-storage@^1.23.1`. v2+ requires a custom Maven repository that is not configured by default.

### iOS notifications not working

Push notifications do not work on the iOS Simulator. Test on a real device with push entitlement enabled in your provisioning profile.

### Debug logging

Pass `debug: true` to `initialize()` to enable verbose `[NotifySphere]` logs:

```ts
await NotifySphere.initialize({ ..., debug: __DEV__ });
```

---

## Version History

### v1.1.0 (March 2026)

- **Delivery confirmation API** — fires in foreground, background, and terminated state
- **Smart re-registration** — registration API only called when FCM token or user details change; avoids redundant network call on every app open
- **Automatic token refresh** — `onTokenRefresh` watcher re-registers without requiring `initialize()` again
- **`destroy()` method** — clean listener unsubscription on logout
- **Fixed notification display bug** — `smallIcon`/`largeIcon` empty strings (`""`) now correctly fall back to default icon
- **Fixed `notification_id` typo** — press tracking payload now correctly sends `notification_id`
- **`subscription_id` included** in all tracking API calls
- **`phone` changed to `string`** — prevents corruption of numbers with leading zeros
- **`appId` stored internally** — `updateTags` no longer requires re-passing `appId`
- **Configurable endpoints** — `baseUrl`, `trackingUrl`, `deliveryUrl` in `initialize()`
- **Removed hardcoded auth token** from source code
- **`debug` flag** — all `console.log` calls gated behind `debug: true`
- **Removed unused dependencies** — `react-native-device-info`, `react-native-localize`

### v1.0.1 (January 2026)

- Initial release

---

**Platform Support:** Android ✅ | iOS ✅
