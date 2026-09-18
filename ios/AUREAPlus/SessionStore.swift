import SwiftUI

@MainActor
final class SessionStore: ObservableObject {
    @Published var user: User?
    @Published var isLoading = true
    @Published var errorMessage: String?

    func restore() async {
        defer { isLoading = false }
        do {
            let me: User = try await APIClient.shared.get("/api/me")
            user = me
        } catch {
            user = nil
        }
    }

    func login(username: String, password: String) async {
        errorMessage = nil
        struct LoginBody: Encodable { let username: String; let password: String }
        do {
            let logged: User = try await APIClient.shared.send(
                "/api/login",
                method: "POST",
                body: LoginBody(username: username, password: password)
            )
            user = logged
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func logout() async {
        try? await APIClient.shared.send("/api/logout", method: "POST")
        user = nil
    }
}
