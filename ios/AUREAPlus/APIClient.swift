import Foundation

enum APIError: LocalizedError {
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "Resposta inválida do servidor."
        case .server(let message): return message
        }
    }
}

private struct ErrorResponse: Decodable {
    let error: String?
}

final class APIClient {
    static let shared = APIClient()
    let baseURL = URL(string: "https://aurea-loja-online.onrender.com")!

    private let session: URLSession
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    private init() {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        config.timeoutIntervalForRequest = 30
        session = URLSession(configuration: config)

        decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase

        encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
    }

    func get<T: Decodable>(_ path: String) async throws -> T {
        let data = try await perform(path: path, method: "GET", body: nil)
        return try decoder.decode(T.self, from: data)
    }

    func send<T: Decodable, B: Encodable>(_ path: String, method: String, body: B) async throws -> T {
        let data = try await perform(path: path, method: method, body: try encoder.encode(body))
        return try decoder.decode(T.self, from: data)
    }

    func send<B: Encodable>(_ path: String, method: String, body: B) async throws {
        _ = try await perform(path: path, method: method, body: try encoder.encode(body))
    }

    func send(_ path: String, method: String) async throws {
        _ = try await perform(path: path, method: method, body: nil)
    }

    private func perform(path: String, method: String, body: Data?) async throws -> Data {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.invalidResponse }

        guard 200..<300 ~= http.statusCode else {
            if let apiError = try? decoder.decode(ErrorResponse.self, from: data),
               let message = apiError.error {
                throw APIError.server(message)
            }
            throw APIError.server("Erro HTTP \(http.statusCode).")
        }
        return data
    }
}
