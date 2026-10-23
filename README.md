# MusicCreator

Uma DAW (estação de produção musical) que roda no navegador, com o fluxo de trabalho
baseado em **patterns + playlist** que quem usa FL Studio já conhece: Channel Rack com
step sequencer, Piano Roll, Playlist de arranjo e Mixer com inserts de efeito. Os
instrumentos e efeitos nativos acompanham o app.

> **Sobre o FL Studio:** este projeto é uma implementação **original**, escrita do zero
> em TypeScript com a Web Audio API. Ele **não contém, não copia e não foi derivado** de
> código, binários, plugins, samples, presets ou da identidade visual da Image-Line.
> "FL Studio" é marca da Image-Line, citada só para descrever o estilo de fluxo de
> trabalho. A interface e os nomes dos plugins também são próprios.

## Como rodar

Requisitos: Node.js 20 ou mais novo.

```bash
npm install
npm run dev        # abre em http://localhost:5173
```

Outros comandos:

```bash
npm run build      # build de produção em dist/
npm run preview    # serve o build
npm test           # testes unitários (Vitest)
npm run typecheck  # checagem de tipos
```

Na primeira execução, o app abre uma **música demo** que usa todas as partes do programa.
Aperte **Espaço** para tocar.

## O que já funciona

### Channel Rack (F6)
- Um canal por instrumento: ligar/mudo (clique no LED), **solo** (botão direito no LED),
  pan, volume e faixa do mixer.
- **Step sequencer** com 16 passos por compasso. Patterns podem ter vários compassos, e a
  roda do mouse sobre um passo ajusta a velocity.
- Canais com notas mais elaboradas mostram uma miniatura do piano roll; o clique abre o editor.
- Menu do canal (botão direito no nome): piano roll, renomear, clonar, mover, limpar
  notas, excluir e carregar sample.
- Arrastar um arquivo de áudio para cima de um canal Sampler carrega o arquivo.

### Piano Roll (F7)
- Clique para criar notas e arraste para mover; a borda direita muda a duração.
  Botão direito (ou arrastando) apaga.
- Grade configurável (de 1/6 de passo até 1 compasso) e Alt para mover sem grade.
- Ctrl+arrastar seleciona com retângulo e Shift+clique adiciona ou remove da seleção.
- Del apaga, Ctrl+A seleciona tudo, Ctrl+C/Ctrl+V copia e cola, Ctrl+B duplica e as
  setas transpõem (Shift: uma oitava).
- Faixa de **velocity** editável, notas fantasma dos outros canais do pattern e teclado
  clicável para ouvir as notas.

### Playlist (F5)
- Clique para "pintar" o pattern selecionado e arraste para mover, inclusive entre faixas.
- Esticar a borda **repete** o pattern dentro do clip.
- Faixas com mudo e nome editável, grade por compasso, tempo ou passo, e zoom.
- Clique na régua para definir de onde a música começa.

### Mixer (F9)
- Master + 16 inserts, com fader, pan, mudo, solo e medidores de pico estéreo.
- Até 8 efeitos por faixa, com bypass, reordenação e remoção.

### Instrumentos nativos
| Instrumento | O que é |
|---|---|
| **Trio Synth** | Subtrativo de 3 osciladores (seno, triângulo, serra, quadrada, ruído), unísono de até 7 vozes, filtro LP/HP/BP ressonante com envelope e ADSR de volume. |
| **FM Synth** | FM de 2 operadores com envelope do modulador: pianos elétricos, sinos, baixos, metais. |
| **Drum Synth** | Bateria 100% sintetizada: kick, snare, clap, hats fechado/aberto, tom, rim, cowbell e prato. |
| **Sampler** | Toca qualquer arquivo de áudio que o navegador leia, afinado pela nota, com one-shot ou loop, reverso, ponto de início, filtro e ADSR. |

Todos têm presets de fábrica e um mini teclado para testar o som.

### Efeitos nativos
Parametric EQ (4 bandas + cortes), Compressor, Limiter, Delay (sincronizado ao BPM, com
ping-pong), Reverb (convolução com resposta de sala gerada), Distortion (saturação, clipe,
wavefolder, retificador), Filter (com LFO) e Chorus/Flanger.

### Projeto
- Desfazer/refazer (Ctrl+Z / Ctrl+Y) em todas as edições.
- **Autosave** no navegador.
- Salvar/abrir arquivos `.mcproj`, que guardam os samples dentro do projeto.
- **Exportar WAV** (16 bits, 44,1 kHz) da música inteira (modo SONG) ou do pattern (modo PAT).
  A renderização é offline e mais rápida que o tempo real.
- Metrônomo e BPM ajustável: arraste o número ou dê duplo clique para digitar.
- Teclado do computador como piano: `Z S X D C V G B H N J M` e `Q 2 W 3 E R 5 T 6 Y 7 U`.

## Arquitetura

```
src/
  model/      dados do projeto (tipos, tempo em ticks, patterns, eventos, (de)serialização)
  plugins/    instrumentos e efeitos nativos (Web Audio), parâmetros e presets
  audio/      grafo de áudio (canais → mixer → master), motor em tempo real
              (agendador com lookahead), render offline e encoder WAV
  state/      estado global (Zustand + Immer) com histórico de desfazer e autosave
  ui/         componentes React: transporte, Channel Rack, Piano Roll, Playlist, Mixer,
              editores de plugin, janelas flutuantes, atalhos
tests/        testes unitários do modelo, do estado, dos plugins e do WAV
```

- O tempo é contado em ticks: 96 por semínima, 24 por passo e 384 por compasso 4/4.
- O motor agenda as notas cerca de 120 ms à frente usando o relógio do `AudioContext`,
  por isso o tempo continua firme mesmo com a interface ocupada.
- O mesmo `AudioGraph` é usado ao vivo e no `OfflineAudioContext` da exportação, então o
  WAV soa igual ao que se ouve.

## Próximos passos possíveis

- Gravação do teclado ou MIDI direto no piano roll (Web MIDI API).
- Automação de parâmetros (clips de automação na playlist).
- Clips de áudio na playlist e envios (sends) entre faixas do mixer.
- Mais instrumentos e efeitos (wavetable, granular, vocoder, compressão multibanda).
- Versão desktop com Electron, ou um motor nativo em C++/JUCE, para carregar plugins
  VST3 de terceiros, o que um navegador não consegue fazer.
- Importar projetos `.flp`, usando a documentação pública do formato
  (por exemplo, o projeto open-source PyFLP).
