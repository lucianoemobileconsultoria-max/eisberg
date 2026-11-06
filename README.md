# EISBERG – App de Pedidos + Painel Administrativo

App de pedidos (formulário idêntico ao modelo) com painel administrativo completo (CRUD de Pedidos, Produtos e Categorias).
Conectado diretamente ao **Supabase (PostgreSQL)** com Row Level Security (RLS) e funções seguras.

---

## 🚀 Como Inicializar o Banco no Supabase (Passo a Passo)

### 1. Criar as tabelas e o cardápio
1. Acesse o seu projeto no Supabase: [https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj](https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj)
2. No menu lateral esquerdo, clique em **SQL Editor**.
3. Clique em **New query**.
4. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql), copie todo o seu conteúdo e cole no editor.
5. Clique em **Run** (botão verde no canto inferior direito).
   - O script cria todas as tabelas, índices, regras de segurança RLS, funções seguras e já insere o cardápio completo da imagem de referência.

### 2. Criar seu Usuário Administrador
1. No menu lateral do Supabase, clique em **Authentication** > **Users**.
2. Clique no botão **Add user** > **Create user**.
3. Preencha seu e-mail e uma senha forte. Marque a opção **Auto Confirm User** e clique em **Create user**.
4. Volte ao **SQL Editor** e execute o comando abaixo (substitua pelo seu e-mail):
   ```sql
   insert into public.admins (email) values ('seu-email@dominio.com');
   ```
Pronto! Com esse e-mail e senha você fará login no painel administrativo (`admin.html`).

---

## 💻 Como Rodar Localmente

Dê um duplo clique no arquivo **`iniciar.bat`** ou pelo terminal:

```bash
npm start
```

- **App do Cliente:** [http://localhost:3000](http://localhost:3000)
- **Painel Administrativo:** [http://localhost:3000/admin.html](http://localhost:3000/admin.html)

---

## 🔒 Segurança e Regras de Negócio

- **Senha de Exclusão:** Para excluir qualquer pedido, produto ou categoria, o sistema exige a senha **`789512`** em um modal de confirmação. A validação é feita diretamente no banco de dados.
  - Para alterar a senha, execute no SQL Editor:
    ```sql
    update public.app_config set valor = 'NOVA_SENHA' where chave = 'senha_exclusao';
    ```
- **Produtos sem preço:** Produtos com preço zerado aparecem no app com o nome riscado, etiqueta "sem preço" e botões bloqueados. O banco recusa pedidos contendo produtos sem preço.
- **Cálculo de Total:** Exibição do total em tempo real no app do cliente e no formulário de pedidos do admin.
- **WhatsApp & Dados da Empresa:** No painel admin há a aba **⚙️ Dados da Empresa** onde você altera o nome da marca, o telefone visível e o número de destino do WhatsApp em tempo real.
- **WhatsApp:** Ao enviar o pedido, abre opção de enviar resumo formatado direto para o WhatsApp cadastrado.

---

## 🌐 Publicação / Hospedagem

Como o frontend se conecta diretamente à API do Supabase, você pode hospedar os arquivos da pasta `public/` em qualquer serviço estático gratuito:
- **GitHub Pages** (direto pelo repositório)
- **Vercel** ou **Netlify** (basta conectar o repositório GitHub)
- Ou continuar rodando localmente com o `iniciar.bat`

---

## 📦 Repositório Git

- **Repositório:** [https://github.com/lucianoemobileconsultoria-max/eisberg.git](https://github.com/lucianoemobileconsultoria-max/eisberg.git)
- **Branch principal:** `main`
