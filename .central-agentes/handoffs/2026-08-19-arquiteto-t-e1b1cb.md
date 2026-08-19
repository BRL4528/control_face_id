# Checkpoint T-E1B1CB

## Concluido no branch

- `47c8a54`: servidor falso implementa registro e estado de dispositivo v3.
- `069050e`: carga escopada, identificacao 1:N, sessao/equipe/ajuste do gestor.
- `4bd88b8`: rate limits, CORS e migracao de token legado.
- `49c13de`: compatibilidade do erro textual v2.
- Smoke direto de todas as rotas v3: OK.
- Unitarios: 47/47.
- E2E apos a correcao de compatibilidade: 23/23 em 1,7 min.

## Bloqueio externo

O runtime nao possui credencial/API/conector n8n. A habilidade Browser foi inicializada
para `https://n8n.samasc.com.br/`, mas retornou `No browser is available`. Portanto
nenhum workflow ativo foi tocado, nenhuma copia foi criada e nenhuma Data Table real
foi alterada.

## Falta

- Obter sessao autenticada do navegador ou credencial/API n8n.
- Duplicar/versionar workflows sem alterar os seis ativos.
- Criar tabelas/colunas aditivas do ADR e workflows v3 nas copias.
- Validar copias e informar ao Orquestrador exatamente quais IDs trocar.
