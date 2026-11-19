# Regras do Projeto EISBERG

## 🔗 Links Oficiais do Projeto

- **Supabase Dashboard (SQL Editor Oficial do Projeto):**
  https://supabase.com/dashboard/project/wibqizlxrwiovgkynprj/sql/66105b49-93b9-49c8-b59e-af92eb40377a
- **Supabase Project URL:**
  https://wibqizlxrwiovgkynprj.supabase.co
- **Painel Administrativo Online (Vercel):**
  https://eisbergv1.vercel.app/admin.html
- **App de Pedidos Online (Vercel):**
  https://eisbergv1.vercel.app/
- **Repositório GitHub:**
  https://github.com/lucianoemobileconsultoria-max/eisberg.git

---

## 🔒 Regras de Negócio e Segurança

1. **Integridade de Dados:**
   - Nunca perder ou redefinir dados existentes de produtos, clientes, pedidos ou categorias.
   - Manter backups e compatibilidade com o formato de exportação de dados (`📦 Exportar Dados`).

2. **Permissão de 1/2 Unidade:**
   - Cada produto possui a opção de permitir ou não quantidade fracionada de 1/2 unidade.
   - Produtos de "Gelo" nunca devem permitir 1/2 unidade (apenas inteiros).

3. **Exclusões Protegidas:**
   - Toda exclusão de pedido, produto ou categoria exige a senha mestre (`789512`).

4. **Controle de Versão e Deploy:**
   - Sempre utilizar `& "C:\Users\Admin\MinGit\cmd\git.exe"` para comandos git.
   - Incrementar a versão de cache dos assets (`?v=XX` e `CACHE_NAME` no Service Worker) a cada deploy.
