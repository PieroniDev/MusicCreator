import { useEffect, useState } from 'react';
import { baseName, desktop, type DirEntry } from '../desktop/api';
import { previewFile, stopPreview } from '../audio/preview';
import { SAMPLE_MIME } from './dnd';
import { addSamplerChannel } from './fileOps';
import { openContextMenu } from './ContextMenu';

interface NodeProps {
  entry: DirEntry;
  depth: number;
  listings: Map<string, DirEntry[] | 'loading' | 'error'>;
  expanded: Set<string>;
  toggle(dir: string): void;
  onRemoveRoot?(): void;
}

function TreeNode({ entry, depth, listings, expanded, toggle, onRemoveRoot }: NodeProps) {
  const pad = { paddingLeft: 8 + depth * 12 };
  if (!entry.isDir) {
    return (
      <button
        type="button"
        className="file-item"
        style={pad}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(SAMPLE_MIME, entry.path);
          e.dataTransfer.setData('text/plain', entry.name);
          e.dataTransfer.effectAllowed = 'copy';
        }}
        onClick={() => void previewFile(entry.path, () => desktop!.readAudio(entry.path))}
        onDoubleClick={() => {
          stopPreview();
          void desktop!.readAudio(entry.path).then((bytes) => addSamplerChannel(entry.name, bytes));
        }}
        title={`${entry.path}\nClique: ouvir · duplo clique: novo canal Sampler · arraste para o Channel Rack ou a Playlist`}
      >
        <span className="file-icon">♪</span>
        {entry.name}
      </button>
    );
  }
  const open = expanded.has(entry.path);
  const listing = listings.get(entry.path);
  return (
    <>
      <button
        type="button"
        className={`file-item dir${depth === 0 ? ' root' : ''}`}
        style={pad}
        onClick={() => toggle(entry.path)}
        onContextMenu={
          onRemoveRoot
            ? (e) => openContextMenu(e, [{ label: 'Remover pasta da lista', action: onRemoveRoot, danger: true }], entry.name)
            : undefined
        }
        title={entry.path}
      >
        <span className="file-icon">{open ? '▾' : '▸'}</span>
        {entry.name}
      </button>
      {open &&
        (listing === 'loading' ? (
          <div className="file-note" style={{ paddingLeft: 20 + depth * 12 }}>Carregando…</div>
        ) : listing === 'error' ? (
          <div className="file-note" style={{ paddingLeft: 20 + depth * 12 }}>Não foi possível abrir</div>
        ) : listing && listing.length === 0 ? (
          <div className="file-note" style={{ paddingLeft: 20 + depth * 12 }}>Sem áudios aqui</div>
        ) : (
          listing?.map((child) => (
            <TreeNode key={child.path} entry={child} depth={depth + 1} listings={listings} expanded={expanded} toggle={toggle} />
          ))
        ))}
    </>
  );
}

/**
 * The disk browser of the desktop app: folders the user added, with their
 * audio files to preview and drag into the project.
 */
export function SampleBrowser() {
  const [folders, setFolders] = useState<string[]>([]);
  const [listings, setListings] = useState(new Map<string, DirEntry[] | 'loading' | 'error'>());
  const [expanded, setExpanded] = useState(new Set<string>());

  useEffect(() => {
    void desktop?.getSettings().then((s) => setFolders(s.sampleFolders));
  }, []);

  if (!desktop) {
    return (
      <div className="browser-note">
        No app desktop, aqui aparecem as suas pastas de samples. No navegador, arraste arquivos de áudio do computador para o
        Channel Rack ou para a Playlist.
      </div>
    );
  }

  const saveFolders = (next: string[]) => {
    setFolders(next);
    void desktop!.setSampleFolders(next);
  };

  const toggle = (dir: string) => {
    const next = new Set(expanded);
    if (next.has(dir)) {
      next.delete(dir);
      setExpanded(next);
      return;
    }
    next.add(dir);
    setExpanded(next);
    if (!listings.has(dir) || listings.get(dir) === 'error') {
      setListings((m) => new Map(m).set(dir, 'loading'));
      desktop!
        .listDir(dir)
        .then((entries) => setListings((m) => new Map(m).set(dir, entries)))
        .catch(() => setListings((m) => new Map(m).set(dir, 'error')));
    }
  };

  return (
    <div className="sample-browser">
      {folders.map((dir) => (
        <TreeNode
          key={dir}
          entry={{ name: baseName(dir) || dir, path: dir, isDir: true }}
          depth={0}
          listings={listings}
          expanded={expanded}
          toggle={toggle}
          onRemoveRoot={() => saveFolders(folders.filter((f) => f !== dir))}
        />
      ))}
      <button
        type="button"
        className="browser-preset"
        onClick={() =>
          void desktop!.pickFolder().then((dir) => {
            if (dir && !folders.includes(dir)) saveFolders([...folders, dir]);
          })
        }
      >
        + Adicionar pasta…
      </button>
    </div>
  );
}
