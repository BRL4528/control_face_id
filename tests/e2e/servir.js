// Sobe o servidor falso para conferir o app na mao, sem depender do n8n.
import { subir } from './servidor-falso.js';
const { url } = await subir();
console.log('app:   ' + url + '/index.html');
console.log('token: TOKEN-TESTE');
