import SwiftUI

private struct CartLine: Identifiable {
    let id: Int
    let item: StockItem
    var quantity: Int
}

struct SaleView: View {
    @State private var products: [Product] = []
    @State private var selectedVariantID: Int?
    @State private var quantity = 1
    @State private var cart: [CartLine] = []
    @State private var paymentMethod = "PIX"
    @State private var discount = 0.0
    @State private var message: String?
    @State private var saving = false

    private var available: [StockItem] {
        products.flatMap { p in
            p.variants.filter { $0.stock > 0 }.map { StockItem(product: p, variant: $0) }
        }
    }

    private var selectedItem: StockItem? {
        available.first { $0.variant.id.value == selectedVariantID }
    }

    private var total: Double {
        max(0, cart.reduce(0) { $0 + $1.item.product.price.value * Double($1.quantity) } - discount)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Adicionar item") {
                    Picker("Produto", selection: $selectedVariantID) {
                        Text("Selecione").tag(Int?.none)
                        ForEach(available) { item in
                            Text("\(item.product.name) • \(item.variant.color) • \(item.variant.size) (\(item.variant.stock))")
                                .tag(Int?.some(item.variant.id.value))
                        }
                    }
                    Stepper("Quantidade: \(quantity)", value: $quantity, in: 1...max(1, selectedItem?.variant.stock ?? 1))
                    Button("Adicionar à venda") { addToCart() }
                        .disabled(selectedItem == nil)
                }

                Section("Carrinho") {
                    if cart.isEmpty {
                        Text("Nenhum item adicionado").foregroundStyle(.secondary)
                    } else {
                        ForEach(cart) { line in
                            HStack {
                                VStack(alignment: .leading) {
                                    Text(line.item.product.name)
                                    Text("\(line.item.variant.size) • \(line.quantity) un.")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Text((line.item.product.price.value * Double(line.quantity)).brl)
                            }
                        }
                        .onDelete { offsets in cart.remove(atOffsets: offsets) }
                    }
                }

                Section("Pagamento") {
                    Picker("Forma", selection: $paymentMethod) {
                        ForEach(["PIX","Dinheiro","Cartão"], id: \.self) { Text($0) }
                    }
                    TextField("Desconto", value: $discount, format: .number)
                        .keyboardType(.decimalPad)
                    HStack {
                        Text("Total").fontWeight(.semibold)
                        Spacer()
                        Text(total.brl).font(.title3.bold())
                    }
                }

                if let message {
                    Section { Text(message).foregroundStyle(message.contains("sucesso") ? .green : .red) }
                }

                Section {
                    Button {
                        Task { await finishSale() }
                    } label: {
                        HStack {
                            if saving { ProgressView() }
                            Text("Finalizar venda")
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .disabled(cart.isEmpty || saving)
                }
            }
            .navigationTitle("Nova venda")
            .task { await loadProducts() }
            .refreshable { await loadProducts() }
        }
    }

    private func addToCart() {
        guard let item = selectedItem, quantity > 0 else { return }
        let already = cart.first(where: { $0.id == item.id })?.quantity ?? 0
        guard already + quantity <= item.variant.stock else {
            message = "Quantidade maior que o estoque disponível."
            return
        }
        if let index = cart.firstIndex(where: { $0.id == item.id }) {
            cart[index].quantity += quantity
        } else {
            cart.append(CartLine(id: item.id, item: item, quantity: quantity))
        }
        quantity = 1
        message = nil
    }

    @MainActor
    private func loadProducts() async {
        do {
            products = try await APIClient.shared.get("/api/products")
            if let id = selectedVariantID, !available.contains(where: { $0.id == id }) {
                selectedVariantID = nil
            }
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func finishSale() async {
        saving = true
        defer { saving = false }
        do {
            let request = SaleRequest(
                paymentMethod: paymentMethod,
                discount: discount,
                items: cart.map { SaleItemRequest(variantId: $0.id, quantity: $0.quantity) }
            )
            try await APIClient.shared.send("/api/sales", method: "POST", body: request)
            cart.removeAll()
            discount = 0
            message = "Venda realizada com sucesso."
            await loadProducts()
        } catch {
            message = error.localizedDescription
        }
    }
}
