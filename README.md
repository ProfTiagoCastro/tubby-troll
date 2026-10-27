# Tubby Troll

Jogo de plataforma multiplayer "troll" para a aula de Computação em Nuvem.
São 5 fases cheias de pegadinhas. Cada jogador entra só com o nome, escolhe a cor e a antena do seu Tubby
e vê os colegas que estão na mesma fase como fantasminhas. Quem zera entra no ranking (menos mortes vence; empate, o mais rápido).

## Arquitetura

```
navegador (canvas)  ──WebSocket (Socket.IO)──►  container Node.js  ──SSL──►  Postgres no Neon
   física do jogo                               posições + mortes              tabela "campeoes"
```

- `server.js`: Express (arquivos estáticos + `/api/ranking` + `/health`) e Socket.IO (posições, mortes, fases)
- `public/levels.js`: as 5 fases (dá pra editar e criar novas!)
- `public/game.js`: motor do jogo, desenho dos Tubbies e multiplayer
- `Dockerfile` / `docker-compose.yml`: empacotamento e execução

## Rodar com Docker

O repositório já vem com o `.env` apontando para o banco Neon da turma, então é só clonar e subir:

```bash
git clone <url-deste-repositorio>
cd tubby-troll
docker compose up --build
```

Abra http://localhost:3000. Outros alunos na mesma rede acessam por `http://IP-DA-MAQUINA:3000`.

> Para usar outro banco, troque a `DATABASE_URL` no `.env` (o `.env.example` mostra o formato).

Sem compose:

```bash
docker build -t tubby-troll .
docker run -p 3000:3000 --env-file .env tubby-troll
```

## Rodar sem Docker (desenvolvimento)

```bash
npm install
npm run dev
```

## Coisas para mostrar na aula

- O `.env` **não** entra na imagem (`.dockerignore`): segredo vem de fora, pelo ambiente.
  (Aqui ele está no repositório só porque o banco é descartável e foi criado para a aula; em projeto real, segredo nunca vai pro Git.)
- `HEALTHCHECK` no Dockerfile chama `/health`, que também testa o banco (`docker ps` mostra `healthy`).
- Cache de camadas: `package.json` é copiado antes do código, então mudar o jogo não reinstala dependências.
- O container roda como usuário `node`, não root.
- Ranking: `SELECT * FROM campeoes ORDER BY mortes, tempo_ms;` direto no console do Neon.

## Controles

Setas ou WASD para andar, ↑ / W / espaço para pular, R para recomeçar a fase, M liga/desliga o som (também tem o botão no topo). O botão "Sair" no topo volta para a tela de montar o Tubby.
