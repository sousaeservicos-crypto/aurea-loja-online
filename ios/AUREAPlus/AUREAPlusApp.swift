import SwiftUI

@main
struct AUREAPlusApp: App {
    @StateObject private var session = SessionStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(session)
                .tint(.orange)
        }
    }
}
