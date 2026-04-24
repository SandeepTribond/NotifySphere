//
//  NotificationService.swift
//  NotifySphere
//
//  Created by Sandeep Joshi on 14/04/26.
//

import UserNotifications

class NotificationService: UNNotificationServiceExtension {

  var contentHandler: ((UNNotificationContent) -> Void)?
  var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(_ request: UNNotificationRequest,
                           withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    self.contentHandler = contentHandler
    self.bestAttemptContent = (request.content.mutableCopy() as? UNMutableNotificationContent)

    guard let bestAttemptContent = self.bestAttemptContent else {
      contentHandler(request.content)
      return
    }

    NSLog("🔔 [NotifySphere Ext] didReceive")

    // ─── Extract image URL from payload (multiple possible keys) ─────────
    var imageUrlString: String?
    let userInfo = request.content.userInfo

    if let aps = userInfo["aps"] as? [String: Any],
       let img = aps["image"] as? String, !img.isEmpty {
      imageUrlString = img
    } else if let fcm = userInfo["fcm_options"] as? [String: Any],
              let img = fcm["image"] as? String, !img.isEmpty {
      imageUrlString = img
    } else if let img = userInfo["imageUrl"] as? String, !img.isEmpty {
      imageUrlString = img
    } else if let img = userInfo["image"] as? String, !img.isEmpty {
      imageUrlString = img
    } else if let data = userInfo["data"] as? [String: Any] {
      imageUrlString = (data["imageUrl"] as? String) ?? (data["image"] as? String)
    }

    guard var urlString = imageUrlString else {
      NSLog("🔔 [NotifySphere Ext] No image URL in payload")
      contentHandler(bestAttemptContent)
      return
    }

    // Fix accidental double-slashes in the path (preserve https:// scheme)
    if let schemeEnd = urlString.range(of: "://") {
      let scheme = String(urlString[..<schemeEnd.upperBound])
      var rest = String(urlString[schemeEnd.upperBound...])
      while rest.contains("//") {
        rest = rest.replacingOccurrences(of: "//", with: "/")
      }
      urlString = scheme + rest
    }

    guard let url = URL(string: urlString) else {
      NSLog("🔔 [NotifySphere Ext] Invalid URL: \(urlString)")
      contentHandler(bestAttemptContent)
      return
    }

    // ─── Download image and attach ────────────────────────────────────────
    let config = URLSessionConfiguration.default
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 20

    URLSession(configuration: config).downloadTask(with: url) { downloadedUrl, response, error in
      defer {
        // Always deliver something, with or without attachment
      }

      if let error = error {
        NSLog("🔔 [NotifySphere Ext] Download error: \(error.localizedDescription)")
        contentHandler(bestAttemptContent)
        return
      }

      if let http = response as? HTTPURLResponse, http.statusCode >= 400 {
        NSLog("🔔 [NotifySphere Ext] HTTP \(http.statusCode) for \(urlString)")
        contentHandler(bestAttemptContent)
        return
      }

      guard let downloadedUrl = downloadedUrl else {
        contentHandler(bestAttemptContent)
        return
      }

      let fm = FileManager.default
      let ext = url.pathExtension.isEmpty ? "png" : url.pathExtension
      let tmpUrl = fm.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")

      do {
        try fm.moveItem(at: downloadedUrl, to: tmpUrl)
        let attachment = try UNNotificationAttachment(identifier: "image", url: tmpUrl, options: nil)
        bestAttemptContent.attachments = [attachment]
        NSLog("🔔 [NotifySphere Ext] Image attached")
      } catch {
        NSLog("🔔 [NotifySphere Ext] Attach error: \(error.localizedDescription)")
      }

      contentHandler(bestAttemptContent)
    }.resume()
  }

  override func serviceExtensionTimeWillExpire() {
    NSLog("🔔 [NotifySphere Ext] Time expired")
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }
}
