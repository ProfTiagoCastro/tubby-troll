// As 5 fases do Tubby Troll, compartilhadas entre servidor e navegador.
//
// Cada fase tem:
//   paint:    retângulos pintados no mapa [caractere, x1, y1, x2, y2] (em blocos)
//   ents:     objetos especiais com id (que se mexem, aparecem, caem...)
//   triggers: armadilhas. Quando o jogador entra na "zone" [x1, y1, x2, y2],
//             o objeto "target" executa "do": fall | move | show | hide
//
// Caracteres do mapa:
//   #  chão/parede          ^  espinho (pra cima)    v  espinho (pra baixo)
//   S  início do jogador    D  porta de saída         K  chave
//   J  mola                 C  bloco que desmorona    ?  bloco invisível
//   F  bloco falso          G  inversor de gravidade
//   B  bloco invisível que quebra 1 segundo depois de pisado
(function (root) {
  const T = 40;
  const COLS = 30;
  const ROWS = 16;

  const LEVELS = [
    {
      // Espinhos brotam do nada logo no começo, o chão cai, outro espinho surge onde o pulo longo cai
      // e quem pula por cima da porta perde o chão do outro lado
      name: 'Só seguir em frente',
      paint: [
        ['#', 0, 14, 29, 15], ['.', 16, 14, 18, 15], ['.', 28, 14, 29, 15],
        ['S', 2, 13], ['^', 22, 13], ['D', 27, 13],
      ],
      ents: [
        { id: 'brota1', k: 'spike', x: 5, y: 13, hidden: true },
        { id: 'brota2', k: 'spike', x: 9, y: 13, hidden: true },
        { id: 'chao', k: 'block', x: 16, y: 14, w: 3, h: 2 },
        { id: 'surpresa', k: 'spike', x: 25, y: 13, hidden: true },
        { id: 'fundo', k: 'block', x: 28, y: 14, w: 2, h: 2 },
      ],
      triggers: [
        { zone: [3, 0, 3, 15], target: 'brota1', do: 'show' },
        { zone: [7, 0, 7, 15], target: 'brota2', do: 'show' },
        { zone: [13, 0, 15, 15], target: 'chao', do: 'fall' },
        { zone: [21, 0, 21, 15], target: 'surpresa', do: 'show' },
        { zone: [28, 0, 29, 15], target: 'fundo', do: 'fall' },
      ],
    },
    {
      // Espinho na entrada da caverna (tem que entrar pulando), teto que cai e,
      // em cima do último bloco caído, despenca mais um pedacinho
      name: 'Olha o teto',
      paint: [
        ['#', 0, 14, 29, 15], ['#', 6, 0, 26, 10],
        ['.', 10, 10, 11, 10], ['.', 16, 10, 17, 10], ['.', 22, 10, 23, 10], ['.', 25, 10, 26, 10], ['.', 26, 9],
        ['S', 1, 13], ['D', 28, 13],
      ],
      ents: [
        { id: 'entrada', k: 'spike', x: 7, y: 13, hidden: true },
        { id: 'c1', k: 'crusher', x: 10, y: 10, w: 2, h: 1 },
        { id: 'c2', k: 'crusher', x: 16, y: 10, w: 2, h: 1 },
        { id: 'c3', k: 'crusher', x: 22, y: 10, w: 2, h: 1 },
        { id: 'c4', k: 'crusher', x: 25, y: 10, w: 2, h: 1 },
        { id: 'pedaco', k: 'crusher', x: 26, y: 9, w: 1, h: 1 },
      ],
      triggers: [
        { zone: [6, 0, 6, 15], target: 'entrada', do: 'show' },
        { zone: [10, 0, 11, 15], target: 'c1', do: 'fall', delay: 0.12 },
        { zone: [16, 0, 17, 15], target: 'c2', do: 'fall', delay: 0.12 },
        { zone: [18, 0, 19, 15], target: 'c3', do: 'fall', delay: 0.25 },
        { zone: [22, 0, 23, 15], target: 'c4', do: 'fall', delay: 0.1 },
        { zone: [25, 0, 26, 12], target: 'pedaco', do: 'fall', delay: 0.05, req: 4 },
      ],
    },
    {
      // O "deck" sobre os espinhos é falso. A ponte invisível acende quando você pisa,
      // mas o bloco do meio e o último quebram em 1 segundo. Perto da porta o chão abre: só entra pulando
      name: 'Ponte invisível',
      paint: [
        ['#', 0, 14, 7, 15], ['F', 8, 14, 21, 15], ['#', 22, 14, 24, 15],
        ['?', 10, 12, 11, 12], ['B', 14, 12, 15, 12], ['B', 18, 12, 19, 12],
        ['S', 1, 13], ['D', 27, 13],
      ],
      ents: [
        { id: 'espinhos', k: 'spike', x: 8, y: 15, w: 14, h: 1 },
        { id: 'piso', k: 'block', x: 25, y: 14, w: 5, h: 2 },
      ],
      triggers: [{ zone: [24, 0, 24, 15], target: 'piso', do: 'hide' }],
    },
    {
      // Ao subir, o teto onde você pousaria se abre; ao descer, espinhos surgem onde você cairia.
      // E um dos inversores no teto é falso
      name: 'De ponta-cabeça',
      paint: [
        ['#', 0, 0, 6, 1], ['#', 11, 0, 29, 1], ['#', 0, 14, 9, 15], ['#', 22, 14, 29, 15], ['^', 10, 15, 21, 15],
        ['G', 8, 11, 8, 13], ['G', 15, 2], ['v', 19, 2], ['v', 22, 2], ['G', 25, 2, 25, 4],
        ['S', 1, 13], ['D', 28, 13],
      ],
      ents: [
        { id: 'teto', k: 'block', x: 7, y: 0, w: 4, h: 2 },
        { id: 'pouso', k: 'spike', x: 24, y: 13, w: 3, h: 1, hidden: true },
      ],
      triggers: [
        { zone: [8, 11, 8, 13], target: 'teto', do: 'hide' },
        { zone: [25, 2, 25, 4], target: 'pouso', do: 'show' },
      ],
    },
    {
      // Ponte que desmorona rápido com buraco no meio; o último bloco cai na hora (tem que pular),
      // espinho surpresa, porta falsa, pula-pula do outro lado do espinho e, lá em cima,
      // um canhão atrás da porta de verdade que atira na sua direção
      name: 'A última porta',
      paint: [
        ['#', 0, 14, 6, 15], ['C', 7, 14, 12, 14], ['C', 15, 14, 19, 14], ['^', 7, 15, 20, 15], ['#', 21, 14, 29, 15],
        ['#', 23, 5, 29, 5], ['S', 1, 13],
      ],
      ents: [
        { id: 'ultimo', k: 'crumble', x: 20, y: 14, time: 0.02 },
        { id: 'falsa', k: 'door', x: 27, y: 12, w: 1, h: 2, fake: true },
        { id: 'espinho', k: 'spike', x: 24, y: 13, hidden: true },
        { id: 'mola', k: 'spring', x: 21, y: 13, hidden: true },
        { id: 'real', k: 'door', x: 28, y: 3, w: 1, h: 2, hidden: true },
        { id: 'canhao', k: 'cannon', x: 29, y: 4, dir: -1, hidden: true, first: 0.35, every: 1.4, speed: 520 },
      ],
      triggers: [
        { zone: [21, 0, 21, 15], target: 'espinho', do: 'show' },
        { zone: [25, 0, 26, 15], target: 'falsa', do: 'move', to: [27, 16], speed: 400 },
        { zone: [25, 0, 26, 15], target: 'mola', do: 'show' },
        { zone: [25, 0, 26, 15], target: 'real', do: 'show' },
        { zone: [23, 0, 27, 4], target: 'canhao', do: 'show', req: 2 },
      ],
    },
  ];

  // Converte "paint" numa grade 30x16 de caracteres
  function buildGrid(level) {
    const g = Array.from({ length: ROWS }, () => Array(COLS).fill('.'));
    for (const [ch, x1, y1, x2 = x1, y2 = y1] of level.paint) {
      for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) g[y][x] = ch;
    }
    return g;
  }

  const API = { T, COLS, ROWS, LEVELS, buildGrid };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.GAME = API;
})(this);
