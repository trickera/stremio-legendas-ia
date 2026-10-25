# stremio-legendas-ia

Addon do Stremio que pega a legenda em inglês do OpenSubtitles mais compatível com o seu arquivo (hash, grupo, fonte do release) e traduz pra PT-BR com Gemini. Cache em disco, ~5-8 requests por filme.

1. `npm install` e `cp .env.example .env` (chaves do Gemini e do OpenSubtitles)
2. Local: `npm start` e instale `http://127.0.0.1:7000/manifest.json` no Stremio
3. TV/celular: precisa de HTTPS. No Windows, `Ligar.cmd`/`Desligar.cmd` sobem via Tailscale Funnel; ou use o `render.yaml`

Licença MIT.
