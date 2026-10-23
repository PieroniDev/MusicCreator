# MusicCreator

Uma DAW (estação de produção musical) para **desktop (Windows, macOS, Linux)** e
**navegador**, com o fluxo de trabalho baseado em **patterns + playlist** que quem usa
FL Studio já conhece: Channel Rack com step sequencer, Piano Roll, Playlist de arranjo
com clips de pattern, de áudio e de automação, e Mixer com inserts, efeitos e roteamento.
Os instrumentos e efeitos nativos acompanham o app.

> **Sobre o FL Studio:** este projeto é uma implementação **original**, escrita do zero
> em TypeScript com a Web Audio API e o Electron. Ele **não contém, não copia e não foi
> derivado** de código, binários, plugins, samples, presets ou da identidade visual da
> Image-Line. "FL Studio" é marca da Image-Line, citada só para descrever o estilo de
> fluxo de trabalho. A interface e os nomes dos plugins também são próprios.

## Instalar o app desktop (Windows)

A cada push, o GitHub Actions gera os instaladores:

1. No GitHub, abra **Actions → Desktop** e clique na execução mais recente.
2. Em **Artifacts**, baixe **MusicCreator-Windows** (ou MusicCreator-Linux).
3. Descompacte e rode o `MusicCreator Setup x.y.z.exe`.

O build de macOS roda só manualmente (**Actions → Desktop → Run workflow**).

### O aviso "O Windows protegeu o computador" (SmartScreen)

O Windows mostra esse aviso para programas baixados que não têm assinatura digital de
um editor conhecido. O instalador gerado pelo GitHub não é assinado, porque a assinatura
exige um certificado emitido para você. As saídas, da mais rápida à mais completa:

**1. No seu computador, agora (grátis).** Clique em **Mais informações → Executar assim
mesmo**. Outra opção: clique com o botão direito no `.exe` → **Propriedades** → marque
**Desbloquear** → OK, e o aviso não aparece mais para esse arquivo. É seguro porque o
instalador foi gerado a partir do seu próprio código.

**2. Microsoft Store (grátis, sem aviso para ninguém — recomendado).** Na Store, a
Microsoft assina o pacote com o certificado dela, então quem instala por lá não vê
aviso. O cadastro de desenvolvedor individual é gratuito, e este repositório já gera o
pacote da Store (`MusicCreator-MicrosoftStore`, um `.appx`). Os passos:

1. Crie a conta em [storedeveloper.microsoft.com](https://storedeveloper.microsoft.com/)
   como desenvolvedor individual. A verificação pede documento com foto e uma selfie.
2. No Partner Center, crie o app e reserve o nome (por exemplo, "MusicCreator").
3. Em **Gerenciamento do produto → Identidade do produto**, copie três valores:
   `Package/Identity/Name`, `Package/Identity/Publisher` e
   `Package/Properties/PublisherDisplayName`.
4. No GitHub: **Settings → Secrets and variables → Actions → aba Variables**. Crie as
   variáveis `MS_STORE_IDENTITY_NAME`, `MS_STORE_PUBLISHER` e
   `MS_STORE_PUBLISHER_DISPLAY_NAME` com esses valores.
5. Rode de novo o workflow **Desktop** e baixe o artefato **MusicCreator-MicrosoftStore**.
6. No Partner Center, crie uma submissão:
   - envie o `.appx` em **Pacotes**;
   - preencha a página da loja (descrição, capturas de tela, classificação etária);
   - em **Recursos restritos** (`runFullTrust`), explique que é um app desktop
     (Electron) que lê e salva projetos e samples escolhidos pelo usuário.
7. A certificação leva de horas a alguns dias. A cada nova versão, aumente o campo
   `version` do `package.json`; a Store exige número de versão maior a cada envio.

O identificador padrão do `package.json` (`PieroniDev.MusicCreator`) serve só para
testar o build; a Store recusa pacotes que não usem a identidade do passo 3.

**3. Certificado de assinatura de código (pago).** Serve para tirar o aviso do `.exe`
baixado fora da Store. Mas assinar não basta para eliminar o aviso: desde 2024 nem
certificados EV pulam o SmartScreen. A assinatura troca "Fornecedor desconhecido" pelo
seu nome, e o aviso some à medida que o programa ganha reputação (downloads sem
problemas). Há duas formas:

- **Certificado OV** de uma autoridade certificadora (Certum, Sectigo, SSL.com…), de
  ~US$ 100 a 400 por ano. A Certum tem opção mais barata para código aberto. A chave
  fica num token físico ou num serviço em nuvem.
- **Azure Artifact Signing** (~US$ 10/mês). Hoje só aceita pessoa física dos EUA ou do
  Canadá, e empresas de alguns países (o Brasil não está na lista).

Com um certificado em mãos, a assinatura pode ser adicionada a este workflow.

## Rodar a partir do código

Requisitos: Node.js 20 ou mais novo.

```bash
npm install
npm run dev:desktop    # app desktop (Electron) com recarga automática da interface
npm run dev            # versão de navegador em http://localhost:5173
```

Outros comandos:

```bash
npm run start:desktop  # build e abre o app desktop
npm run dist:win       # gera o instalador do Windows em release/ (rode no Windows)
npm run dist:mac       # .dmg (rode no macOS)
npm run dist:linux     # AppImage (rode no Linux)
npm run build          # build da versão web em dist/
npm test               # testes unitários (Vitest)
npm run typecheck      # checagem de tipos (interface + processo do Electron)
```

Na primeira execução, o app abre uma **música demo** que usa as partes principais do
programa. Aperte **Espaço** para tocar.

## O que já funciona

### App desktop
- Menu nativo, abrir e salvar com os diálogos do sistema, e **Salvar** (Ctrl+S) no mesmo
  arquivo, além de Salvar como (Ctrl+Shift+S).
- **Arquivos recentes**. Dar dois cliques num `.mcproj` abre o projeto no app.
- O título mostra `•` quando há alterações não salvas, e o app pergunta se quer salvar
  antes de fechar.
- **Exportar WAV** (Ctrl+R) com diálogo de salvar.
- Posição e tamanho da janela são lembrados, e o áudio continua com o app em segundo plano.

### Navegador de samples (painel lateral)
- **Adicione pastas** do computador (a pasta Música já vem na lista) e navegue em árvore.
- Um clique **ouve o arquivo**; um duplo clique cria um canal **Sampler** com ele.
- Arraste um arquivo para o **Channel Rack**, que cria um canal novo (ou troca o som de
  um Sampler), ou para a **Playlist**, que cria um clip de áudio.
- No navegador web, arraste arquivos de áudio direto do computador.

### Channel Rack (F6)
- Um canal por instrumento: ligar/mudo (clique no LED), **solo** (botão direito no LED),
  pan, volume e faixa do mixer.
- **Step sequencer** com 16 passos por compasso e patterns de vários compassos. A roda do
  mouse sobre um passo ajusta a velocity.
- **Swing** global no cabeçalho.
- Menu do canal (botão direito no nome): piano roll, renomear, clonar, mover, excluir,
  carregar sample e ferramentas de passos (**preencher a cada 2/4/8 passos**,
  **deslocar** para os lados, **aleatorizar**, **inverter**, limpar).

### Piano Roll (F7)
- Criar, mover e redimensionar notas, com grade configurável (Alt: sem grade).
  Botão direito apaga.
- Seleção por retângulo (Ctrl+arrastar) e Shift+clique; Del, Ctrl+A/C/V, Ctrl+B
  (duplicar) e setas para transpor.
- Faixa de **velocity**, notas fantasma dos outros canais e teclado clicável.
- Menu **Ferramentas**, aplicado à seleção ou a todas as notas: quantizar (início,
  início+duração, 50%), legato, **arpejador** (↑, ↓, ↑↓ na grade), strum, picotar,
  humanizar, inverter, transformar em acorde e encaixar na escala.
- **Carimbo de acorde**: cada clique cria o acorde inteiro (maior, menor, 7, maj7, m7, 9,
  sus, diminuto, aumentado, power chord…).
- **Destaque de escala**: escolha tônica e escala (maior, menores, pentatônicas, blues,
  modos) e as teclas fora dela ficam escurecidas.

### Gravação, MIDI e arquivos MIDI
- **Teclado MIDI**: botão **MIDI** na barra. Todos os teclados conectados tocam o canal
  selecionado, com velocity e pedal de sustain.
- **Teclado do computador** como piano: `Z S X D C V G B H N J M` e `Q 2 W 3 E R 5 T 6 Y 7 U`.
- **Gravar notas**: arme o botão **●**, toque o pattern (modo PAT) e toque no teclado ou
  no MIDI. As notas entram no pattern, alinhadas à grade do piano roll.
- **Gravar áudio** (microfone ou interface): botão direito no **●** → "Gravar áudio",
  arme e toque a música (modo SONG). Cada take vira um canal Sampler e um clip de áudio na
  Playlist, em qualidade total (PCM, sem compressão).
- **Exportar e importar MIDI** (`.mid`) no menu **Arquivo**. Faixas de bateria General
  MIDI viram canais de Drum Synth separados (kick, snare, hats…).

### Playlist (F5)
- **Clips de pattern**: clique para "pintar" e arraste para mover. Esticar a borda repete
  o pattern.
- **Clips de áudio**: arraste arquivos de áudio. Eles mostram a forma de onda, as bordas
  cortam o início e o fim, e começam a tocar certo mesmo se a música começar no meio deles.
- **Clips de automação**: clique com o botão direito em **qualquer knob ou fader** e
  escolha **Criar clip de automação**. Na Playlist, arraste os pontos da curva, dê duplo
  clique para criar um ponto e botão direito num ponto para apagar. Dá para automatizar
  volume/pan dos canais, qualquer parâmetro de instrumento, volume/pan do mixer e
  qualquer parâmetro de efeito.
- Faixas com mudo e nome, grade, zoom e régua para escolher onde a música começa.
- **Ctrl+B** duplica o clip selecionado. O botão direito no nome do clip abre o menu
  (duplicar, **tornar único** — o clip ganha a própria cópia do pattern —, abrir, excluir).

### Mixer (F9)
- Master + 16 inserts, com fader, pan, mudo, solo e medidores de pico estéreo.
- Até 8 efeitos por faixa, com bypass, reordenação e remoção.
- **Roteamento**: com um insert selecionado, a seta **▲** embaixo de outro insert envia o
  sinal para lá, com nível ajustável. Dá para tirar o insert do Master, e rotas que
  criariam loop são bloqueadas.

### Instrumentos nativos
| Instrumento | O que é |
|---|---|
| **Trio Synth** | Subtrativo de 3 osciladores, unísono de até 7 vozes, filtro ressonante com envelope e ADSR. |
| **FM Synth** | FM de 2 operadores: pianos elétricos, sinos, baixos e metais. |
| **Drum Synth** | Bateria sintetizada: kick, snare, clap, hats, tom, rim, cowbell e prato. |
| **Drum Pads** | 16 pads com um sample cada (teclas C3 a D#4), já vem com um kit sintetizado; arraste seus samples nos pads. |
| **Sampler** | Qualquer arquivo de áudio: afinação pela nota, one-shot ou loop, reverso, filtro e ADSR. |
| **Slicer** | Fatia um loop pelos ataques ou em partes iguais, uma fatia por tecla; "Gerar notas das fatias" recria o loop no Piano Roll. |

### Efeitos nativos
Parametric EQ, Compressor, **Multiband Compressor** (3 bandas), Limiter, Delay
(sincronizado ao BPM, ping-pong), Reverb, Distortion, Filter (com LFO), Chorus/Flanger,
**Phaser**, **Stereo Enhancer** (largura mid/side e Haas), **Trance Gate** e **Sidechain
Pump**. Os dois últimos ficam sincronizados às batidas da música, também na exportação.
Todos têm presets.

### Projeto
- Desfazer/refazer em tudo (Ctrl+Z / Ctrl+Y) e autosave.
- Arquivos `.mcproj` guardam os samples dentro do projeto.
- **Exportar WAV** (16 bits, 44,1 kHz) da música ou do pattern, com automação, clips de
  áudio, swing e roteamento, igual ao que se ouve.

## Arquitetura

```
electron/     processo principal do app desktop (janela, menu, diálogos, arquivos)
              e o preload, que expõe à interface só uma API pequena e validada
src/
  desktop/    contrato dessa API e integração (comandos do menu, título da janela)
  model/      dados do projeto: tempo em ticks, patterns, eventos, automação,
              roteamento, (de)serialização
  plugins/    instrumentos e efeitos nativos (Web Audio), parâmetros e presets
  audio/      grafo de áudio (canais → inserts → master/envios), motor em tempo real
              com agendador de lookahead, render offline, MIDI, pré-escuta
  state/      estado global (Zustand + Immer), histórico de desfazer e autosave
  ui/         interface React
tests/        testes unitários
```

- **Segurança do app desktop:** a interface roda isolada (`contextIsolation`, `sandbox`,
  sem Node.js). Ela só pede ao processo principal operações específicas, que validam
  caminhos, extensões e tamanhos.
- **Tempo:** 96 ticks por semínima. O motor agenda cerca de 120 ms à frente usando o
  relógio do `AudioContext`, e o mesmo grafo é usado ao vivo e na exportação.

## O que ainda falta para chegar perto do FL Studio

Este é um projeto em fases. As maiores lacunas, em ordem de impacto:

1. **Plugins VST3 de terceiros.** O próximo passo grande. Exige trocar o motor de áudio
   (hoje é a Web Audio do Chromium) por um **motor nativo em C++**, com hospedagem de
   VST3 e saída ASIO/WASAPI de baixa latência. A interface atual continuaria, conversando
   com esse motor. O SDK do VST3 é MIT desde a versão 3.8; o JUCE facilitaria, mas tem
   licença AGPL ou comercial, uma escolha a fazer antes de começar.
2. **Time-stretch e pitch-shift** de clips de áudio (seguir o BPM), e um editor de áudio.
3. Escolher a entrada de áudio, monitorar a entrada e gravar em loop (takes).
4. Automação de **tempo**, sidechain e compensação de latência de plugins.
5. Mais instrumentos e efeitos: wavetable, granular, vocoder, multibanda, gate e
   transient shaper.
6. Editor de parâmetros por passo (pitch/pan por passo), fórmulas de compasso além de
   4/4, marcadores na playlist e importação de `.flp` pela documentação pública do
   formato (por exemplo, o projeto PyFLP).
