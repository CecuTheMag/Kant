import XCTest

/// Drives the real app in the iOS Simulator through the screens a person uses.
/// CI (.github/workflows/apple.yml) starts a local relay on 127.0.0.1:3001
/// first and passes its address in KANT_TEST_RELAY (TEST_RUNNER_ prefix).
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

    /// The Face ID permission prompt belongs to SpringBoard, not the app.
    private func answerSystemPrompt(timeout: TimeInterval = 5) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["OK", "Allow"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: timeout) { button.tap(); return }
        }
    }

    /// Later tests reuse the identity the first one created.
    private func launchUnlocked() {
        app.launch()
        let unlock = app.webViews.buttons["Unlock"]
        if unlock.waitForExistence(timeout: 20) {
            let field = app.webViews.secureTextFields.firstMatch
            type(into: field, password)
            unlock.tap()
        }
        _ = element("New message", timeout: 90)
        app.tap()  // lets the interruption monitor clear a pending system prompt
    }

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

    /// Terms → network → name and password → the chat list.
    func test1_OnboardingReachesChats() throws {
        app.launch()
        shot("1-welcome")

        // The Kant logo on the welcome screen must actually load (it was missing on desktop).
        let logo = app.webViews.images.firstMatch
        XCTAssertTrue(logo.waitForExistence(timeout: 30), "no logo image on the welcome screen")
        XCTAssertGreaterThan(logo.frame.width, 20, "logo image has no size, so it didn't load")

        element("Agree and continue").tap()

        // Builds with a default relay skip this step.
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

        // The chat list's empty state, then the toolbar buttons.
        _ = element("Add a contact", timeout: 90)
        _ = element("New message")
        shot("4-chats")

        element("Settings").tap()
        _ = element("Settings", timeout: 10)
        shot("5-settings")
    }

    /// Adds a Kant web client (tests/lab/local/ios-peer.mjs, running on the
    /// same Mac and relay) by its invite link and talks to it both ways.
    func test2_MessagingWithWebPeer() throws {
        guard let link = ProcessInfo.processInfo.environment["KANT_PEER_LINK"], !link.isEmpty else {
            throw XCTSkip("KANT_PEER_LINK not set")
        }
        launchUnlocked()
        element("Add a contact").tap()
        // On a phone the sheet opens on the camera; paste the link instead.
        let pasteTab = app.webViews.buttons["Paste link"]
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
        launchUnlocked()
        element("Settings").tap()
        let toggle = app.webViews.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", "Unlock with Face ID")).firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 20), "no Face ID setting")
        shot("8-security")
        toggle.tap()
        answerSystemPrompt()  // "Do you want to allow Kant to use Face ID?"
        _ = element("Face ID unlock is on", timeout: 60)
        shot("9-face-id-on")

        app.terminate()
        app.launch()
        let faceButton = app.webViews.buttons["Unlock with Face ID"]
        XCTAssertTrue(faceButton.waitForExistence(timeout: 30), "unlock screen doesn't offer Face ID")
        shot("10-unlock-screen")
        faceButton.tap()
        _ = element("New message", timeout: 60)
        shot("11-unlocked-with-face-id")
    }
}
