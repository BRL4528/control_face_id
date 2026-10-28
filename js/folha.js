// Folha de ponto para assinar: uma página A4 por colaborador, no layout da folha
// que a empresa já usa (modelo Efrat: timbrado, período, colaborador e função,
// uma linha por dia com as 4 batidas, total, extra, ocorrência e obra). Abre numa
// janela própria; "Imprimir / Salvar em PDF" gera o lote inteiro de uma vez.
//
// Os números vêm prontos de regras.js (folhaDoMes); aqui é só apresentação.
import { esc } from './ui.js';

const MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const hm = min => { const n = Math.round(Number(min) || 0); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0'); };

const CSS = `
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; background: #e5e7eb; font-family: Arial, Helvetica, sans-serif; color: #111 }
.barra { position: sticky; top: 0; z-index: 5; display: flex; gap: 12px; align-items: center; justify-content: center;
  padding: 10px; background: #0f172a; color: #fff; font-size: 14px }
.barra button { font: inherit; padding: 8px 16px; border: 0; border-radius: 8px; background: #2563eb; color: #fff; cursor: pointer }
.pagina { position: relative; width: 210mm; height: 297mm; margin: 12px auto; background: #fff; overflow: hidden;
  box-shadow: 0 2px 10px rgba(0,0,0,.15); page-break-after: always; break-after: page }
.fundo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: fill; z-index: 0 }
.conteudo { position: relative; z-index: 1; padding: 12mm 13mm 0 }
.cab { display: flex; align-items: center; gap: 5mm; margin-bottom: 3mm }
.cab img { height: 15mm; width: auto }
.cab .emp { flex: 1; text-align: center; font-size: 9pt; font-weight: 700; line-height: 1.5 }
.info { display: grid; grid-template-columns: auto 1fr; gap: 1mm 3mm; font-size: 8pt; margin-bottom: 3mm }
.info b { font-weight: 700 }
table { width: 100%; border-collapse: collapse; font-size: 7.2pt; text-align: center }
th { background: #d1d5db; font-weight: 700; padding: 1.1mm 0.6mm; border: 0.2mm solid #9ca3af }
td { padding: 0.75mm 0.6mm; border: 0.2mm solid #cbd5e1; white-space: nowrap }
tr.fds td { background: rgba(229,231,235,.85) }
td.obra { text-align: left; max-width: 46mm; overflow: hidden; text-overflow: ellipsis }
td.oc { font-weight: 700 }
td.oc.falta { background: #dc2626 !important; color: #fff }
td.oc.aviso { background: #f59e0b !important; color: #fff }
td.oc.neutro { color: #475569 }
.resumo { display: grid; grid-template-columns: 1fr 1.4fr; gap: 4mm; margin-top: 3mm; font-size: 7.6pt }
.resumo table { font-size: 7.4pt }
.resumo td:first-child { text-align: left }
.nota { font-size: 6.8pt; color: #475569; margin-top: 1.5mm }
.ass { margin-top: 9mm; display: flex; justify-content: space-between; align-items: flex-end; font-size: 7.8pt }
.ass .linha { width: 85mm; border-top: 0.25mm solid #111; text-align: center; padding-top: 1mm; font-weight: 700 }
@media print { body { background: #fff } .barra { display: none } .pagina { margin: 0; box-shadow: none } }
`;

function pagina(f, ctx) {
  const { empresa, timbrado, logo } = ctx;
  const [ano, mes] = f.mes.split('-').map(Number);
  const nomeLinha = esc(f.nome) + (f.funcao ? ' (' + esc(f.funcao) + ')' : '');
  const classeOc = oc => oc === 'FALTA' ? 'falta' : (oc === 'INCOMPLETO' || oc === 'A CONFIRMAR') ? 'aviso' : 'neutro';
  const linhas = f.dias.map(d =>
    '<tr' + (d.semana === 'SÁBADO' || d.semana === 'DOMINGO' ? ' class="fds"' : '') + '>' +
      '<td>' + d.num + '</td><td>' + d.semana + '</td>' +
      d.batidas.map((h, i) => '<td>' + (h || '') + (i === 3 && d.mais_batidas ? '*' : '') + '</td>').join('') +
      '<td>' + (d.trabalhado ? hm(d.trabalhado) : '') + '</td>' +
      '<td>' + (d.extra ? hm(d.extra) : '') + '</td>' +
      '<td class="oc ' + classeOc(d.ocorrencia) + '">' + (d.ocorrencia || '') + '</td>' +
      '<td class="obra">' + esc(d.obra) + '</td></tr>').join('');
  const t = f.totais;
  const rateio = f.rateio.length
    ? f.rateio.map(r => '<tr><td>' + esc(r.obra) + '</td><td>' + r.dias + '</td><td>' + hm(r.minutos) + '</td></tr>').join('')
    : '<tr><td colspan="3">Sem dias trabalhados no período</td></tr>';
  const notas = [];
  if (t.batidas_alem_de_4) notas.push('* Dia com mais de 4 batidas: o total considera todas.');
  if (t.a_confirmar) notas.push(t.a_confirmar + ' dia(s) com batida aguardando conferência do RH.');

  return '<section class="pagina">' +
    (timbrado ? '<img class="fundo" src="' + timbrado + '" alt="">' : '') +
    '<div class="conteudo" style="padding-bottom:' + (timbrado ? '40mm' : '14mm') + '">' +
      '<div class="cab">' + (logo ? '<img src="' + logo + '" alt="">' : '') +
        '<div class="emp">' + esc(empresa.razao || empresa.nome || '') + (empresa.cnpj ? ' &nbsp;' + esc(empresa.cnpj) : '') +
          '<br>FOLHA DE PONTO - COLABORADORES</div></div>' +
      '<div class="info">' +
        '<b>PERÍODO DE REFERÊNCIA:</b><span>' + MESES[mes - 1] + ' ' + ano + '</span>' +
        '<b>COLABORADOR:</b><span>' + nomeLinha + (f.matricula ? ' &nbsp;·&nbsp; MATRÍCULA ' + esc(f.matricula) : '') + '</span>' +
      '</div>' +
      '<table><thead><tr><th>DIA</th><th>SEMANA</th><th>ENTRADA</th><th>SAÍDA</th><th>ENTRADA</th><th>SAÍDA</th>' +
        '<th>TOTAL</th><th>H.E.</th><th>FALTAS</th><th>OBRA</th></tr></thead><tbody>' + linhas + '</tbody></table>' +
      '<div class="resumo">' +
        '<table><tbody>' +
          '<tr><td>Dias trabalhados</td><td><b>' + t.dias_trabalhados + '</b></td></tr>' +
          '<tr><td>Horas trabalhadas</td><td><b>' + hm(t.trabalhado) + '</b></td></tr>' +
          '<tr><td>Horas extras</td><td><b>' + hm(t.extra) + '</b></td></tr>' +
          '<tr><td>Horas a menos</td><td><b>' + hm(t.a_menos) + '</b></td></tr>' +
          '<tr><td>Faltas</td><td><b>' + t.faltas + '</b></td></tr>' +
        '</tbody></table>' +
        '<table><thead><tr><th>RATEIO POR OBRA</th><th>DIAS</th><th>HORAS</th></tr></thead><tbody>' + rateio + '</tbody></table>' +
      '</div>' +
      (notas.length ? '<div class="nota">' + notas.join(' ') + '</div>' : '') +
      '<div class="ass"><span>Data: ____/____/________</span><div class="linha">' + nomeLinha + '</div></div>' +
    '</div></section>';
}

/**
 * HTML completo do lote. `folhas`: [{ nome, funcao, matricula, mes, dias, totais, rateio }]
 * (folhaDoMes + identificação). `ctx`: { empresa: { nome, razao, cnpj }, timbrado, logo }
 * com timbrado/logo em data URL (Configurações → Folha de ponto).
 */
export function htmlFolhas(folhas, ctx) {
  const titulo = 'Folhas de ponto ' + (folhas[0] ? folhas[0].mes : '');
  return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>' + esc(titulo) + '</title>' +
    '<style>' + CSS + '</style></head><body>' +
    '<div class="barra"><span>' + folhas.length + ' folha(s) · uma página por colaborador</span>' +
      '<button onclick="print()">Imprimir / Salvar em PDF</button></div>' +
    folhas.map(f => pagina(f, ctx)).join('') +
    '</body></html>';
}

/** Abre a janela do lote já no clique (pop-up aberto depois de um await é bloqueado). null se bloqueou. */
export function janelaDasFolhas() {
  const w = window.open('', '_blank');
  if (w) w.document.write('<p style="font-family:Arial;padding:24px">Gerando as folhas…</p>');
  return w;
}

/** Escreve o lote na janela aberta por janelaDasFolhas. */
export function escreverFolhas(w, folhas, ctx) {
  w.document.open();
  w.document.write(htmlFolhas(folhas, ctx));
  w.document.close();
}
