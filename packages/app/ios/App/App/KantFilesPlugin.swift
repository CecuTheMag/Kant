import UIKit
import Capacitor

/// Hands a decrypted attachment to the share sheet ("Save to Files", "Save
/// Image", AirDrop, other apps) and opens external links. Same contract as the
/// Android plugin (see src/lib/fileActions.ts).
@objc(KantFilesPlugin)
public class KantFilesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "KantFilesPlugin"
    public let jsName = "KantFiles"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearTemp", returnType: CAPPluginReturnPromise),
    ]

    /// Must match TEMP_DIR in src/lib/fileActions.ts.
    private static let tempDir = "kant-open"
    /// Copies older than this are swept whenever the app comes back.
    private static let resumeSweepAge: TimeInterval = 10 * 60

    private var cachesRoot: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }
    private var tempRoot: URL {
        cachesRoot.appendingPathComponent(Self.tempDir, isDirectory: true)
    }

    override public func load() {
        // A crash can skip every other cleanup; a cold start never needs old copies.
        DispatchQueue.global(qos: .utility).async { self.sweep(olderThan: 0) }
        NotificationCenter.default.addObserver(
            self, selector: #selector(onResume), name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    @objc private func onResume() {
        DispatchQueue.global(qos: .utility).async { self.sweep(olderThan: Self.resumeSweepAge) }
    }

    @objc func openFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), !path.isEmpty else {
            return call.reject("path is required", "INVALID_PATH")
        }
        let file = cachesRoot.appendingPathComponent(path).standardizedFileURL.resolvingSymlinksInPath()
        let root = tempRoot.standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.path + "/"), FileManager.default.fileExists(atPath: file.path) else {
            return call.reject("File is not in the shareable cache", "INVALID_PATH")
        }
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                return call.reject("Nothing to present the share sheet from", "NO_APP")
            }
            let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            if let popover = sheet.popoverPresentationController {
                // iPad: anchor the sheet to the middle of the screen.
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
                popover.permittedArrowDirections = []
            }
            presenter.present(sheet, animated: true) { call.resolve() }
        }
    }

    @objc func openUrl(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), ["http", "https", "mailto"].contains(scheme) else {
            return call.reject("Only web and mail links can be opened", "UNSAFE_URL")
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url) { ok in
                ok ? call.resolve() : call.reject("No app can open this link", "NO_APP")
            }
        }
    }

    @objc func clearTemp(_ call: CAPPluginCall) {
        let olderThan = max(0, (call.getDouble("olderThanMs") ?? 0) / 1000)
        DispatchQueue.global(qos: .utility).async {
            self.sweep(olderThan: olderThan)
            call.resolve()
        }
    }

    /// Delete entries under Caches/kant-open modified more than `olderThan` seconds ago (0 = all).
    private func sweep(olderThan: TimeInterval) {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: tempRoot, includingPropertiesForKeys: [.contentModificationDateKey], options: []) else { return }
        let cutoff = Date().addingTimeInterval(-olderThan)
        for entry in entries {
            let modified = (try? entry.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
            if olderThan == 0 || (modified ?? .distantPast) < cutoff {
                try? fm.removeItem(at: entry)
            }
        }
    }
}
