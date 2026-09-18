import SwiftUI

struct CashView: View {
    @EnvironmentObject private var session: SessionStore
    @State private var cash: CashResponse?
    @State private var emergencies = 10.0
    @State private var miscellaneous = 10.0
    @State private var merchandise = 60.0
    @State private var proLabore = 20.0
    @State private var message: String?

    private var totalPct: Double { emergencies + miscellaneous + merchandise + proLabore }

    var body: some View {
        NavigationStack {
            Form {
                if let cash {
                    Section("Resumo") {
                        LabeledContent("Entradas", value: cash.entries.brl)
                        LabeledContent("Saídas", value: cash.exits.brl)
                        LabeledContent("Saldo", value: cash.balance.brl)
                    }

                    Section("Necessidades") {
                        ForEach(["emergencias","despesas","mercadoria","prolabore"], id: \.self) { key in
                            if let box = cash.boxes[key] {
                                LabeledContent(label(key), value: box.available.brl)
                            }
                        }
                    }

                    if session.user?.isAdmin == true {
                        Section("Distribuição do caixa") {
                            PercentageField(title: "Emergências", value: $emergencies)
                            PercentageField(title: "Despesas", value: $miscellaneous)
                            PercentageField(title: "Mercadoria", value: $merchandise)
                            PercentageField(title: "Pró-labore", value: $proLabore)
                            LabeledContent("Total", value: "\(totalPct.formatted(.number.precision(.fractionLength(0...2))))%")
                            Button("Salvar porcentagens") {
                                Task { await saveSettings() }
                            }
                            .disabled(abs(totalPct - 100) > 0.001)
                        }
                    }

                    Section("Movimentações recentes") {
                        if cash.transactions.isEmpty {
                            Text("Nenhuma movimentação registrada.").foregroundStyle(.secondary)
                        } else {
                            ForEach(cash.transactions.prefix(30)) { tx in
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(tx.description)
                                        Text(label(tx.category))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Text(tx.amount.value.brl)
                                }
                            }
                        }
                    }
                } else {
                    ProgressView()
                }

                if let message {
                    Section { Text(message) }
                }
            }
            .navigationTitle("Caixa")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func label(_ key: String) -> String {
        [
            "emergencias":"Emergências",
            "despesas":"Despesas",
            "mercadoria":"Mercadoria",
            "prolabore":"Pró-labore"
        ][key] ?? key
    }

    @MainActor
    private func load() async {
        do {
            let result: CashResponse = try await APIClient.shared.get("/api/cash")
            cash = result
            emergencies = result.settings.emergenciesPct.value
            miscellaneous = result.settings.miscellaneousPct.value
            merchandise = result.settings.merchandisePct.value
            proLabore = result.settings.proLaborePct.value
            message = nil
        } catch {
            message = error.localizedDescription
        }
    }

    @MainActor
    private func saveSettings() async {
        guard abs(totalPct - 100) <= 0.001 else {
            message = "As porcentagens precisam somar 100%."
            return
        }
        do {
            try await APIClient.shared.send(
                "/api/cash/settings",
                method: "PUT",
                body: CashSettingsRequest(
                    emergencies: emergencies,
                    miscellaneous: miscellaneous,
                    merchandise: merchandise,
                    proLabore: proLabore
                )
            )
            message = "Porcentagens salvas."
            await load()
        } catch {
            message = error.localizedDescription
        }
    }
}

private struct PercentageField: View {
    let title: String
    @Binding var value: Double

    var body: some View {
        HStack {
            Text(title)
            Spacer()
            TextField("0", value: $value, format: .number)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 80)
            Text("%").foregroundStyle(.secondary)
        }
    }
}
