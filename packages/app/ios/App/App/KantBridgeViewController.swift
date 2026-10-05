import UIKit
import Capacitor

/// Kant's native plugins live in the app target rather than in npm packages,
/// so Capacitor can't discover them; register them here. Main.storyboard uses
/// this class as its root view controller.
class KantBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(KantBiometricPlugin())
        bridge?.registerPluginInstance(KantFilesPlugin())
        bridge?.registerPluginInstance(KantNotificationsPlugin())
    }
}
