# AUREA+ para iPhone

Aplicativo iOS nativo em SwiftUI conectado ao mesmo backend do sistema web AUREA+.

## Requisitos

- macOS com Xcode 15 ou superior
- iOS 17 ou superior
- XcodeGen para gerar o arquivo .xcodeproj

## Abrir o projeto

1. Instale o XcodeGen: `brew install xcodegen`
2. Entre na pasta `ios`
3. Execute: `xcodegen generate`
4. Abra `AUREAPlus.xcodeproj` no Xcode
5. Em Signing & Capabilities, selecione a equipe Apple Developer
6. Escolha um iPhone ou simulador e execute

## Backend

O app usa:
`https://aurea-loja-online.onrender.com`

A autenticação é realizada com a mesma conta do sistema web.

## Primeira versão

- Login
- Dashboard com vendas do dia, faturamento, saldo do caixa e estoque disponível
- Nova venda apenas com itens disponíveis
- Estoque disponível
- Caixa e edição de percentuais para administradores
- Usuários, criação e exclusão para administradores

## Próximas etapas para App Store

- Ícone oficial 1024x1024 e conjunto de assets
- Tela de abertura e identidade visual final
- Cadastro e movimentação completa de estoque no app
- Fotos dos produtos
- Testes em iPhone físico
- Política de privacidade
- App Store Connect / TestFlight
- Assinatura e envio para revisão
