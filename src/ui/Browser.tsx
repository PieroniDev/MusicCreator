import { useState } from 'react';
import { actions, useStore } from '../state/store';
import { EFFECTS, INSTRUMENTS } from '../plugins/registry';
import { confirmDiscard } from './fileOps';

const SHORTCUTS: Array<[string, string]> = [
  ['Espaço', 'Tocar / parar'],
  ['L', 'Alternar PAT / SONG'],
  ['F5 F6 F7 F9', 'Playlist, Channel Rack, Piano Roll, Mixer'],
  ['Ctrl+Z / Ctrl+Y', 'Desfazer / refazer'],
  ['Ctrl+S', 'Salvar projeto'],
  ['Z S X … M', 'Tocar o canal selecionado (oitava 4)'],
  ['Q 2 W … U', 'Tocar o canal selecionado (oitava 5)'],
  ['Botão direito', 'Apagar nota / clip / passo'],
];

export function Browser() {
  const [open, setOpen] = useState<Record<string, boolean>>({ instruments: true, effects: true, patterns: true });
  const [expanded, setExpanded] = useState<string | null>(null);
  const patterns = useStore((s) => s.project.patterns);
  const selectedPatternId = useStore((s) => s.ui.selectedPatternId);
  const selectedTrack = useStore((s) => s.ui.selectedMixerTrack);
  const trackName = useStore((s) => s.project.mixer[s.ui.selectedMixerTrack]?.name ?? 'Master');
  const a = actions();
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));

  return (
    <aside className="browser">
      <section>
        <button type="button" className="browser-head" onClick={() => toggle('instruments')}>
          {open.instruments ? '▾' : '▸'} Instrumentos
        </button>
        {open.instruments &&
          INSTRUMENTS.map((inst) => (
            <div key={inst.id} className="browser-item-group">
              <div className="browser-item">
                <button type="button" className="browser-expand" onClick={() => setExpanded(expanded === inst.id ? null : inst.id)} title="Presets">
                  {expanded === inst.id ? '−' : '+'}
                </button>
                <button type="button" className="browser-name" onClick={() => a.addChannel(inst.id)} title={`${inst.description}\nClique para adicionar ao Channel Rack`}>
                  {inst.name}
                </button>
              </div>
              {expanded === inst.id &&
                inst.presets.map((p) => (
                  <button type="button" key={p.name} className="browser-preset" onClick={() => a.addChannel(inst.id, p.name)} title="Adicionar canal com este preset">
                    {p.name}
                  </button>
                ))}
            </div>
          ))}
      </section>

      <section>
        <button type="button" className="browser-head" onClick={() => toggle('effects')}>
          {open.effects ? '▾' : '▸'} Efeitos
        </button>
        {open.effects && (
          <>
            <div className="browser-note">Adiciona em: {selectedTrack === 0 ? 'Master' : `${selectedTrack}. ${trackName}`}</div>
            {EFFECTS.map((fx) => (
              <div key={fx.id} className="browser-item">
                <button
                  type="button"
                  className="browser-name"
                  onClick={() => {
                    const id = a.addEffect(selectedTrack, fx.id);
                    if (id) a.openPluginWindow({ kind: 'effect', track: selectedTrack, slotId: id });
                    else alert('Esta faixa do mixer já está com todos os slots de efeito ocupados.');
                  }}
                  title={`${fx.description}\nClique para inserir na faixa selecionada do mixer`}
                >
                  {fx.name}
                </button>
              </div>
            ))}
          </>
        )}
      </section>

      <section>
        <button type="button" className="browser-head" onClick={() => toggle('patterns')}>
          {open.patterns ? '▾' : '▸'} Patterns
        </button>
        {open.patterns && (
          <>
            {patterns.map((p) => (
              <div key={p.id} className="browser-item">
                <button
                  type="button"
                  className={`browser-name pattern${p.id === selectedPatternId ? ' on' : ''}`}
                  style={{ borderLeftColor: p.color }}
                  onClick={() => a.selectPattern(p.id)}
                  onDoubleClick={() => {
                    const name = prompt('Nome do pattern', p.name);
                    if (name) a.updatePattern(p.id, { name });
                  }}
                  title="Clique: selecionar · duplo clique: renomear"
                >
                  {p.name}
                </button>
              </div>
            ))}
            <button type="button" className="browser-preset" onClick={() => a.addPattern()}>
              + Novo pattern
            </button>
          </>
        )}
      </section>

      <section>
        <button type="button" className="browser-head" onClick={() => toggle('help')}>
          {open.help ? '▾' : '▸'} Atalhos
        </button>
        {open.help && (
          <dl className="shortcuts">
            {SHORTCUTS.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <button type="button" className="browser-demo" onClick={() => confirmDiscard() && a.loadDemo()}>
        Carregar demo
      </button>
    </aside>
  );
}
