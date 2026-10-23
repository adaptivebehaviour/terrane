import { defaultHandler } from './default';
import { imageHandler } from './image';
import type { Handler } from './types';

/** The handlers by file type. Add a handler here to give a type of file its own behaviour. */
const handlers: Handler[] = [imageHandler];

/** The handler for a file, chosen by its extension (case-insensitive); the default handler if none claims it. */
export function handlerFor(filename: string): Handler {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return handlers.find((handler) => handler.extensions.includes(extension)) ?? defaultHandler;
}
