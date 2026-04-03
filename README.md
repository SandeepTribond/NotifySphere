# react-native-notify-sphere

A React Native push notification SDK built on Firebase Cloud Messaging (FCM) and Notifee. Handles delivery tracking, press tracking, user segmentation via tags, and rich notifications — with full Android and iOS support.

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
- ✅ Press / click tracking API
- ✅ Smart re-registration — only calls the API when FCM token or user details change
- ✅ Automatic FCM token refresh handling
- ✅ User segmentation via custom tags
- ✅ Rich notifications — images, custom sounds, action buttons
- ✅ Bearer token authentication on all API calls
- ✅ Full TypeScript support
- ✅ Android & iOS

---

## Prerequisites

- React Native `0.70+`
- A Firebase project with Cloud Messaging enabled
- A **NotifySphere account** with an App ID and API Token

---

## Installation

### Step 1 — Install the package and peer dependencies

```bash
npm install react-native-notify-sphere

# Peer dependencies (native — must be installed in your app)
npm install @react-native-firebase/app
npm install @react-native-firebase/messaging
npm install @notifee/react-native
npm install @react-native-async-storage/async-storage
```

### Step 2 — iOS: install pods

```bash
cd ios && pod install && cd ..
```

---

## Android Setup

### 1. Add `google-services.json`

Download from the Firebase Console and place it at `android/app/google-services.json`.

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

// Must be the last line in the file
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

Download from the Firebase Console, open Xcode, and drag the file into your project root. Make sure "Copy items if needed" is checked and it is added to all targets.

### 2. Enable capabilities in Xcode

Go to **Target → Signing & Capabilities → + Capability** and add:
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

You need two things from your NotifySphere dashboard before you start:
- **App ID** — identifies your application
- **API Token** — authenticates all requests to the NotifySphere API

### `index.js` — register the background handler

This **must** be called before `AppRegistry.registerComponent()` so the handler is in place when the app is woken from a terminated state to handle a background notification.

```js
import { AppRegistry } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import App from './src/App';
import { name as appName } from './app.json';
import NotifySphere from 'react-native-notify-sphere';
import { API_TOKEN } from './src/App';

const STORAGE_KEY = '@notifysphere_subscription_id';

// Load the persisted subscription_id so delivery receipts include it
// even when the app starts from a terminated state.
AsyncStorage.getItem(STORAGE_KEY).then((subscriptionId) => {
  NotifySphere.setBackgroundHandler({
    apiKey: API_TOKEN,
    subscriptionId: subscriptionId ?? undefined,
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
export const API_TOKEN = 'your-api-token'; // Get this from your NotifySphere dashboard
const PUSH_TYPE = Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush';

export default function App() {
  useEffect(() => {
    const init = async () => {
      // Safe to call on every app open — only hits the registration API
      // when the FCM token or user details have changed.
      const subscriptionId = await NotifySphere.initialize({
        applicationUserId: 123,   // your internal user ID
        type: PUSH_TYPE,
        appId: APP_ID,
        apiKey: API_TOKEN,
        name: 'John Doe',
        email: 'john@example.com',
        phone: '9876543210',      // string — preserves leading zeros
        lat: '26.9124',
        long: '75.7873',
        city: 'Jaipur',
        state: 'Rajasthan',
        tags: {
          userType: 'customer',
          premium: 'true',
        },
        debug: __DEV__,           // enable verbose logs in development
      });

      console.log('NotifySphere subscriptionId:', subscriptionId);

      // Optionally update tags without re-registering the device
      await NotifySphere.updateTags({
        applicationUserId: 123,
        type: PUSH_TYPE,
        tags: { lastLogin: new Date().toISOString() },
      });
    };

    init();

    // Listen for all notification events
    NotifySphere.onNotification((notification, type) => {
      console.log('Notification event:', type, notification);

      if (type === 'press' || type === 'opened' || type === 'initial') {
        // User tapped the notification — navigate, show modal, etc.
      }

      if (type === 'received') {
        // Notification arrived while the app was in the foreground
      }
    });

    // Clean up listeners on unmount / logout
    return () => NotifySphere.destroy();
  }, []);
}
```

> **Security note:** Never commit your `API_TOKEN` to source control. In production, read it from a secure config file or environment variable (e.g. via `react-native-config`).

---

## API Reference

### `NotifySphere.initialize(config)`

Initialises the SDK, registers the device with the NotifySphere server, and sets up notification listeners. Safe to call on every app open — the registration API is only called when the FCM token or user details have changed since the last run.

**Returns:** `Promise<string | undefined>` — the `subscription_id` assigned by the server.

| Field | Type | Required | Description |
|---|---|---|---|
| `applicationUserId` | `number` | ✅ | Your internal user ID for this device |
| `type` | `string` | ✅ | `'AndroidPush'` or `'IOSPush'` |
| `appId` | `string` | ✅ | Your NotifySphere App ID |
| `apiKey` | `string` | ✅ | Bearer token from your NotifySphere dashboard |
| `name` | `string` | | User display name |
| `email` | `string` | | User email address |
| `phone` | `string` | | User phone number (string to preserve leading zeros) |
| `lat` | `string` | | User latitude |
| `long` | `string` | | User longitude |
| `city` | `string` | | User city |
| `state` | `string` | | User state / region |
| `tags` | `Record<string, string>` | | Custom key-value segmentation tags |
| `baseUrl` | `string` | | Override the API base URL (defaults to hosted service) |
| `trackingUrl` | `string` | | Override the press-tracking endpoint |
| `deliveryUrl` | `string` | | Override the delivery-confirmation endpoint |
| `debug` | `boolean` | | Enable verbose `[NotifySphere]` console logs (default: `false`) |

---

### `NotifySphere.setBackgroundHandler(config?)`

Registers Firebase and Notifee background/terminated-state handlers. **Must be called in `index.js`** before `AppRegistry.registerComponent()`.

When the app is **terminated**, `initialize()` never runs, so any config you passed there is not available. Pass `apiKey` and `subscriptionId` here directly so delivery receipts still work.

| Field | Type | Description |
|---|---|---|
| `apiKey` | `string` | Bearer token — required for authenticated delivery receipts in terminated state |
| `subscriptionId` | `string` | Persisted subscription ID — include it so receipts are linked to the correct device |
| `deliveryUrl` | `string` | Override the delivery URL for terminated state (optional) |

---

### `NotifySphere.onNotification(callback)`

Register a callback to receive all notification events.

```ts
NotifySphere.onNotification((notification, type) => {
  // notification: { title, body, data, image, sound }
  // type: 'received' | 'press' | 'opened' | 'initial'
});
```

| Event type | When it fires |
|---|---|
| `received` | Notification arrived while the app was in the foreground |
| `press` | A Notifee background notification was tapped |
| `opened` | App brought from background via notification tap |
| `initial` | App launched from a quit state via notification tap |

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

| Field | Type | Required | Description |
|---|---|---|---|
| `applicationUserId` | `number` | ✅ | Your internal user ID |
| `type` | `string` | ✅ | `'AndroidPush'` or `'IOSPush'` |
| `tags` | `Record<string, string>` | ✅ | Tags to update |
| `appId` | `string` | | Defaults to the `appId` passed in `initialize()` |

---

### `NotifySphere.destroy()`

Unsubscribes all active listeners and resets internal state. Call this on logout or when you no longer need notifications.

```ts
NotifySphere.destroy();
```

---

### `NotifySphere.checkApplicationPermission()`

Requests notification permission from the OS and returns `true` if granted. Called automatically by `initialize()` — you only need to call this directly if you want to check permission status before initialising.

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

> **Why data-only?** If a `notification` field is present in the FCM payload, the OS handles display silently — your JavaScript never runs and delivery receipts cannot fire in the terminated state.

### Supported `data` fields

| Field | Description |
|---|---|
| `title` | Notification title |
| `body` | Notification body text |
| `notification_id` | ID used for delivery and press tracking |
| `sound` | Sound file name without extension, or `'default'` |
| `imageUrl` | URL for a big-picture style notification image |
| `smallIcon` | Android small icon resource name (falls back to `ic_stat_onesignal_default`) |
| `actionButtons` | JSON string of Notifee action button definitions |

---

## Troubleshooting

### API calls returning 401 Unauthorized

Make sure you are passing `apiKey` in both `initialize()` and `setBackgroundHandler()`. The API Token can be found in your NotifySphere dashboard under your app settings.

### Notifications not displaying on Android

Check that `ic_stat_onesignal_default.png` exists at `android/app/src/main/res/drawable/`. Android silently drops notifications with a missing or invalid small icon.

### Delivery receipt not firing in terminated state

Make sure you are sending a **data-only** FCM message (no `notification` field in the payload). Also confirm that `setBackgroundHandler()` is called in `index.js` before `AppRegistry.registerComponent()`, and that you are passing both `apiKey` and `subscriptionId` to it.

### `async-storage` build error

Use `@react-native-async-storage/async-storage@^1.23.1`. Version 2+ requires a custom Maven repository that is not configured by default in most React Native projects.

### iOS notifications not working

Push notifications do not work on the iOS Simulator. Test on a physical device with a push-enabled provisioning profile.

### Debug logging

Pass `debug: true` (or `debug: __DEV__`) to `initialize()` to see verbose `[NotifySphere]` logs in the Metro console:

```ts
await NotifySphere.initialize({ ..., debug: __DEV__ });
```

---

## Version History

### v1.2.0 (March 2026)

- **Bearer token authentication** — all API endpoints now require an `apiKey` (Bearer token); added to `initialize()`, `registerDevice`, and `setBackgroundHandler()`
- **Updated API URL structure** — endpoints now follow `client/{appId}/...` path pattern
- **Fixed `registerDevice` URL** — corrected a template literal bug that was constructing an invalid URL
- **Fixed `updateTags` URL** — removed incorrect `/apps/` path segment
- **Dynamic tracking / delivery URLs** — `trackingUrl` and `deliveryUrl` are now built with `appId` at runtime rather than using static defaults

### v1.1.0 (January 2026)

- **Delivery confirmation API** — fires in foreground, background, and terminated state
- **Smart re-registration** — registration API only called when FCM token or user details change
- **Automatic token refresh** — `onTokenRefresh` watcher re-registers without requiring another `initialize()` call
- **`destroy()` method** — clean listener unsubscription on logout
- **Configurable endpoints** — `baseUrl`, `trackingUrl`, `deliveryUrl` in `initialize()`
- **`phone` changed to `string`** — prevents corruption of numbers with leading zeros
- **`appId` stored internally** — `updateTags` no longer requires passing `appId` again
- **`debug` flag** — all `console.log` calls gated behind `debug: true`
- **Removed unused dependencies** — `react-native-device-info`, `react-native-localize`

### v1.0.1 (October 2025)

- Initial release

---

**Platform Support:** Android ✅ | iOS ✅
