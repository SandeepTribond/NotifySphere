# NotifySphere Push Notifications Implementation Guide

Complete implementation guide for integrating **react-native-notify-sphere** push notifications in React Native Android/iOS applications.

---

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Installation](#installation)
4. [Android Setup](#android-setup)
5. [iOS Setup](#ios-setup)
6. [Implementation](#implementation)
7. [NotifySphere Admin Panel](#notifysphere-admin-panel)
8. [Testing](#testing)
9. [Troubleshooting](#troubleshooting)
10. [Advanced Features](#advanced-features)

---

## Overview

### What is NotifySphere?

NotifySphere is a custom push notification solution built on top of Firebase Cloud Messaging (FCM) and Notifee, providing:

- **Centralized Management**: Admin panel for sending notifications
- **User Segmentation**: Target users with custom tags
- **Analytics**: Track delivery, opens, and engagement
- **Rich Notifications**: Support for images, sounds, and custom actions
- **Cross-Platform**: Works on both Android and iOS

### Architecture

```
┌─────────────────────────────────────────────┐
│ NotifySphere Admin Panel                    │
│ • Send Notifications                        │
│ • Manage User Segments                      │
│ • View Analytics & Reports                  │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ NotifySphere Backend API                    │
│ (notifysphere.dothejob.in:3008)            │
│ • User Registration & Token Management      │
│ • Tag-based Segmentation                    │
│ • Notification Delivery via Firebase        │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Firebase Cloud Messaging (FCM)              │
│ • Push Notification Delivery                │
│ • Device Token Management                   │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│ Your React Native App                       │
│ • react-native-notify-sphere               │
│ • @react-native-firebase/messaging         │
│ • @notifee/react-native                    │
└─────────────────────────────────────────────┘
```

---

## Prerequisites

### Required Tools

- **Node.js**: v16 or higher
- **React Native**: v0.70+
- **Android Studio**: Latest version (for Android development)
- **Xcode**: Latest version (for iOS development)
- **CocoaPods**: Latest version (for iOS dependencies)

### Firebase Project

1. Create/Select project at [Firebase Console](https://console.firebase.google.com)
2. Enable **Cloud Messaging**
3. Download configuration files:
   - **Android**: `google-services.json`
   - **iOS**: `GoogleService-Info.plist`
4. Get **Firebase Server Key**:
   - Firebase Console → Project Settings → Cloud Messaging → Server Key

### NotifySphere Account

1. Access NotifySphere Admin Panel (contact provider for credentials)
2. Create new application
3. Obtain **App ID** (UUID format, e.g., `123b13cc-7dcb-2dcc-8dde-565433ec8d40`)

---

## Installation

### Step 1: Install Packages

```bash
# Core NotifySphere package
npm install react-native-notify-sphere

# Required Firebase packages
npm install @react-native-firebase/app@22.4.0
npm install @react-native-firebase/messaging@22.4.0

# Notifee for local notifications
npm install @notifee/react-native@9.1.8

# Additional dependencies
npm install react-native-localize
npm install react-native-device-info
npm install axios
```

### Step 2: Link Native Dependencies

```bash
# iOS only - Install pods
cd ios && pod install && cd ..
```

### Step 3: Verify Installation

```bash
# Check if packages are installed
npm list react-native-notify-sphere @react-native-firebase/messaging @notifee/react-native
```

---

## Android Setup

### Step 1: Add Firebase Configuration

**File Location**: `android/app/google-services.json`

1. Download `google-services.json` from Firebase Console
2. Place file in `android/app/` directory

### Step 2: Configure Gradle Files

#### Root build.gradle

**File**: `android/build.gradle`

```gradle
buildscript {
    dependencies {
        // ... other dependencies
        
        // Add Google Services plugin
        classpath 'com.google.gms:google-services:4.4.0'
    }
}
```

#### App build.gradle

**File**: `android/app/build.gradle`

```gradle
apply plugin: "com.android.application"
apply plugin: "com.facebook.react"

// ... other configurations

android {
    // ... android config
    
    // Add packaging options to avoid conflicts
    packagingOptions {
        pickFirst 'lib/x86/libc++_shared.so'
        pickFirst 'lib/x86_64/libc++_shared.so'
        pickFirst 'lib/armeabi-v7a/libc++_shared.so'
        pickFirst 'lib/arm64-v8a/libc++_shared.so'
    }
}

dependencies {
    // ... dependencies
}

// IMPORTANT: Apply Google Services plugin at the very bottom (last line)
apply plugin: 'com.google.gms.google-services'
```

### Step 3: Update AndroidManifest.xml

**File**: `android/app/src/main/AndroidManifest.xml`

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools"
    package="com.yourapp.package">

    <!-- Notification Permissions -->
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.VIBRATE" />
    
    <application
        android:name=".MainApplication"
        android:allowBackup="false"
        android:theme="@style/AppTheme">

        <!-- Firebase Notification Icon -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_icon"
            android:resource="@drawable/ic_stat_notification"
            tools:replace="android:resource" />

        <!-- Notification Color -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_color"
            android:resource="@color/notification_color"
            tools:replace="android:resource" />

        <!-- Default Notification Channel -->
        <meta-data
            android:name="com.google.firebase.messaging.default_notification_channel_id"
            android:value="default_notification_channel"
            tools:replace="android:value" />

        <!-- Your Activities -->
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <!-- ... intent filters ... -->
        </activity>

    </application>
</manifest>
```

### Step 4: Create Resource Files

#### Colors

**File**: `android/app/src/main/res/values/colors.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="notification_color">#FF6B6B</color>
    <color name="ic_launcher_background">#FFFFFF</color>
    <color name="white">#FFFFFF</color>
    <color name="black">#000000</color>
</resources>
```

#### Strings

**File**: `android/app/src/main/res/values/strings.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">Your App Name</string>
</resources>
```

#### Styles

**File**: `android/app/src/main/res/values/styles.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="android:textColor">#000000</item>
    </style>
</resources>
```

### Step 5: Add Notification Icon

Create a notification icon and place it in:
- `android/app/src/main/res/drawable/ic_stat_notification.png`

Or use an existing icon in your project.

---

## iOS Setup

### Step 1: Add Firebase Configuration

1. Download `GoogleService-Info.plist` from Firebase Console
2. Open Xcode: `open ios/YourApp.xcworkspace`
3. Drag and drop `GoogleService-Info.plist` into Xcode project
4. Ensure "Copy items if needed" is checked
5. Add to all targets

### Step 2: Install CocoaPods

```bash
cd ios
pod install
cd ..
```

### Step 3: Enable Capabilities in Xcode

1. Open `ios/YourApp.xcworkspace` in Xcode
2. Select Project → Target → **Signing & Capabilities**
3. Click **+ Capability**
4. Add **"Push Notifications"**
5. Click **+ Capability** again
6. Add **"Background Modes"**
   - Check: ☑️ **Remote notifications**

### Step 4: Update AppDelegate

**File**: `ios/YourApp/AppDelegate.mm` (or `AppDelegate.m`)

#### Add Imports

```objc
#import <Firebase.h>
#import <UserNotifications/UserNotifications.h>
```

#### Update didFinishLaunchingWithOptions

```objc
- (BOOL)application:(UIApplication *)application 
    didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
  // Initialize Firebase
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }
  
  // Set up notification center
  UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
  center.delegate = self;
  
  // ... rest of your existing code
  
  return YES;
}
```

#### Add Notification Handler Methods

```objc
// Handle foreground notifications
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions options))completionHandler
{
  completionHandler(UNNotificationPresentationOptionSound | 
                   UNNotificationPresentationOptionAlert | 
                   UNNotificationPresentationOptionBadge);
}

// Handle notification tap
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void(^)(void))completionHandler
{
  completionHandler();
}
```

---

## Implementation

### Step 1: Create NotificationHelper Component

**File**: `src/utils/NotificationHelper.tsx`

```typescript
import { useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import NotifySphere from 'react-native-notify-sphere';
import { useNavigation } from '@react-navigation/native';

interface Props {
  navigationRef?: any;
}

export let deviceInfo: any = {};

const NotificationHelper: React.FC<Props> = (props) => {
  const navigation = useNavigation();

  // Handle notification click
  const onClickNotification = useCallback(
    (notificationData: any, type?: string) => {
      console.log('📬 Notification Clicked');
      console.log('Type:', type);
      console.log('Data:', notificationData);

      const data = notificationData?.data || {};
      const action = data?.redirect_action;

      // Navigate based on action
      switch (action) {
        case 'home':
          navigation.navigate('Home');
          break;
        
        case 'profile':
          navigation.navigate('Profile');
          break;
        
        case 'details':
          if (data?.itemId) {
            navigation.navigate('Details', { id: data.itemId });
          }
          break;
        
        default:
          // Default navigation
          console.log('No specific action, staying on current screen');
          break;
      }
    },
    [navigation]
  );

  useEffect(() => {
    const initializeNotifications = async () => {
      try {
        console.log('🔥 Initializing NotifySphere...');

        // Get user information (replace with your actual user data)
        const userId = 12345; // Your user ID
        const userName = 'John Doe';
        const userEmail = 'john@example.com';
        const userPhone = 9876543210;

        // Initialize NotifySphere
        const subscriptionId = await NotifySphere.initialize({
          applicationUserId: userId,
          type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
          name: userName,
          email: userEmail,
          appId: 'YOUR_NOTIFYSPHERE_APP_ID', // Replace with your App ID
          phone: userPhone,
          lat: '26.9124', // Optional: User latitude
          long: '75.7873', // Optional: User longitude
          city: 'Jaipur', // Optional: User city
          state: 'Rajasthan', // Optional: User state
          tags: {
            userType: 'customer',
            premium: 'true',
            // Add your custom tags
          },
        });

        console.log('✅ NotifySphere Initialized!');
        console.log('Subscription ID:', subscriptionId);

        // Store subscription ID
        deviceInfo.userId = subscriptionId;

        // Update tags (optional - for better targeting)
        NotifySphere.updateTags({
          appId: 'YOUR_NOTIFYSPHERE_APP_ID',
          applicationUserId: userId,
          type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
          tags: {
            lastLogin: new Date().toISOString(),
            appVersion: '1.0.0',
            // Add more tags as needed
          },
        });

        // Set notification callback
        NotifySphere.onNotification((notification, type) => {
          console.log('🔔 Notification Callback Triggered');
          console.log('Type:', type); // 'opened', 'initial', 'press'
          
          // Handle notification
          onClickNotification(notification, type);
        });

        console.log('✅ Notification handlers registered!');
        
      } catch (error) {
        console.error('❌ NotifySphere Error:', error);
      }
    };

    initializeNotifications();
  }, [onClickNotification]);

  return null;
};

export default NotificationHelper;
```

### Step 2: Add to Your App

**File**: `App.tsx`

```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { Provider } from 'react-redux';
import NotificationHelper from './src/utils/NotificationHelper';
import store from './src/redux/store';

const App = () => {
  return (
    <Provider store={store}>
      <NavigationContainer>
        {/* Your navigation stack */}
        <YourNavigationStack />
        
        {/* Add NotificationHelper */}
        <NotificationHelper />
      </NavigationContainer>
    </Provider>
  );
};

export default App;
```

### Step 3: Replace App ID

In `NotificationHelper.tsx`, replace:
```typescript
appId: 'YOUR_NOTIFYSPHERE_APP_ID'
```

With your actual NotifySphere App ID from the admin panel.

---

## NotifySphere Admin Panel

### Step 1: Create Application

1. **Login** to NotifySphere Admin Panel
2. Click **"Create New App"**
3. Fill in details:
   - **App Name**: Your application name
   - **Platform**: Select Android and/or iOS
   - **Package Name**: Your app's package name
4. Click **Save**
5. **Copy the App ID** (UUID format)

### Step 2: Configure Firebase

1. Go to your app's settings in NotifySphere Admin
2. Click **"Firebase Configuration"**
3. Add **Firebase Server Key**:
   - Get from: Firebase Console → Project Settings → Cloud Messaging → Server Key
4. Save configuration

### Step 3: Test Setup

1. Go to **"Send Notification"** in admin panel
2. Select your app
3. Fill in basic details:
   - **Title**: Test Notification
   - **Body**: This is a test message
4. Click **Send**

---

## Testing

### Method 1: Via NotifySphere Admin Panel

**Recommended for production testing**

1. Login to NotifySphere Admin Panel
2. Navigate to **"Send Notification"**
3. Select your application
4. Configure notification:

```json
{
  "title": "New Message",
  "body": "You have received a new message!",
  "data": {
    "redirect_action": "details",
    "itemId": "123",
    "type": "message"
  }
}
```

5. Target:
   - **All Users**: Send to everyone
   - **By Tags**: Target specific user segments
   - **Specific Users**: Enter user IDs

6. Click **Send**

### Method 2: Via Firebase Console

**Good for quick testing**

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Select your project
3. Navigate to **Cloud Messaging** → **Send your first message**
4. Click **"Send test message"**
5. Get FCM token from app logs:

```bash
# Android
npx react-native log-android | grep "fcmToken"

# iOS
npx react-native log-ios | grep "fcmToken"
```

6. Paste token and click **Test**

### Method 3: Via Postman/API

**For automated testing**

```http
POST https://fcm.googleapis.com/fcm/send
Content-Type: application/json
Authorization: key=YOUR_FIREBASE_SERVER_KEY

{
  "to": "DEVICE_FCM_TOKEN",
  "notification": {
    "title": "Test Notification",
    "body": "Testing push notifications"
  },
  "data": {
    "redirect_action": "home",
    "customKey": "customValue"
  },
  "android": {
    "priority": "high"
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    }
  }
}
```

### Test Scenarios

#### ✅ Foreground Testing (App Open)

**Expected Behavior:**
- Notification displays as banner/head-up notification
- Sound plays (if configured)
- Vibration occurs (if configured)
- Tapping navigates to specified screen

**Verification:**
```bash
npx react-native log-android | grep "displayLocalNotification"
# Should see: "✅ NOTIFICATION DISPLAYED SUCCESSFULLY!"
```

#### ✅ Background Testing (App Minimized)

**Expected Behavior:**
- Notification appears in notification tray
- Tapping opens app
- Navigation occurs after app opens

#### ✅ Killed State Testing (App Closed)

**Expected Behavior:**
- Notification appears in notification tray
- Tapping launches app
- Navigation occurs after app launches

**Verification:**
```bash
npx react-native log-android | grep "Notification Callback"
# Should see: Type: 'initial' or 'opened'
```

---

## Troubleshooting

### Common Issues

#### Issue: "No FCM Token Received"

**Symptoms:**
- No token in logs
- Notifications not received

**Solutions:**

1. **Check Firebase Configuration:**
```bash
# Android
ls -la android/app/google-services.json

# iOS
ls -la ios/GoogleService-Info.plist
```

2. **Verify Google Services Plugin:**
```bash
cat android/app/build.gradle | grep "google-services"
# Should be at the very bottom of the file
```

3. **Check Permissions:**
```bash
# Android - Check if permission granted
adb shell dumpsys package com.yourapp.package | grep "POST_NOTIFICATIONS"
```

#### Issue: "Foreground Notifications Not Displaying"

**Error in logs:**
```
❌ ERROR in displayLocalNotification
Error: largeIcon expected a valid string URL
```

**Solution:**

The package has a known issue with empty `largeIcon` field. Fix by editing package:

```bash
code node_modules/react-native-notify-sphere/src/index.tsx
```

Find `displayLocalNotification` function and update:

```typescript
// Validate largeIcon before using
const largeIconRaw = remoteMessage.data?.largeIcon;
const validLargeIcon = largeIconRaw && largeIconRaw.trim() !== '' 
  ? largeIconRaw 
  : undefined;

// Only add if valid
if (validLargeIcon) {
  notificationConfig.android.largeIcon = validLargeIcon;
}
```

#### Issue: "App Crashes on Notification"

**Symptoms:**
- App crashes when notification received
- No error in React Native logs

**Solutions:**

1. **Check Native Logs:**
```bash
# Android
adb logcat | grep -i "error\|exception"

# iOS
# View in Xcode console
```

2. **Verify Channel Creation:**
```bash
npx react-native log-android | grep "Channel created"
```

3. **Check Sound Files:**
- Ensure custom sound files exist in `android/app/src/main/res/raw/`
- Use `default` sound if custom sound missing

#### Issue: "iOS Notifications Not Working"

**Common Causes:**

1. **Testing on Simulator:**
   - Push notifications **DO NOT work** on iOS Simulator
   - Must test on real device

2. **Missing Capabilities:**
   - Xcode → Target → Signing & Capabilities
   - Verify "Push Notifications" is enabled
   - Verify "Background Modes" → "Remote notifications" is checked

3. **Firebase Not Initialized:**
```objc
// Check AppDelegate.mm
if ([FIRApp defaultApp] == nil) {
  [FIRApp configure]; // Must be present
}
```

4. **Provisioning Profile:**
   - Ensure push notifications are enabled in Apple Developer Portal
   - Regenerate provisioning profile if needed

#### Issue: "Notification Data Not Received in Callback"

**Symptoms:**
- Notification displays
- Callback triggered
- But `data` object is empty

**Solution:**

Check notification payload structure:

```json
{
  "notification": {
    "title": "Title",
    "body": "Body"
  },
  "data": {
    "redirect_action": "home",
    "itemId": "123"
  }
}
```

Ensure `data` is separate from `notification` object.

### Debug Commands

```bash
# Android - View all logs
npx react-native log-android

# Android - Filter notification logs
npx react-native log-android | grep -E "NotifySphere|fcm|notification"

# iOS - View all logs
npx react-native log-ios

# iOS - Filter notification logs
npx react-native log-ios | grep -E "NotifySphere|Firebase|notification"

# Check app processes
adb shell ps | grep com.yourapp.package

# Kill app (Android)
adb shell am force-stop com.yourapp.package

# Clear app data (Android)
adb shell pm clear com.yourapp.package
```

---

## Advanced Features

### Custom Tags for User Segmentation

```typescript
NotifySphere.updateTags({
  appId: 'YOUR_APP_ID',
  applicationUserId: userId,
  type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
  tags: {
    // Demographic
    age: '25-34',
    gender: 'male',
    location: 'New York',
    
    // Behavioral
    purchaseFrequency: 'high',
    lastPurchase: '2024-01-01',
    totalSpent: '5000',
    
    // Engagement
    appVersion: '2.1.0',
    lastLogin: new Date().toISOString(),
    notificationsEnabled: 'true',
    
    // Custom
    interests: 'sports,technology',
    membershipLevel: 'premium',
  },
});
```

### Rich Notifications with Images

Send from admin panel or API:

```json
{
  "notification": {
    "title": "New Product Launch",
    "body": "Check out our latest collection!",
    "image": "https://example.com/image.jpg"
  },
  "data": {
    "redirect_action": "product_details",
    "productId": "P123"
  }
}
```

### Custom Sounds

**Android:**

1. Add sound file: `android/app/src/main/res/raw/custom_sound.mp3`
2. Send notification with sound:

```json
{
  "data": {
    "sound": "custom_sound"
  }
}
```

**iOS:**

1. Add sound file to Xcode project
2. Ensure file is added to target
3. Send notification with sound in payload

### Action Buttons

```json
{
  "data": {
    "actionButtons": "[{\"title\":\"View\",\"pressAction\":{\"id\":\"view\"}},{\"title\":\"Dismiss\",\"pressAction\":{\"id\":\"dismiss\"}}]"
  }
}
```

### Notification Scheduling

Currently, NotifySphere handles immediate delivery. For scheduled notifications, use the admin panel's scheduling feature or implement server-side scheduling.

### Analytics Tracking

NotifySphere automatically tracks:
- Notification delivery
- Open rates
- Click rates
- Device information

View in admin panel: **Analytics → Notification Reports**

---

## Best Practices

### 1. User Privacy

```typescript
// Request permission gracefully
const hasPermission = await NotifySphere.checkApplicationPermission();

if (!hasPermission) {
  // Show explanation UI
  showPermissionExplanation();
  // Then request
  await requestPermission();
}
```

### 2. Tag Management

```typescript
// Update tags when relevant data changes
useEffect(() => {
  if (user.profileUpdated) {
    NotifySphere.updateTags({
      appId: APP_ID,
      applicationUserId: user.id,
      type: Platform.OS === 'android' ? 'AndroidPush' : 'IOSPush',
      tags: {
        profileComplete: 'true',
        lastUpdated: new Date().toISOString(),
      },
    });
  }
}, [user.profileUpdated]);
```

### 3. Error Handling

```typescript
try {
  const subscriptionId = await NotifySphere.initialize({...});
  
  if (!subscriptionId) {
    // Handle initialization failure
    logError('NotifySphere initialization failed');
    // Retry or fallback
  }
} catch (error) {
  // Handle error gracefully
  logError('NotifySphere error:', error);
  // Show user-friendly message if needed
}
```

### 4. Testing Checklist

- [ ] Test on real devices (iOS especially)
- [ ] Test all notification states (foreground, background, killed)
- [ ] Test navigation for each `redirect_action`
- [ ] Test with different payload structures
- [ ] Test with images
- [ ] Test with custom sounds
- [ ] Test user segmentation with tags
- [ ] Verify analytics tracking
- [ ] Test opt-out functionality

---

## Package Information

### Dependencies

```json
{
  "react-native-notify-sphere": "^1.0.0",
  "@react-native-firebase/app": "22.4.0",
  "@react-native-firebase/messaging": "22.4.0",
  "@notifee/react-native": "9.1.8",
  "react-native-device-info": "latest",
  "react-native-localize": "latest",
  "axios": "latest"
}
```

### Package Features

- ✅ Automatic foreground notification display
- ✅ Background notification handling
- ✅ Notification tap handling
- ✅ Custom tags for segmentation
- ✅ Image support in notifications
- ✅ Custom sound support
- ✅ Analytics tracking
- ✅ Action buttons support
- ✅ Cross-platform (Android & iOS)

---

## Resources

### Documentation

- [Firebase Cloud Messaging](https://firebase.google.com/docs/cloud-messaging)
- [Notifee Documentation](https://notifee.app/react-native/docs/overview)
- [React Native Firebase](https://rnfirebase.io/)

### Useful Commands

```bash
# Clean build
cd android && ./gradlew clean && cd ..
rm -rf node_modules && npm install

# iOS clean
cd ios && pod deintegrate && pod install && cd ..

# Run app
npm run android
npm run ios

# View logs
npx react-native log-android
npx react-native log-ios
```

---

## Support

For issues or questions:

1. Check logs for error messages
2. Verify all configuration steps
3. Test on real devices (especially iOS)
4. Check Firebase and NotifySphere admin panels
5. Contact NotifySphere support if needed

---

## Version History

- **v1.0.0** (January 2026) - Initial implementation guide

---

**Created:** January 7, 2026  
**Status:** ✅ Production Ready  
**Platform Support:** Android ✅ | iOS ✅
