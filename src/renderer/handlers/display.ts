/** How many characters of a node's body its display shows; a longer body is cut there and ends with an ellipsis. */
const BODY_LENGTH = 127;

const ORDER: DisplayField[] = ['title', 'description', 'body'];

/** The lines of a node's display: each field in `display` that has text, in the order title, description, body, without labels. */
export function displayLines(node: TerraneNode): string[] {
  return ORDER.flatMap((field) => {
    const text = node.display.includes(field) ? node[field] : null;
    if (text === null) return [];
    return [field === 'body' && text.length > BODY_LENGTH ? `${text.slice(0, BODY_LENGTH)}…` : text];
  });
}
