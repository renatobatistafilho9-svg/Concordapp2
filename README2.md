# Chamada + Música (tipo Discord + Jockie Music)

Chamada de voz/vídeo em sala (WebRTC) com um player de música do YouTube
sincronizado pra todo mundo que tá na sala.

## Rodar localmente

```bash
npm install
npm start
```

Abre `http://localhost:3000` em duas abas/dispositivos diferentes, entra na
mesma sala com nomes diferentes, e testa.

## Subir no Render ou Railway

1. Sobe essa pasta inteira num repositório do GitHub.
2. No Render: **New > Web Service**, conecta o repo, *Build Command*
   `npm install`, *Start Command* `npm start`. No Railway é parecido —
   ele detecta o `package.json` sozinho.
3. Não precisa configurar variável de porta: o código já usa
   `process.env.PORT`, que essas plataformas definem sozinhas.
4. Depois do deploy, a URL que a plataforma te der já funciona pra chamada
   e música, contanto que seja `https://` (câmera/microfone só funcionam em
   HTTPS ou `localhost`).

## Como funciona

- **Chamada**: cada participante se conecta diretamente com todo mundo da
  sala (WebRTC "mesh"). O servidor só serve de intermediário pra trocar os
  dados de conexão (sinalização) — o áudio/vídeo em si vai direto entre os
  navegadores. Funciona bem até uns 6-8 participantes; passando disso, a
  qualidade cai porque cada um manda vídeo pra todos os outros ao mesmo
  tempo.
- **Música**: qualquer um cola um link do YouTube e manda tocar. O servidor
  guarda o estado (qual vídeo, se tá tocando, em que segundo) e avisa todo
  mundo na sala — inclusive quem entra depois já recebe a música rolando no
  ponto certo.

## Limitações a saber

- Sem servidor TURN, em redes muito restritivas a conexão direta entre dois
  participantes pode falhar (fica sem áudio/vídeo só daquele par). Pra
  resolver isso 100% das vezes, seria necessário um serviço de TURN pago
  (ex: Twilio, Metered.ca — têm planos gratuitos pequenos).
- O player de música usa o YouTube, então o áudio da música toca separado
  do áudio da chamada (não dá pra "misturar" os dois num único stream sem
  processamento extra no servidor).
- Estado das salas fica só em memória — se o servidor reiniciar, as salas
  ativas se perdem (as chamadas em si não são afetadas até alguém entrar
  ou sair).
