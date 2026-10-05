import Foundation
import Capacitor
import UserNotifications

/// Local notifications for new messages. Same contract as the Android plugin
/// (see src/lib/localNotify.ts). These are shown by the app itself while it is
/// running; there are no push notifications without an Apple developer account.
@objc(KantNotificationsPlugin)
public class KantNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KantNotificationsPlugin"
    public let jsName = "KantNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "notify", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermission", returnType: CAPPluginReturnPromise),
    ]

    @objc func notify(_ call: CAPPluginCall) {
        guard let title = call.getString("title"), let body = call.getString("body") else {
            return call.reject("title and body are required")
        }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        // Same tag replaces the earlier notification instead of stacking.
        let request = UNNotificationRequest(identifier: call.getString("tag") ?? title, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { _ in call.resolve() }
    }

    @objc func checkPermission(_ call: CAPPluginCall) {
        resolvePermission(call)
    }

    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            self.resolvePermission(call)
        }
    }

    private func resolvePermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let state: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: state = "granted"
            case .denied: state = "denied"
            default: state = "prompt"
            }
            call.resolve(["granted": state == "granted", "state": state])
        }
    }
}
