import XCTest

/// Drives the real app in the iOS Simulator through the screens a person uses.
/// CI (.github/workflows/apple.yml) starts a local relay on 127.0.0.1:3001 and
/// a Kant web client to talk to, and passes their details in KANT_TEST_RELAY
/// and KANT_PEER_LINK (set as TEST_RUNNER_… for xcodebuild).
final class KantUITests: XCTestCase {
    private var app: XCUIApplication!
    private var relay: String { ProcessInfo.processInfo.environment["KANT_TEST_RELAY"] ?? "http://127.0.0.1:3001" }
    private let password = "Kant-iOS-Test-2026"

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        // System prompts (notifications, camera, Face ID permission) get in the
        // way of taps; answer them the way a person would to keep going.
        addUIInterruptionMonitor(withDescription: "system alert") { alert in
            for label in ["Allow", "OK", "Allow While Using App", "Don’t Allow"] where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            return false
        }
    }

    // MARK: - Tests

    /// Welcome (with the logo) → terms → network → name and password → chats → Settings.
    func test1_OnboardingReachesChats() throws {
        app.launch()
        let heading = app.webViews.staticTexts["Welcome to Kant"]
        XCTAssertTrue(heading.waitForExistence(timeout: 30), "welcome screen never appeared")
        shot("1-welcome")
        // The Kant logo must actually load (it was missing in the desktop app).
        XCTAssertTrue(logoVisible(above: heading), "the Kant logo isn't showing on the welcome screen")

        onboard()

        _ = element("Add a contact", timeout: 90)
        _ = element("New message")
        app.tap()
        shot("4-chats")

        element("Settings").tap()
        _ = element("Notifications", timeout: 10)
        shot("5-settings")
    }

    /// Adds a Kant web client (tests/lab/local/ios-peer.mjs, on the same Mac
    /// and relay) by its invite link and talks to it both ways.
    func test2_MessagingWithWebPeer() throws {
        guard let link = ProcessInfo.processInfo.environment["KANT_PEER_LINK"], !link.isEmpty else {
            throw XCTSkip("KANT_PEER_LINK not set")
        }
        launchReady()
        element("Add a contact").tap()
        // On a phone the sheet opens on the camera; paste the link instead.
        // (a segmented control: WebKit reports its buttons as switches)
        let pasteTab = app.webViews.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Paste link")).firstMatch
        if pasteTab.waitForExistence(timeout: 10) { pasteTab.tap() }
        let invite = app.webViews.textViews.firstMatch
        XCTAssertTrue(invite.waitForExistence(timeout: 10), "no field for the invite link")
        type(into: invite, link)
        shot("6-add-contact")
        let add = app.webViews.buttons["Add contact"]
        XCTAssertTrue(add.waitForExistence(timeout: 10), "the link wasn't recognised")
        add.tap()

        // The new chat opens. Send is enabled once Kant is connected to the relay.
        let composer = app.webViews.textViews["Message"]
        XCTAssertTrue(composer.waitForExistence(timeout: 30), "chat didn't open")
        type(into: composer, "hello from iPhone")
        let send = app.webViews.buttons["Send"]
        expectation(for: NSPredicate(format: "isEnabled == true"), evaluatedWith: send)
        waitForExpectations(timeout: 120)
        send.tap()
        XCTAssertTrue(app.webViews.staticTexts["hello from the web"].waitForExistence(timeout: 180),
                      "no reply from the web peer")
        shot("7-conversation")
    }

    /// Turns on Face ID unlock, restarts the app and unlocks with Face ID. CI
    /// enrolls a face in the simulator and answers every Face ID prompt with a match.
    func test3_FaceIDUnlock() throws {
        launchReady()
        element("Settings").tap()
        let toggle = app.webViews.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Unlock with Face ID")).firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 20), "no Face ID setting")
        shot("8-security")
        toggle.tap()
        answerSystemPrompt()  // "Do you want to allow Kant to use Face ID?"
        // The app answers with a toast either way; catch it to see which.
        let outcome = app.webViews.staticTexts.matching(NSPredicate(
            format: "label CONTAINS 'unlock is on' OR label BEGINSWITH 'Couldn' OR label CONTAINS 'isn’t available'")).firstMatch
        XCTAssertTrue(outcome.waitForExistence(timeout: 60), "turning on Face ID gave no answer")
        shot("9-face-id-result")
        // The toast fades; the switch staying on is the lasting answer.
        XCTAssertEqual(toggle.value as? String, "1", "Face ID unlock didn't turn on (see screenshot 9)")

        app.terminate()
        app.launch()
        let faceButton = app.webViews.buttons["Unlock with Face ID"]
        XCTAssertTrue(faceButton.waitForExistence(timeout: 30), "unlock screen doesn't offer Face ID")
        shot("10-unlock-screen")
        faceButton.tap()
        _ = element("New message", timeout: 60)
        shot("11-unlocked-with-face-id")
    }

    // MARK: - Steps

    /// Opens the app at the chat list: signs up on first run, else unlocks.
    /// Each test can run on its own.
    private func launchReady() {
        app.launch()
        let agree = app.webViews.buttons["Agree and continue"]
        let unlock = app.webViews.buttons["Unlock"]
        _ = agree.waitForExistence(timeout: 30) || unlock.waitForExistence(timeout: 5)
        if agree.exists {
            onboard()
        } else if unlock.exists {
            type(into: app.webViews.secureTextFields.firstMatch, password)
            unlock.tap()
        }
        _ = element("New message", timeout: 90)
        app.tap()  // lets the interruption monitor clear a pending system prompt
    }

    /// Terms → network (builds with a default relay skip it) → name and password.
    private func onboard() {
        element("Agree and continue").tap()
        let relayField = app.webViews.textFields.firstMatch
        if relayField.waitForExistence(timeout: 10), app.webViews.staticTexts["Connect to a network"].exists {
            type(into: relayField, relay)
            shot("2-network")
            element("Continue").tap()
        }
        let fields = app.webViews.textFields
        XCTAssertTrue(fields.firstMatch.waitForExistence(timeout: 30), "name field never appeared")
        type(into: fields.firstMatch, "iPhone")
        let secure = app.webViews.secureTextFields
        XCTAssertTrue(secure.element(boundBy: 0).waitForExistence(timeout: 10))
        type(into: secure.element(boundBy: 0), password)
        type(into: secure.element(boundBy: 1), password)
        shot("3-create")
        element("Create").tap()
    }

    // MARK: - Helpers

    private func shot(_ name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func element(_ label: String, timeout: TimeInterval = 30) -> XCUIElement {
        let match = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
        XCTAssertTrue(match.waitForExistence(timeout: timeout), "“\(label)” never appeared")
        return match
    }

    private func type(into field: XCUIElement, _ text: String) {
        field.tap()
        field.typeText(text)
    }

    /// The Face ID permission prompt belongs to SpringBoard, not the app.
    private func answerSystemPrompt(timeout: TimeInterval = 5) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["OK", "Allow"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: timeout) { button.tap(); return }
        }
    }

    /// Whether the area above `anchor` shows the Kant logo's teal. The logo is
    /// decorative (alt=""), so it isn't in the accessibility tree: look at pixels.
    private func logoVisible(above anchor: XCUIElement) -> Bool {
        let image = XCUIScreen.main.screenshot().image
        guard let cg = image.cgImage, let data = cg.dataProvider?.data, let bytes = CFDataGetBytePtr(data) else {
            return false
        }
        let scale = CGFloat(cg.width) / app.frame.width
        let top = Int(max(0, anchor.frame.minY - 110) * scale), bottom = Int(anchor.frame.minY * scale)
        let left = Int(anchor.frame.minX * scale), right = min(cg.width, Int((anchor.frame.minX + 110) * scale))
        let bpp = cg.bitsPerPixel / 8, row = cg.bytesPerRow
        let littleEndian = cg.bitmapInfo.contains(.byteOrder32Little)
        var teal = 0
        for y in stride(from: top, to: bottom, by: 2) {
            for x in stride(from: left, to: right, by: 2) {
                let i = y * row + x * bpp
                let c0 = Int(bytes[i]), c1 = Int(bytes[i + 1]), c2 = Int(bytes[i + 2])
                let (r, b) = littleEndian ? (c2, c0) : (c0, c2)  // BGRA or RGBA
                if b > 150 && c1 > 120 && r < 120 { teal += 1 }
            }
        }
        return teal > 40
    }
}
