import XCTest

/// Drives the real app in the iOS Simulator through the screens a person uses.
/// CI (.github/workflows/apple.yml) starts a local relay on 127.0.0.1:3001
/// first and passes its address in KANT_TEST_RELAY (TEST_RUNNER_ prefix).
final class KantUITests: XCTestCase {
    private var app: XCUIApplication!
    private var relay: String { ProcessInfo.processInfo.environment["KANT_TEST_RELAY"] ?? "http://127.0.0.1:3001" }

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
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
    func testOnboardingReachesChats() throws {
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
        type(into: secure.element(boundBy: 0), "Kant-iOS-Test-2026")
        type(into: secure.element(boundBy: 1), "Kant-iOS-Test-2026")
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
}
