import { DesktopProvider, useDesktop } from '@adaptivebehaviour/desktop/src/desktop/index';
import { ab } from './ab';

/**
 * The starter screen is deliberately blank: no title, no text, no sample data, no controls. The workspace is opened
 * by the main process; content is added only when the project asks for it (read and write records with `useRecords`).
 */
export function App() {
  return (
    <DesktopProvider api={ab}>
      <Shell />
    </DesktopProvider>
  );
}

function Shell() {
  const { workspace, error } = useDesktop();
  if (!workspace?.open) return null;
  return (
    <main className="min-h-screen" data-testid="workspace">
      {error && <p role="alert" data-testid="error" className="m-4 rounded bg-red-50 p-3 text-red-800">{error}</p>}
    </main>
  );
}
