import SwiftUI

struct DashboardView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var dashboard: DashboardData?
    @State private var products: [Product] = []
    @State private var errorMessage: String?

    private var available: [StockItem] {
        products.flatMap { product in
            product.variants
                .filter { $0.stock > 0 }
                .map { StockItem(product: product, variant: $0) }
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if let dashboard {
                    ScrollView {
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            MetricCard(title: "Vendas do dia", value: dashboard.todaySales.brl, icon: "cart")
                            MetricCard(title: "Faturamento", value: dashboard.revenue.brl, icon: "chart.line.uptrend.xyaxis")
                            MetricCard(title: "Saldo do caixa", value: dashboard.cashBalance.brl, icon: "banknote")
                            MetricCard(title: "Estoque disponível", value: "\(available.reduce(0) { $0 + $1.variant.stock })", icon: "shippingbox")
                        }

                        VStack(alignment: .leading, spacing: 10) {
                            Text("Estoque disponível").font(.title3.bold())
                            if available.isEmpty {
                                ContentUnavailableView("Estoque vazio", systemImage: "shippingbox")
                            } else {
                                ForEach(available) { item in
                                    HStack {
                                        VStack(alignment: .leading) {
                                            Text(item.product.name).fontWeight(.semibold)
                                            Text("\(item.variant.color) • \(item.variant.size)")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Text("\(item.variant.stock) un.")
                                            .fontWeight(.bold)
                                        Text(item.product.price.value.brl)
                                            .foregroundStyle(.secondary)
                                    }
                                    Divider()
                                }
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding()
                    .refreshable { await load() }
                } else if let errorMessage {
                    ContentUnavailableView("Não foi possível carregar", systemImage: "wifi.exclamationmark", description: Text(errorMessage))
                } else {
                    ProgressView()
                }
            }
            .navigationTitle("AUREA+")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Sair") { Task { await session.logout() } }
                }
            }
            .task { await load() }
        }
    }

    @MainActor
    private func load() async {
        do {
            async let d: DashboardData = APIClient.shared.get("/api/dashboard")
            async let p: [Product] = APIClient.shared.get("/api/products")
            (dashboard, products) = try await (d, p)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let icon: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: icon).foregroundStyle(.orange)
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.bold()).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16))
    }
}
