import { subir, semearRecadastro } from './tests/e2e/servidor-falso.js';
const hoje = new Date().toISOString();
const { url, estado } = await subir({
  rhUsuario: { usuario:'rh', nome:'RH Teste', sal:'00112233445566778899aabbccddeeff',
    chave:'6d48c59d59c1e20f709e098aa76c56cac73caa5ec7b35353fddb46d3a80a528e', iteracoes:1, ativo:true }
});
// p-ana tem biometria -> substituicao ; p-novo nao tem -> primeiro cadastro
semearRecadastro(estado, { template_id:'t-1', pessoa_id:'p-ana', versao:2, coerencia:0.312, origem:'link', criado_em:hoje });
semearRecadastro(estado, { template_id:'t-2', pessoa_id:'p-bruno', versao:1, coerencia:0.087, origem:'rh_upload', criado_em:hoje });
console.log('app: ' + url + '/index.html');
console.log('rh:  rh / senha-visual');
