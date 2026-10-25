import { createElement, type ReactElement } from 'react';
import { defaultHandler } from './default';
import { imageHandler } from './image';
import { textHandler } from './text';
import type { Handler } from './types';

/** The handlers by file type. Add a handler here to give a type of file its own behaviour. */
const handlers: Handler[] = [imageHandler];

export function isInformationNode(node: NodeRecord): node is InformationNode {
  return 'items' in node;
}

/** The handler for a file, chosen by its extension (case-insensitive); the default handler if none claims it. */
export function handlerFor(filename: string): Handler {
  const dot = filename.lastIndexOf('.');
  const extension = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
  return handlers.find((handler) => handler.extensions.includes(extension)) ?? defaultHandler;
}

/** A node's display: information nodes are given the text handler; file nodes the handler for their file (so `.txt` files stay default). */
export function renderNode(node: NodeRecord): ReactElement {
  return isInformationNode(node) ? createElement(textHandler.Component, { node }) : createElement(handlerFor(node.filename).Component, { node });
}
