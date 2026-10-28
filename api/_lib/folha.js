// Hash da folha de ponto fechada: sha256 do JSON canônico (chaves em ordem), para a
// assinatura provar exatamente qual conteúdo o colaborador viu e aceitou.
import { createHash } from 'node:crypto';

export function jsonCanonico(v) {
  if (Array.isArray(v)) return '[' + v.map(jsonCanonico).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().filter(k => v[k] !== undefined)
      .map(k => JSON.stringify(k) + ':' + jsonCanonico(v[k])).join(',') + '}';
  }
  return JSON.stringify(v === undefined ? null : v);
}

export const hashDaFolha = conteudo => createHash('sha256').update(jsonCanonico(conteudo)).digest('hex');

// Texto do aceite do meio eletrônico, gravado junto de cada assinatura.
export const TERMO_ASSINATURA = 'Confiro que esta folha de ponto corresponde à minha jornada no período e a assino ' +
  'eletronicamente com reconhecimento facial, que aceito como forma válida de assinatura entre mim e a empresa.';
