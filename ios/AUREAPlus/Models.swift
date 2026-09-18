import Foundation

struct FlexibleInt: Codable, Hashable, Identifiable {
    let value: Int
    var id: Int { value }

    init(_ value: Int) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Int.self) { value = v; return }
        if let v = try? c.decode(Int64.self) { value = Int(v); return }
        if let v = try? c.decode(Double.self) { value = Int(v); return }
        if let v = try? c.decode(String.self), let n = Int(v) { value = n; return }
        throw DecodingError.typeMismatch(Int.self, .init(codingPath: decoder.codingPath, debugDescription: "Valor inteiro inválido"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

struct FlexibleDouble: Codable, Hashable {
    let value: Double

    init(_ value: Double) { self.value = value }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let v = try? c.decode(Double.self) { value = v; return }
        if let v = try? c.decode(Int.self) { value = Double(v); return }
        if let v = try? c.decode(String.self), let n = Double(v) { value = n; return }
        throw DecodingError.typeMismatch(Double.self, .init(codingPath: decoder.codingPath, debugDescription: "Valor decimal inválido"))
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        try c.encode(value)
    }
}

struct User: Codable, Identifiable, Hashable {
    let id: FlexibleInt
    let name: String
    let username: String
    let role: String
    let active: Bool?

    var isAdmin: Bool { role == "administrador" }
}

struct DashboardData: Codable {
    let todaySales: Double
    let revenue: Double
    let products: Int
    let pieces: Int
    let customers: Int
    let grossProfit: Double
    let cashBalance: Double
}

struct Product: Codable, Identifiable, Hashable {
    let id: FlexibleInt
    let name: String
    let type: String
    let category: String?
    let cost: FlexibleDouble
    let price: FlexibleDouble
    let minStock: Int
    let active: Bool
    let variants: [Variant]
}

struct Variant: Codable, Identifiable, Hashable {
    let id: FlexibleInt
    let size: String
    let color: String
    let stock: Int
}

struct StockItem: Identifiable, Hashable {
    let product: Product
    let variant: Variant
    var id: Int { variant.id.value }
}

struct CashResponse: Codable {
    let settings: CashSettings
    let transactions: [CashTransaction]
    let entries: Double
    let exits: Double
    let balance: Double
    let boxes: [String: CashBox]
}

struct CashSettings: Codable {
    let emergenciesPct: FlexibleDouble
    let miscellaneousPct: FlexibleDouble
    let merchandisePct: FlexibleDouble
    let proLaborePct: FlexibleDouble
}

struct CashBox: Codable {
    let reserved: Double
    let manualIn: Double
    let out: Double
    let available: Double
}

struct CashTransaction: Codable, Identifiable {
    let id: FlexibleInt
    let type: String
    let category: String
    let description: String
    let amount: FlexibleDouble
    let createdAt: String
}

struct SaleRequest: Encodable {
    let customerId: Int? = nil
    let paymentMethod: String
    let discount: Double
    let items: [SaleItemRequest]
}

struct SaleItemRequest: Encodable {
    let variantId: Int
    let quantity: Int
}

struct CashSettingsRequest: Encodable {
    let emergencies: Double
    let miscellaneous: Double
    let merchandise: Double
    let proLabore: Double
}

struct NewUserRequest: Encodable {
    let name: String
    let username: String
    let password: String
    let role: String
}

extension Double {
    var brl: String {
        formatted(.currency(code: "BRL").locale(Locale(identifier: "pt_BR")))
    }
}
