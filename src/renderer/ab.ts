import { unwrapBridge } from '@adaptivebehaviour/desktop/src/ipc/index';

/** The typed API to the main process. Each call resolves with the value or throws a `DesktopError` with a `code`. */
export const ab = unwrapBridge(window.abBridge);
