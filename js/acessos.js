// Perfis de acesso ao painel e o que cada um pode ver e alterar. Módulo puro:
// o servidor aplica (api/_lib/acesso.js, toda rota do RH) e o painel só esconde
// o que o perfil não vê. Usuário sem perfil gravado é administrador (todos os
// usuários anteriores a este controle).
export const MODULOS = {
  operacao:    'Central, escala e mapa',
  ponto:       'Pendências, espelho de ponto e jornadas',
  pessoas:     'Colaboradores e equipes',
  ocorrencias: 'Ocorrências (férias, afastamentos)',
  saude:       'Atestados e fotos de documentos de saúde',
  eventos:     'Advertências e acidentes',
  almox:       'EPI e ferramentas',
  relatorios:  'Relatórios e folha de ponto',
  config:      'Configurações, usuários e auditoria'
};

const TODOS = Object.keys(MODULOS);

export const PERFIS = {
  admin:       { rotulo: 'Administrador', ver: TODOS, editar: TODOS },
  rh:          { rotulo: 'RH', ver: TODOS.filter(m => m !== 'config'), editar: TODOS.filter(m => m !== 'config') },
  gestor_obra: { rotulo: 'Gestor de obra', ver: ['operacao', 'ponto', 'ocorrencias', 'eventos', 'relatorios'],
                 editar: ['ponto', 'eventos'], porObra: true },
  sst:         { rotulo: 'Segurança do trabalho', ver: ['pessoas', 'ocorrencias', 'eventos', 'almox'], editar: ['eventos', 'almox'] },
  almox:       { rotulo: 'Almoxarifado', ver: ['pessoas', 'almox'], editar: ['almox'] },
  leitura:     { rotulo: 'Somente leitura', ver: ['operacao', 'ponto', 'pessoas', 'relatorios'], editar: [] }
};

/** Perfil efetivo: o gravado, ou administrador quando não há (legado / antes da migração). */
export const perfilDe = acesso => PERFIS[acesso && acesso.perfil] ? acesso.perfil : 'admin';

/** O acesso { perfil, obras } pode ver (ou, com `editar`, alterar) o módulo? */
export function pode(acesso, modulo, editar) {
  const p = PERFIS[perfilDe(acesso)];
  return (editar ? p.editar : p.ver).includes(modulo);
}

/** Obras visíveis: null = todas; array de equipe_id quando o perfil é por obra. */
export function obrasDe(acesso) {
  const p = PERFIS[perfilDe(acesso)];
  if (!p.porObra) return null;
  return Array.isArray(acesso && acesso.obras) ? acesso.obras : [];
}

/** Aba do painel → módulo. */
export const ABA_MODULO = {
  painel: 'operacao', planos: 'operacao', alocacao: 'operacao', mapa: 'operacao',
  pendencias: 'ponto', registros: 'ponto', jornadas: 'ponto',
  pessoas: 'pessoas', equipes: 'pessoas', ocorrencias: 'ocorrencias', eventos: 'eventos', almox: 'almox',
  relatorios: 'relatorios', auditoria: 'config', config: 'config'
};
