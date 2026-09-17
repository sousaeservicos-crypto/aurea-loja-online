# AUREA+ Online

Sistema web com:
- vendas e baixa de estoque por tamanho/cor;
- chinelas 33–39 e roupas PP/P/M/G/GG;
- clientes e fornecedores;
- compras com entrada automática no estoque;
- caixa com Emergências, Despesas Diversas, Mercadoria e Pró-labore;
- usuários com perfis Administrador, Vendedor e Caixa;
- PostgreSQL centralizado.

## Rodar localmente
1. Copie `.env.example` para `.env`.
2. Preencha `DATABASE_URL`, `JWT_SECRET`, `ADMIN_USERNAME` e `ADMIN_PASSWORD`.
3. Rode `npm install`.
4. Rode `npm start`.
5. Abra `http://localhost:3000`.

## Produção
Defina `NODE_ENV=production` e use HTTPS no provedor de hospedagem.
