import Foundation
import Capacitor
import LocalAuthentication
import Security
import os

/// Face ID / Touch ID unlock. Same contract as the Android plugin (see
/// src/lib/biometric.ts): the 32-byte key that unlocks the identity is kept in
/// the Keychain behind the current biometric enrollment, and never in the clear.
@objc(KantBiometricPlugin)
public class KantBiometricPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KantBiometricPlugin"
    public let jsName = "KantBiometric"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "unlock", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
    ]

    /// Only on a device with a passcode (every iPhone with Face ID or Touch ID
    /// turned on has one). The Simulator can have a face enrolled but can't set
    /// a passcode, so it uses the next strictest class; reading still needs Face ID.
    #if targetEnvironment(simulator)
    private static let accessibility = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    #else
    private static let accessibility = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    #endif

    private let log = Logger(subsystem: "com.kant.messenger", category: "KantBiometric")
    private let service = "com.kant.messenger.biometric"
    private let account = "identity-key"
    /// The enrollment the key was stored under. Keychain already refuses the key
    /// once a face or finger is added or removed (.biometryCurrentSet); comparing
    /// this lets us say so (INVALIDATED) instead of a generic failure.
    private let domainStateKey = "kant.biometric.domainState"

    @objc func status(_ call: CAPPluginCall) {
        let context = LAContext()
        var error: NSError?
        let available = context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
        var reason = ""
        if !available {
            switch LAError.Code(rawValue: error?.code ?? 0) {
            case .biometryNotEnrolled?, .passcodeNotSet?: reason = "not-enrolled"
            default: reason = context.biometryType == .none ? "no-hardware" : "unavailable"
            }
        }
        var result: [String: Any] = [
            "available": available,
            "reason": reason,
            "enrolled": keyExists(),
            "kind": kind(of: context.biometryType),
        ]
        if let boot = bootTimeMs() { result["bootTime"] = boot }
        call.resolve(result)
    }

    @objc func enable(_ call: CAPPluginCall) {
        guard let secretB64 = call.getString("secret"), let secret = Data(base64Encoded: secretB64), secret.count == 32 else {
            call.reject("secret must be 32 bytes, base64", "FAILED")
            return
        }
        let context = LAContext()
        context.localizedCancelTitle = call.getString("cancel") ?? "Cancel"
        context.localizedFallbackTitle = ""
        let reason = nonEmpty(call.getString("title")) ?? "Turn on unlock with your face or finger"
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, error in
            guard ok else {
                self.log.error("enable: Face ID not confirmed: \(String(describing: error), privacy: .public)")
                return call.reject("Not confirmed", Self.code(for: error))
            }
            var acError: Unmanaged<CFError>?
            guard let access = SecAccessControlCreateWithFlags(
                nil, Self.accessibility, .biometryCurrentSet, &acError) else {
                return call.reject("Could not protect the key", "FAILED")
            }
            self.deleteKey()
            let item: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: self.service,
                kSecAttrAccount as String: self.account,
                kSecValueData as String: secret,
                kSecAttrAccessControl as String: access,
                kSecUseAuthenticationContext as String: context,
            ]
            let status = SecItemAdd(item as CFDictionary, nil)
            guard status == errSecSuccess else {
                self.log.error("enable: storing the key failed, OSStatus \(status, privacy: .public)")
                // No device passcode means no "WhenPasscodeSet" item can exist.
                return call.reject("Could not store the key (\(status))", status == errSecParam ? "NOT_ENROLLED" : "FAILED")
            }
            UserDefaults.standard.set(context.evaluatedPolicyDomainState, forKey: self.domainStateKey)
            call.resolve()
        }
    }

    @objc func unlock(_ call: CAPPluginCall) {
        let context = LAContext()
        context.localizedCancelTitle = call.getString("cancel") ?? "Use password"
        context.localizedFallbackTitle = ""
        let reason = nonEmpty(call.getString("title")) ?? "Unlock Kant"
        context.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, error in
            guard ok else {
                self.log.error("unlock: Face ID not confirmed: \(String(describing: error), privacy: .public)")
                return call.reject("Not unlocked", Self.code(for: error))
            }
            let stored = UserDefaults.standard.data(forKey: self.domainStateKey)
            if let stored = stored, stored != context.evaluatedPolicyDomainState {
                self.deleteKey()
                return call.reject("Face ID or Touch ID changed since this was turned on", "INVALIDATED")
            }
            let query: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: self.service,
                kSecAttrAccount as String: self.account,
                kSecReturnData as String: true,
                kSecMatchLimit as String: kSecMatchLimitOne,
                // Already authenticated above: the Keychain reuses it, no second prompt.
                kSecUseAuthenticationContext as String: context,
            ]
            var out: CFTypeRef?
            let status = SecItemCopyMatching(query as CFDictionary, &out)
            switch status {
            case errSecSuccess:
                guard let data = out as? Data else { return call.reject("Unreadable key", "FAILED") }
                call.resolve(["secret": data.base64EncodedString()])
            case errSecUserCanceled:
                call.reject("Cancelled", "CANCELLED")
            case errSecItemNotFound, errSecAuthFailed:
                // The enrollment the key was bound to is gone: the Keychain won't release it.
                self.deleteKey()
                call.reject("The stored key is no longer usable", "INVALIDATED")
            default:
                self.log.error("unlock: reading the key failed, OSStatus \(status, privacy: .public)")
                call.reject("Keychain error \(status)", "FAILED")
            }
        }
    }

    @objc func disable(_ call: CAPPluginCall) {
        deleteKey()
        call.resolve()
    }

    // MARK: - Helpers

    private func keyExists() -> Bool {
        let context = LAContext()
        context.interactionNotAllowed = true
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecUseAuthenticationContext as String: context,
        ]
        let status = SecItemCopyMatching(query as CFDictionary, nil)
        // Present but protected answers "interaction not allowed" rather than success.
        return status == errSecSuccess || status == errSecInteractionNotAllowed
    }

    private func deleteKey() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: domainStateKey)
    }

    private func kind(of type: LABiometryType) -> String {
        switch type {
        case .faceID: return "face-id"
        case .touchID: return "touch-id"
        default:
            if #available(iOS 17.0, *), type == .opticID { return "optic-id" }
            return ""
        }
    }

    private func bootTimeMs() -> Double? {
        var mib: [Int32] = [CTL_KERN, KERN_BOOTTIME]
        var tv = timeval()
        var size = MemoryLayout<timeval>.stride
        guard sysctl(&mib, 2, &tv, &size, nil, 0) == 0 else { return nil }
        return Double(tv.tv_sec) * 1000 + Double(tv.tv_usec) / 1000
    }

    private func nonEmpty(_ s: String?) -> String? {
        guard let s = s, !s.isEmpty else { return nil }
        return s
    }

    private static func code(for error: Error?) -> String {
        guard let error = error as? LAError else { return "FAILED" }
        switch error.code {
        case .userCancel, .appCancel, .systemCancel, .userFallback: return "CANCELLED"
        case .authenticationFailed: return "TOO_MANY_ATTEMPTS"
        case .biometryLockout: return "LOCKOUT"
        case .biometryNotEnrolled, .passcodeNotSet: return "NOT_ENROLLED"
        case .biometryNotAvailable: return "UNAVAILABLE"
        default: return "FAILED"
        }
    }
}
