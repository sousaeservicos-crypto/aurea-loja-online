import SwiftUI

struct InventoryView: View {
    @State private var products: [Product] = []
    @State private var errorMessage: String?

    private var available: [StockItem] {
        products.flatMap { product in
            product.variants
                .filter { $0.stock > 0 }
                .map { StockItem(product: product, variant: $0) }
        }
        .sorted { $0.product.name.localizedCaseInsensitiveCompare($1.product.name) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                if available.isEmpty {
                    ContentUnavailableView("Nenhum item disponível", systemImage: "shippingbox")
                } else {
                    ForEach(available) { item in
                        HStack {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.product.name).fontWeight(.semibold)
                                Text("\(item.variant.color) • \(item.variant.size)")
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing) {
                                Text("\(item.variant.stock) un.").fontWeight(.bold)
                                Text(item.product.price.value.brl)
                                    .font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Estoque")
            .overlay {
                if let errorMessage {
                    ContentUnavailableView("Erro ao carregar", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    @MainActor
    private func load() async {
        do {
            products = try await APIClient.shared.get("/api/products")
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
