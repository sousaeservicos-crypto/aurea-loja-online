import SwiftUI

struct UsersView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var users: [User] = []
    @State private var showingNewUser = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            List {
                ForEach(users) { user in
                    HStack {
                        VStack(alignment: .leading) {
                            Text(user.name).fontWeight(.semibold)
                            Text("@\(user.username) • \(user.role)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if user.id.value != session.user?.id.value {
                            Button(role: .destructive) {
                                Task { await delete(user) }
                            } label: {
                                Image(systemName: "trash")
                            }
                            .buttonStyle(.borderless)
                        }
                    }
                }
            }
            .navigationTitle("Usuários")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showingNewUser = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showingNewUser) {
                NewUserView {
                    showingNewUser = false
                    Task { await load() }
                }
            }
            .overlay {
                if let errorMessage, users.isEmpty {
                    ContentUnavailableView("Erro", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    @MainActor
    private func load() async {
        do {
            users = try await APIClient.shared.get("/api/users")
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor
    private func delete(_ user: User) async {
        do {
            try await APIClient.shared.send("/api/users/\(user.id.value)", method: "DELETE")
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct NewUserView: View {
    @Environment(\.dismiss) private var dismiss
    let onSaved: () -> Void

    @State private var name = ""
    @State private var username = ""
    @State private var password = ""
    @State private var role = "vendedor"
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                TextField("Nome", text: $name)
                TextField("Usuário", text: $username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Senha", text: $password)
                Picker("Perfil", selection: $role) {
                    Text("Administrador").tag("administrador")
                    Text("Vendedor").tag("vendedor")
                    Text("Caixa").tag("caixa")
                }
                if let errorMessage { Text(errorMessage).foregroundStyle(.red) }
            }
            .navigationTitle("Novo usuário")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancelar") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Salvar") { Task { await save() } }
                        .disabled(name.isEmpty || username.isEmpty || password.count < 6)
                }
            }
        }
    }

    @MainActor
    private func save() async {
        do {
            try await APIClient.shared.send(
                "/api/users",
                method: "POST",
                body: NewUserRequest(name: name, username: username, password: password, role: role)
            )
            onSaved()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
