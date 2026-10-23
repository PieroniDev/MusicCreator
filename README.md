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

O instalador não tem assinatura digital, então o Windows SmartScreen pode avisar
"Editor desconhecido": clique em **Mais informações → Executar assim mesmo**. O build de
macOS roda só manualmente (**Actions → Desktop → Run workflow**).

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
- Menu do canal (botão direito no nome): piano roll, renomear, clonar, mover, limpar
  notas, excluir e carregar sample.

### Piano Roll (F7)
- Criar, mover e redimensionar notas, com grade configurável (Alt: sem grade).
  Botão direito apaga.
- Seleção por retângulo (Ctrl+arrastar) e Shift+clique; Del, Ctrl+A/C/V, Ctrl+B
  (duplicar) e setas para transpor.
- Faixa de **velocity**, notas fantasma dos outros canais e teclado clicável.

### Gravação e MIDI
- **Teclado MIDI**: botão **MIDI** na barra. Todos os teclados conectados tocam o canal
  selecionado, com velocity e pedal de sustain.
- **Teclado do computador** como piano: `Z S X D C V G B H N J M` e `Q 2 W 3 E R 5 T 6 Y 7 U`.
- **Gravar notas**: arme o botão **●**, toque o pattern (modo PAT) e toque no teclado ou
  no MIDI. As notas entram no pattern, alinhadas à grade do piano roll.

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
| **Sampler** | Qualquer arquivo de áudio: afinação pela nota, one-shot ou loop, reverso, filtro e ADSR. |

### Efeitos nativos
Parametric EQ, Compressor, Limiter, Delay (sincronizado ao BPM, ping-pong), Reverb,
Distortion, Filter (com LFO) e Chorus/Flanger, todos com presets.

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
2. **Gravar áudio** (microfone ou interface) direto na playlist.
3. **Time-stretch e pitch-shift** de clips de áudio (seguir o BPM), e um editor de áudio.
4. Automação de **tempo**, sidechain e compensação de latência de plugins.
5. Mais instrumentos e efeitos: wavetable, granular, vocoder, multibanda, gate e
   transient shaper.
6. Ferramentas do piano roll (acordes, arpejador, quantizar, humanizar), editor de
   parâmetros por passo, import/export de MIDI e importação de `.flp` pela documentação
   pública do formato (por exemplo, o projeto PyFLP).
