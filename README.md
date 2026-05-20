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
7. [Upgrading from earlier versions](#upgrading-from-earlier-versions)
8. [API Reference](#api-reference)
9. [FCM Payload Format](#fcm-payload-format)
10. [Troubleshooting](#troubleshooting)
11. [Version History](#version-history)

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

> ⚠️ **Critical:** `setBackgroundHandler()` MUST be called **synchronously at the top of `index.js`**, before `AppRegistry.registerComponent()`. Do **not** wrap it in `AsyncStorage.getItem().then(...)`, `setTimeout`, `Promise.then(...)`, or any other async callback. Firebase requires the background handler to be registered at module-evaluation time — otherwise notifications delivered while the app is in the background or killed will be dropped because no handler exists yet when the headless JS task starts.

Pass `appId` and `apiKey` here so the SDK can build the delivery URL and authenticate the receipt even when the app is launched from a killed state (in that case `initialize()` from `App.tsx` hasn't run yet). The `subscription_id` is loaded automatically from AsyncStorage inside the handler — you don't need to pass it.

```js
import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import NotifySphere from 'react-native-notify-sphere';
import { APP_ID, API_TOKEN } from './src/App';

// ✅ Synchronous and at the top — before AppRegistry.registerComponent.
NotifySphere.setBackgroundHandler({
  appId: APP_ID,
  apiKey: API_TOKEN,
});

AppRegistry.registerComponent(appName, () => App);
```

❌ **Do NOT do this** — it breaks background and terminated-state delivery receipts because the handler isn't registered when the message arrives:

```js
// ❌ BROKEN — handler is registered asynchronously, too late for FCM
AsyncStorage.getItem(STORAGE_KEY).then((subscriptionId) => {
  NotifySphere.setBackgroundHandler({ apiKey: API_TOKEN, subscriptionId });
});
AppRegistry.registerComponent(appName, () => App);
```

### `App.tsx` — initialize and listen

> Export `APP_ID` and `API_TOKEN` from this file so `index.js` can import them for `setBackgroundHandler()`. Keep them in one place — it prevents drift between the two entry points.

```tsx
import { useEffect } from 'react';
import { Platform } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';

export const APP_ID = 'your-notifysphere-app-id';
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

## Upgrading from earlier versions

> ⚠️ **`npm update` alone is NOT enough.** You must also edit two files in your own app: `index.js` and `App.tsx`. The npm package only ships the SDK source — it cannot modify your application's entry point.

### Why you have to edit `index.js` manually

`index.js` lives in your app's project root, not inside the npm package. `npm install` only writes to `node_modules/react-native-notify-sphere/`:

```
your-app/
├── index.js                              ← YOUR file. npm never touches this.
├── src/App.tsx                           ← YOUR file. npm never touches this.
└── node_modules/
    └── react-native-notify-sphere/
        └── lib/...                       ← only this gets updated by npm
```

The `example/index.js` you see in this repo is reference documentation — your actual `index.js` is a copy you maintain in your own app.

### Migrating to v1.2.3+

If you're upgrading from v1.2.0 / v1.2.1 / v1.2.2, do this:

**Step 1 — `npm install react-native-notify-sphere@latest`**

**Step 2 — Edit your `index.js`.** Remove any async wrapping (`AsyncStorage.getItem().then(...)`, `setTimeout`, etc.) around `setBackgroundHandler()`, and add `appId` to the config:

```diff
  import { AppRegistry } from 'react-native';
- import AsyncStorage from '@react-native-async-storage/async-storage';
  import App from './src/App';
  import { name as appName } from './app.json';
  import NotifySphere from 'react-native-notify-sphere';
- import { API_TOKEN } from './src/App';
+ import { APP_ID, API_TOKEN } from './src/App';

- const STORAGE_KEY = '@notifysphere_subscription_id';
-
- AsyncStorage.getItem(STORAGE_KEY).then((subscriptionId) => {
-   NotifySphere.setBackgroundHandler({
-     apiKey: API_TOKEN,
-     subscriptionId: subscriptionId ?? undefined,
-   });
- });
+ // Must be synchronous and at the top — before AppRegistry.registerComponent.
+ NotifySphere.setBackgroundHandler({
+   appId: APP_ID,
+   apiKey: API_TOKEN,
+ });

  AppRegistry.registerComponent(appName, () => App);
```

**Step 3 — Edit your `App.tsx`.** Export `APP_ID` so `index.js` can import it (you were probably already exporting `API_TOKEN`):

```diff
- const APP_ID = 'your-notifysphere-app-id';
+ export const APP_ID = 'your-notifysphere-app-id';
  export const API_TOKEN = 'your-api-token';
```

**Step 4 — Verify your backend sends data-only FCM payloads.** This was already required, but it's the #1 cause of "delivery receipt works in foreground only." See [FCM Payload Format](#fcm-payload-format).

### Why both `index.js` and the FCM payload matter

| Where the bug is | What goes wrong | Symptom |
|---|---|---|
| `setBackgroundHandler()` wrapped in `.then()` | Firebase requires synchronous handler registration. The async callback resolves *after* the headless JS task already started, so the handler is missing when FCM tries to deliver. | Receipt fails in **killed** state |
| Missing `appId` in `setBackgroundHandler()` | The SDK can't compute the delivery URL without it (because `initialize()` hasn't run yet in killed state). `axios.post('', ...)` fails silently. | Receipt fails in **killed** state |
| FCM payload contains top-level `notification` block | Android FCM auto-displays the notification in the system tray and never wakes JS. | Receipt fails in **background** and **killed** states |

All three need to be correct for the delivery confirmation API to fire in every app state.

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

Registers Firebase and Notifee background/terminated-state handlers. **Must be called synchronously in `index.js`** before `AppRegistry.registerComponent()` — see the warning in the [Usage](#indexjs--register-the-background-handler) section.

When the app is **terminated**, `initialize()` never runs, so any config you passed there is not available. Pass `appId` and `apiKey` here so the SDK can derive the default `deliveryUrl` (`${baseUrl}${appId}/delivery/confirm`) and authenticate the receipt. The `subscription_id` is read from AsyncStorage inside the handler automatically — passing it explicitly is optional.

| Field | Type | Description |
|---|---|---|
| `appId` | `string` | Your NotifySphere App ID — used to derive the default `deliveryUrl` when the app starts from a killed state (highly recommended) |
| `apiKey` | `string` | Bearer token — required for authenticated delivery receipts in background/terminated state |
| `baseUrl` | `string` | Override the API base URL (optional, defaults to the hosted service) |
| `deliveryUrl` | `string` | Override the full delivery-confirmation URL (optional — only needed if your endpoint doesn't follow the default `{baseUrl}{appId}/delivery/confirm` pattern) |
| `subscriptionId` | `string` | Persisted subscription ID (optional — automatically loaded from AsyncStorage inside the handler if omitted) |
| `debug` | `boolean` | Enable verbose `[NotifySphere]` logs in the background/terminated context (default: `false`) |

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

NotifySphere expects **mixed payloads** in production — i.e. send both a top-level `notification` field (for OS auto-display) AND a `data` field (for delivery tracking and routing). The SDK delegates background/terminated display to the OS and uses the JS background handler only to fire the delivery-confirmation API.

```json
{
  "to": "<device-fcm-token>",
  "notification": {
    "title": "Hello!",
    "body": "You have a new message."
  },
  "data": {
    "notification_id": "uuid-here",
    "sound": "default",
    "imageUrl": "https://example.com/image.jpg",
    "smallIcon": "ic_stat_onesignal_default",
    "redirect_action": "home",
    "channelId": "channel_default"
  },
  "android": {
    "priority": "high"
  }
}
```

> **Why both `notification` and `data`?**
> - The `notification` block lets the OS auto-display the push in background/terminated state with sound, channel, and icon set up automatically — no JS bundle has to load to show it. This is what makes notifications reliable when the app is killed.
> - The `data` block carries routing/tracking metadata (`notification_id`, `redirect_action`, etc.) that fires the JS background handler so the SDK can POST to the delivery-confirmation endpoint.
>
> **Don't worry about duplicates.** Since v1.2.5 the SDK no longer renders notifications from its background handler — display is delegated entirely to the OS. The handler only fires the delivery API. So you will never see two notifications for one push.
>
> **Foreground behavior** is unchanged — the SDK draws notifications via Notifee when the app is in the foreground, since FCM doesn't auto-display there.

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

### Delivery receipt fires in foreground but NOT in background or terminated state

This is the most common integration bug. There are two independent causes — check both:

**1. Your FCM payload is not data-only.**

Android FCM only invokes your JS background handler for **data-only messages** (no `notification` field at the top level). If your payload looks like this — it's broken:

```json
{
  "to": "...",
  "notification": { "title": "Hi", "body": "Hello" },   ← REMOVE this block
  "data": { "notification_id": "..." }
}
```

Move `title` and `body` into `data` and remove the top-level `notification` block. See [FCM Payload Format](#fcm-payload-format) for the correct shape.

**2. `setBackgroundHandler()` is registered asynchronously.**

If your `index.js` wraps `setBackgroundHandler()` inside `AsyncStorage.getItem().then(...)`, `setTimeout`, a `Promise.then(...)`, or any async callback, the handler is registered *after* `AppRegistry.registerComponent()` runs. When FCM delivers a message to a killed app, no handler exists yet and the message is dropped. Move the call to the top of `index.js`:

```js
// ✅ Correct
NotifySphere.setBackgroundHandler({ appId: APP_ID, apiKey: API_TOKEN });
AppRegistry.registerComponent(appName, () => App);
```

**3. Quick diagnostic.**

Run `adb logcat | grep NotifySphere` while triggering a background notification. The SDK logs `[NotifySphere] background handler fired...` at the top of the handler. If you see this line but the receipt POST never goes out, check your `apiKey` and network. If you don't see it at all, the FCM payload is the cause (#1 above) — the OS swallowed the message and JS never ran.

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

### v1.2.6 (May 2026)

- **Fix: duplicate / blank notifications in background and terminated state** — the JS background handler no longer renders notifications via Notifee at all. Display in background / terminated state is now delegated entirely to FCM (Android) / APNs (iOS), which auto-render notifications whenever the payload includes a top-level `notification` block. The handler is now single-purpose: fire the delivery-confirmation API. Previously, even with payload-shape checks, edge cases (e.g. `notification: { imageUrl: ... }` with no title/body, or backends sending both fields) caused the OS and Notifee to each post one notification — the user saw "one with the message, one blank". That category of bug is structurally impossible now.
- **Payload format updated** — `README.md → FCM Payload Format` now documents **mixed payloads** (top-level `notification` + `data`) as the recommended shape. The earlier "data-only required" guidance has been dropped because the SDK no longer needs to draw the notification itself.
- **`displayLocalNotification` is now public** — consumers who genuinely need data-only payloads (rare) can call `NotifySphere.displayLocalNotification(remoteMessage)` themselves from a `notifee.onBackgroundEvent` handler.
- **Fix: no sound when no `channelId` is provided in the payload** — `channel_default` and channels created via `ensureChannel` were created without an explicit `sound` field. Android NotificationChannels are immutable after first creation, so if anything (e.g. the FCM library or a previous app version) created the channel silently first, every push to that channel stayed silent forever. The SDK now sets `sound: 'default'` explicitly so Notifee binds the channel to the system default ringtone.
- **Fix: terminated-state notifications popping in and disappearing** — earlier development of v1.2.5 called `notifee.deleteChannel('channel_default')` inside `setBackgroundHandler` to migrate broken silent channels from v1.2.3 / v1.2.4. On Android, deleting a channel also cancels every active notification posted to it — so when FCM auto-displayed a notification in terminated state and our JS bundle then loaded and ran the migration a fraction of a second later, the notification was destroyed before the user could interact with it. The channel migration has been moved into `initialize()` (foreground-only, guarded by an AsyncStorage flag so it runs exactly once per install) and `setBackgroundHandler` now only calls the idempotent `notifee.createChannel`.
- **One-time channel migration** — to undo the broken `channel_default` already on user devices from v1.2.3 / v1.2.4, `initialize()` runs a one-shot migration (delete + recreate the channel) the first time it executes on v1.2.5+, then sets `@notifysphere_channel_default_migrated_v1` in AsyncStorage so it never runs again. Users will hear the correct sound from the first push after the app is opened once on v1.2.5.
- **Backend-configured channels** — `createChannelsFromConfig` now always passes an explicit `sound` value (`'default'`, `''` for None, or the custom filename) instead of omitting the field, for the same immutability reason as above.

### v1.2.4 (May 2026)

- **Hotfix: production API URL** — v1.2.3 was accidentally published with the staging URL (`apinotify.dothejob.in`) baked into the compiled `lib/`. v1.2.4 ships the correct production URL (`api.notifysphere.in`). All consumers on v1.2.3 must upgrade to v1.2.4 — no other code changes required.

### v1.2.3 (May 2026)

> ⚠️ **Do not use v1.2.3** — it shipped with the staging API URL. Upgrade directly to v1.2.4.
>
> 🛠️ **This release requires changes to your `index.js` and `App.tsx`. `npm update` alone is not enough.** See [Upgrading from earlier versions](#upgrading-from-earlier-versions) for the diff.

- **Fix: background & terminated-state delivery confirmation regression** — `setBackgroundHandler()` no longer requires asynchronous setup in `index.js`. The SDK now reads the cached `subscription_id` from AsyncStorage *inside* the handler, so consumers can (and must) call `setBackgroundHandler()` synchronously at the top of `index.js`.
- **`setBackgroundHandler({ appId, baseUrl })`** — new optional fields so the SDK can derive the default `deliveryUrl` when launched from a killed state (where `initialize()` hasn't run).
- **Diagnostic log** — `setBackgroundMessageHandler` now logs `[NotifySphere] background handler fired...` on every invocation to make it easy to verify the handler is wired up correctly via `adb logcat`.

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
