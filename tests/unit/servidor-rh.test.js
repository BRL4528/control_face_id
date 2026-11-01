// Regras de servidor das rotas do RH: validação de data, referências da mesma
// empresa, testemunhas distintas, jornada, perfil de usuário novo e o recorte
// de /rh/dados por perfil. Funções puras ou com `sql` simulado (sem banco).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diaValido, horaValida, idsDaEmpresa, foraDaEmpresa, daEmpresa, pessoasDistintas, listaDeIds } from '../../api/_lib/validar.js';
import { visaoDados, ocorrenciasVisiveis } from '../../api/_lib/acesso.js';
import { sanearDias, toleranciaDe } from '../../api/rh/jornada.js';
import { perfilPedido, PERFIL_PADRAO_NOVO } from '../../api/rh/usuario.js';
import { caVencidoNaEntrega } from '../../api/rh/almox.js';

test('diaValido: formato e dia que existe no calendário', () => {
  for (const d of ['2026-01-31', '2028-02-29', '2026-12-31']) assert.equal(diaValido(d), true, d);
  for (const d of ['2026-02-30', '2026-13-01', '2026-13-45', '2027-02-29', '2026-00-10', '2026-1-1', '', null, undefined, 20260101, '2026-01-01T00:00'])
    assert.equal(diaValido(d), false, String(d));
});

test('horaValida: 00:00 a 23:59', () => {
  assert.equal(horaValida('00:00'), true); assert.equal(horaValida('23:59'), true);
  assert.equal(horaValida('24:00'), false); assert.equal(horaValida('99:99'), false); assert.equal(horaValida('7:00'), false);
});

test('pessoasDistintas: mesmo documento ou mesmo nome (sem acento, caixa ou espaços) é a mesma pessoa', () => {
  const t = (nome, documento = '') => ({ nome, documento });
  assert.equal(pessoasDistintas([t('João Silva'), t('joao  silva')]).length, 1);
  assert.equal(pessoasDistintas([t('João', '123.456.789-00'), t('Outro nome', '12345678900')]).length, 1);
  assert.equal(pessoasDistintas([t('Ana', '111'), t('Bia', '222')]).length, 2);
  assert.equal(pessoasDistintas([t('Ana'), t('Bia')]).length, 2);
  assert.equal(pessoasDistintas([t('ANA', '1'), t('ana', '2')]).length, 1);   // nome igual, documentos diferentes: suspeito, conta 1
  assert.deepEqual(pessoasDistintas(null), []);
});

// sql simulado: só a forma sql.query(texto, params) que idsDaEmpresa usa.
function sqlFalso(linhas) {
  const chamadas = [];
  const sql = () => { throw new Error('não esperado'); };
  sql.query = (texto, params) => {
    chamadas.push({ texto, params });
    const [emp, ids] = params;
    const soAtivos = /ativ[oa] = true/.test(texto);
    const tabela = /FROM (\w+)/.exec(texto)[1];
    return Promise.resolve(linhas.filter(l => l.tabela === tabela && l.empresa_id === emp && ids.includes(l.id) && (!soAtivos || l.ativo)).map(l => ({ id: l.id })));
  };
  sql.chamadas = chamadas;
  return sql;
}

test('idsDaEmpresa / foraDaEmpresa: só ids da empresa (e ativos, quando pedido), uma consulta só', async () => {
  const sql = sqlFalso([
    { tabela: 'equipe', id: 'e1', empresa_id: 'A', ativo: true },
    { tabela: 'equipe', id: 'e2', empresa_id: 'A', ativo: false },
    { tabela: 'equipe', id: 'eB', empresa_id: 'B', ativo: true },
    { tabela: 'jornada', id: 'j1', empresa_id: 'A', ativo: true }
  ]);
  assert.deepEqual([...await idsDaEmpresa(sql, 'equipe', ['e1', 'e2', 'eB', 'x'], 'A')].sort(), ['e1', 'e2']);
  assert.deepEqual([...await idsDaEmpresa(sql, 'equipe', ['e1', 'e2'], 'A', { ativos: true })], ['e1']);
  assert.deepEqual(await foraDaEmpresa(sql, 'equipe', ['e1', 'eB', 'e1', '', null], 'A'), ['eB']);
  assert.equal(await daEmpresa(sql, 'equipe', 'eB', 'A'), false);
  assert.equal(await daEmpresa(sql, 'equipe', 'e1', 'A'), true);
  assert.equal(await daEmpresa(sql, 'equipe', '', 'A'), false);
  assert.match(sql.chamadas.find(c => /ativo = true/.test(c.texto)).texto, /FROM equipe WHERE empresa_id = \$1/);
  const antes = sql.chamadas.length;
  assert.deepEqual(await foraDaEmpresa(sql, 'colaborador', [], 'A'), []);
  assert.equal(sql.chamadas.length, antes);   // lista vazia não consulta
  await assert.rejects(idsDaEmpresa(sql, 'usuario_rh; DROP', ['x'], 'A'), /não permitida/);
  assert.deepEqual(listaDeIds(['a', 1, 'a', null, '']), ['a', '1']);
});

test('jornada: dias como objeto vazio ou com saída <= entrada é erro; ausente mantém o legado', () => {
  assert.deepEqual(sanearDias(undefined), { dias: null });
  assert.deepEqual(sanearDias(null), { dias: null });
  assert.ok(sanearDias({}).erro);
  assert.ok(sanearDias({ 1: { entrada: '08:00', saida: '08:00' } }).erro);
  assert.ok(sanearDias({ 1: { entrada: '22:00', saida: '06:00' } }).erro);
  assert.ok(sanearDias({ 1: { entrada: '25:00', saida: '17:00' } }).erro);
  assert.ok(sanearDias([1, 2]).erro);
  assert.ok(sanearDias('seg-sex').erro);
  assert.deepEqual(sanearDias({ 1: { entrada: '07:00', saida: '17:00', intervalo_min: '0' }, 2: null }),
    { dias: { 1: { entrada: '07:00', saida: '17:00', intervalo_min: 0 } } });
});

test('jornada: tolerância 0 é aceita; ausente ou vazia vira 10; teto 120', () => {
  assert.equal(toleranciaDe(0), 0); assert.equal(toleranciaDe('0'), 0);
  assert.equal(toleranciaDe(undefined), 10); assert.equal(toleranciaDe(''), 10); assert.equal(toleranciaDe('abc'), 10);
  assert.equal(toleranciaDe(7.6), 8); assert.equal(toleranciaDe(500), 120); assert.equal(toleranciaDe(-3), 0);
});

test('usuário novo: sem perfil nasce leitura; gestor de obra só com obras ativas da empresa', () => {
  assert.equal(PERFIL_PADRAO_NOVO, 'leitura');
  assert.deepEqual(perfilPedido({}, new Set(), PERFIL_PADRAO_NOVO), { perfil: 'leitura', obras: null });
  assert.deepEqual(perfilPedido({ perfil: 'rh', obras: ['e1'] }, new Set(), PERFIL_PADRAO_NOVO), { perfil: 'rh', obras: null });
  assert.ok(perfilPedido({ perfil: 'chefe' }, new Set(), PERFIL_PADRAO_NOVO).erro);
  const validas = new Set(['e1', 'e2']);
  assert.deepEqual(perfilPedido({ perfil: 'gestor_obra', obras: ['e1', 'eB', 'e1'] }, validas, null), { perfil: 'gestor_obra', obras: ['e1'] });
  assert.equal(perfilPedido({ perfil: 'gestor_obra', obras: ['eB'] }, validas, null).erro, 'escolha obras válidas da empresa');
  assert.equal(perfilPedido({ perfil: 'gestor_obra', obras: [] }, validas, null).erro, 'escolha as obras do gestor');
  assert.ok(perfilPedido({ perfil: 'gestor_obra' }, validas, null).erro);
});

test('almox: aviso de CA vencido na data da entrega (só EPI)', () => {
  assert.equal(caVencidoNaEntrega({ tipo: 'epi', ca_validade: '2026-01-31' }, '2026-02-01'), true);
  assert.equal(caVencidoNaEntrega({ tipo: 'epi', ca_validade: '2026-02-01' }, '2026-02-01'), false);
  assert.equal(caVencidoNaEntrega({ tipo: 'epi', ca_validade: null }, '2026-02-01'), false);
  assert.equal(caVencidoNaEntrega({ tipo: 'ferramenta', ca_validade: '2020-01-01' }, '2026-02-01'), false);
});

test('/rh/dados por perfil: almox não vê batidas nem ocorrências; leitura recebe resumo; atestado sem observação fora de saúde', () => {
  const v = perfil => visaoDados({ perfil });
  assert.deepEqual(v('almox'), { marcacoes: false, jornadas: false, alocacoes: false, ocorrencias: null, observacaoAtestado: false });
  assert.deepEqual(v('sst'), { marcacoes: false, jornadas: false, alocacoes: false, ocorrencias: 'completas', observacaoAtestado: false });
  assert.deepEqual(v('leitura'), { marcacoes: true, jornadas: true, alocacoes: true, ocorrencias: 'resumo', observacaoAtestado: false });
  assert.deepEqual(v('gestor_obra'), { marcacoes: true, jornadas: true, alocacoes: true, ocorrencias: 'completas', observacaoAtestado: false });
  assert.deepEqual(v('rh'), { marcacoes: true, jornadas: true, alocacoes: true, ocorrencias: 'completas', observacaoAtestado: true });
  assert.deepEqual(visaoDados({}), v('admin'));   // sem perfil gravado = administrador (legado)

  const ocs = [
    { id: 'o1', colaborador_id: 'c1', tipo: 'atestado', inicio: '2026-10-01', fim: '2026-10-02', estado: 'ativa', observacao: 'CID J11', origem: 'rh', tem_anexo: true },
    { id: 'o2', colaborador_id: 'c2', tipo: 'ferias', inicio: '2026-10-05', fim: null, estado: 'ativa', observacao: 'combinado', origem: 'rh', tem_anexo: false },
    { id: 'o3', colaborador_id: 'c1', tipo: 'atestado', inicio: '2026-10-09', fim: null, estado: 'pendente', observacao: 'enviado', origem: 'app', tem_anexo: true }
  ];
  assert.deepEqual(ocorrenciasVisiveis(ocs, v('almox')), []);
  assert.deepEqual(ocorrenciasVisiveis(ocs, v('leitura')), [
    { id: 'o1', colaborador_id: 'c1', tipo: 'atestado', inicio: '2026-10-01', fim: '2026-10-02', estado: 'ativa' },
    { id: 'o2', colaborador_id: 'c2', tipo: 'ferias', inicio: '2026-10-05', fim: null, estado: 'ativa' }
  ]);
  const sst = ocorrenciasVisiveis(ocs, v('sst'));
  assert.equal(sst.length, 3);
  assert.equal(sst[0].observacao, null); assert.equal(sst[1].observacao, 'combinado'); assert.equal(sst[2].observacao, null);
  assert.equal(ocs[0].observacao, 'CID J11');   // não muda a lista original
  assert.deepEqual(ocorrenciasVisiveis(ocs, v('rh')), ocs);
});
