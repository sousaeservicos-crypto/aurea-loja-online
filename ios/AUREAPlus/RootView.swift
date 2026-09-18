import SwiftUI

struct RootView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        Group {
            if session.isLoading {
                ProgressView("Carregando AUREA+…")
            } else if session.user == nil {
                LoginView()
            } else {
                MainTabView()
            }
        }
        .task {
            if session.isLoading { await session.restore() }
        }
    }
}

struct LoginView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var username = ""
    @State private var password = ""
    @State private var sending = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Spacer()
                VStack(spacing: 6) {
                    Text("AUREA+")
                        .font(.system(size: 42, weight: .bold, design: .rounded))
                    Text("Gestão da loja")
                        .foregroundStyle(.secondary)
                }

                VStack(spacing: 14) {
                    TextField("Usuário", text: $username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .textContentType(.username)
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                    SecureField("Senha", text: $password)
                        .textContentType(.password)
                        .padding()
                        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 14))

                    if let message = session.errorMessage {
                        Text(message)
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button {
                        sending = true
                        Task {
                            await session.login(username: username, password: password)
                            sending = false
                        }
                    } label: {
                        HStack {
                            if sending { ProgressView().tint(.white) }
                            Text("Entrar").fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(sending || username.isEmpty || password.isEmpty)
                }
                .frame(maxWidth: 420)
                Spacer()
            }
            .padding(24)
        }
    }
}

struct MainTabView: View {
    @EnvironmentObject private var session: SessionStore

    var body: some View {
        TabView {
            DashboardView()
                .tabItem { Label("Início", systemImage: "chart.bar.fill") }

            SaleView()
                .tabItem { Label("Venda", systemImage: "cart.fill") }

            InventoryView()
                .tabItem { Label("Estoque", systemImage: "shippingbox.fill") }

            CashView()
                .tabItem { Label("Caixa", systemImage: "banknote.fill") }

            if session.user?.isAdmin == true {
                UsersView()
                    .tabItem { Label("Usuários", systemImage: "person.2.fill") }
            }
        }
    }
}
